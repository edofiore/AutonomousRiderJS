import { client } from "../../config/index.js";
import { default as config } from "../../config/config.js";
import { beliefs, constantBeliefs } from "../beliefs/beliefs.js";
import { getIntentionKey, GO_PICK_UP, QUEUE_SWAP_STOP_CODE } from "../utils.js";
import { MSG, CLAIM_TTL, buildMessage, isTeamMessage } from "./messages.js";
import { partitionTick } from "./partitionEA.js";
import { calculateScore } from "../reasoning/reasoning.js";
import { newAgent } from "../../autonomousRider.js";

/**
 * Team coordination (Part 2).
 *
 * Two independent agent processes recognise each other over the Deliveroo
 * message bus via a shared secret, then:
 *   - exchange beliefs (sensed parcels and opponents) to extend perception;
 *   - exchange mental states (parcel claims) so they don't chase the same
 *     parcel: the agent with the better score for a contested parcel keeps it.
 *
 * Everything here is a no-op unless `config.team.enabled` is set, so the
 * single-agent behaviour of Part 1 is preserved.
 */

let lastBeliefShare = 0;
let helloInterval = null;

const hasTeammate = () => beliefs.teammate.id !== null;

// Deterministic leader election: the agent with the lexicographically lower
// id runs the partition EA and broadcasts the result. Both sides compute
// this locally from the same two ids, so no negotiation is needed.
const isLeader = () => hasTeammate() && beliefs.me.id !== null && beliefs.me.id < beliefs.teammate.id;

// How long without any teammate message before we consider them gone and
// drop the partition (reverting to whole-map wandering).
const TEAMMATE_TIMEOUT = 10000;

/** Record (or refresh) the teammate identity, ignoring our own echoes. */
const setTeammate = (id, name) => {
    if (!id || id === beliefs.me.id || id === beliefs.teammate.id) return;
    beliefs.teammate.id = id;
    beliefs.teammate.name = name;
    beliefs.teammate.lastSeen = Date.now();
    console.log(`[TEAM] Discovered teammate ${name} (${id})`);
};

/**
 * Merge parcels shared by the teammate into our beliefs. We never overwrite a
 * parcel we are currently sensing ourselves (that data is fresher and richer).
 */
const mergeSharedParcels = (parcels) => {
    const now = Date.now();
    for (const p of parcels) {
        if (!p || p.carriedBy || !(p.reward > 0)) continue;
        const existing = beliefs.storedParcels.get(p.id);
        if (existing?.visible) continue; // we can see it directly, keep ours
        beliefs.storedParcels.set(p.id, { parcel: p, timestamp: now, visible: false });
    }
};

/**
 * Merge opponents shared by the teammate. We exclude ourselves and the
 * teammate, and we never overwrite a fresher direct observation.
 */
const mergeSharedAgents = (agents) => {
    const now = Date.now();
    for (const a of agents) {
        if (!a || a.id === beliefs.me.id || a.id === beliefs.teammate.id) continue;
        const existing = beliefs.otherAgents.get(a.id);
        if (existing && existing.timestamp >= (a.timestamp ?? 0)) continue;
        beliefs.otherAgents.set(a.id, {
            name: a.name, x: a.x, y: a.y, score: a.score,
            penalty: a.penalty, timestamp: now, direction: 'none', shared: true,
        });
    }
};

/**
 * Part 2: retroactive claim honoring. Claims normally only filter option
 * GENERATION; but claims are announced when execution starts, so both agents
 * can commit to the same parcel within that race window and the loser would
 * keep walking to a parcel it can never win. When a claim arrives for a
 * pickup we already have queued or executing, re-run the same comparison
 * used at generation time and abandon our intention if the teammate wins.
 * Pickups only: parcels are rivalrous, while delivery/wander spots can be
 * shared, so preempting those would only hurt.
 */
const preemptClaimedIntention = (intentionKey) => {
    const queue = newAgent?.intentionRevision?.intention_queue;
    if (!queue?.length) return;

    const intention = queue.find(i => getIntentionKey(i.predicate) === intentionKey);
    if (!intention || intention.predicate[0] !== GO_PICK_UP || intention.stopped) return;

    const myScore = calculateScore(intention.predicate, { x: beliefs.me.x, y: beliefs.me.y });
    if (isClaimedByTeammate(intentionKey, myScore)) {
        console.log(`[TEAM] Teammate's claim on ${intentionKey} beats ours (${myScore}); abandoning it`);
        intention.stop(QUEUE_SWAP_STOP_CODE); // interruption, not a failure
    }
};

/** Dispatch an incoming teammate message. */
const onTeamMessage = (id, name, msg /*, reply */) => {
    if (!config.team.enabled || !isTeamMessage(msg)) return;

    beliefs.teammate.lastSeen = Date.now();

    switch (msg.type) {
        case MSG.HELLO:
            setTeammate(id, name);
            // Answer directly so the other side learns our id too.
            client.emitSay(id, buildMessage(MSG.HELLO_ACK, {}));
            break;

        case MSG.HELLO_ACK:
            setTeammate(id, name);
            break;

        case MSG.PARCELS:
            setTeammate(id, name);
            mergeSharedParcels(msg.payload?.parcels ?? []);
            break;

        case MSG.AGENTS:
            setTeammate(id, name);
            mergeSharedAgents(msg.payload?.agents ?? []);
            break;

        case MSG.CLAIM: {
            const { key, parcelId, x, y, score } = msg.payload ?? {};
            if (key) {
                beliefs.teamClaims.set(key, { parcelId, x, y, score, timestamp: Date.now() });
                preemptClaimedIntention(key);
            }
            break;
        }

        case MSG.RELEASE:
            if (msg.payload?.key) beliefs.teamClaims.delete(msg.payload.key);
            break;

        case MSG.ZONES: {
            setTeammate(id, name);
            const { assignment, version } = msg.payload ?? {};
            const mine = assignment?.[beliefs.me.id];
            if (Array.isArray(mine) && (version ?? 0) >= beliefs.zones.version) {
                const changed = !beliefs.zones.mine || beliefs.zones.mine.size !== mine.length
                    || mine.some(t => !beliefs.zones.mine.has(t));
                beliefs.zones.mine = new Set(mine);
                beliefs.zones.version = version ?? beliefs.zones.version;
                if (changed) console.log(`[TEAM] Adopted evolved zone v${version}: ${mine.length} spawners`);
            }
            break;
        }
    }
};

/** Drop teammate claims that are older than CLAIM_TTL. */
const pruneStaleClaims = () => {
    const now = Date.now();
    for (const [key, claim] of beliefs.teamClaims.entries()) {
        if (now - claim.timestamp > CLAIM_TTL) beliefs.teamClaims.delete(key);
    }
};

/**
 * Is `intentionKey` claimed by the teammate with a score that beats `myScore`?
 * Ties are broken deterministically by agent id so both agents agree on the
 * winner without further negotiation.
 */
const isClaimedByTeammate = (intentionKey, myScore) => {
    pruneStaleClaims();
    const claim = beliefs.teamClaims.get(intentionKey);
    if (!claim) return false;

    if (claim.score > myScore) return true;
    if (claim.score === myScore) return (beliefs.teammate.id ?? '') < (beliefs.me.id ?? ''); // Priority by id is just to have a common tie-breaker
    return false;
};

/** Share our currently known free parcels and opponents with the teammate. */
const shareBeliefs = () => {
    if (!config.team.enabled || !hasTeammate()) return;

    const minInterval = Math.max(200, constantBeliefs.config.MOVEMENT_DURATION || 200);
    const now = Date.now();
    if (now - lastBeliefShare < minInterval) return;
    lastBeliefShare = now;

    const parcels = [];
    for (const data of beliefs.storedParcels.values()) {
        // Forward only parcels we are *currently* sensing directly; this prevents
        // a parcel from ping-ponging between agents and never aging out (the
        // teammate's own share would otherwise keep refreshing our entry).
        if (!data.visible) continue;
        if (!data.parcel.carriedBy && data.parcel.reward > 0) parcels.push(data.parcel);
    }

    const agents = [];
    for (const [id, a] of beliefs.otherAgents.entries()) {
        if (id === beliefs.teammate.id || a.shared) continue; // only forward our own observations
        agents.push({ id, name: a.name, x: a.x, y: a.y, score: a.score, penalty: a.penalty, timestamp: a.timestamp });
    }

    if (parcels.length) client.emitSay(beliefs.teammate.id, buildMessage(MSG.PARCELS, { parcels }));
    if (agents.length) client.emitSay(beliefs.teammate.id, buildMessage(MSG.AGENTS, { agents }));
};

/**
 * Tell the teammate we are committing to this target (pickup, delivery spot,
 * or wander spot), so they can pick a different one. Works for any predicate
 * type.
 */
const announceClaim = (predicate, score) => {
    if (!config.team.enabled || !hasTeammate()) return;
    const key = getIntentionKey(predicate);
    client.emitSay(beliefs.teammate.id, buildMessage(MSG.CLAIM, {
        key, parcelId: predicate[3], x: predicate[1], y: predicate[2], score,
    }));
};

/** Tell the teammate we are no longer pursuing this target. */
const releaseClaim = (predicate) => {
    if (!config.team.enabled || !hasTeammate()) return;
    client.emitSay(beliefs.teammate.id, buildMessage(MSG.RELEASE, { key: getIntentionKey(predicate) }));
};

/**
 * Start coordination: register the message handler and begin announcing our
 * presence. Safe to call once at startup; no-op when team mode is disabled.
 */
const initCoordination = () => {
    if (!config.team.enabled) {
        console.log('[TEAM] Team mode disabled; running as single agent.');
        return;
    }

    console.log('[TEAM] Team mode enabled; announcing presence...');
    client.onMsg(onTeamMessage);

    // Re-broadcast HELLO periodically: covers the case where the teammate
    // connects later, and lets discovery recover after a reconnect.
    const announce = () => client.emitShout(buildMessage(MSG.HELLO, {}));
    announce();
    helloInterval = setInterval(() => {
        announce();
        pruneStaleClaims();

        // Teammate gone silent: drop the partition, wander the whole map again.
        if (hasTeammate() && Date.now() - beliefs.teammate.lastSeen > TEAMMATE_TIMEOUT) {
            if (beliefs.zones.mine) {
                console.log('[TEAM] Teammate silent, dropping evolved zones');
                beliefs.zones.mine = null;
            }
        }

        // Leader evolves the map partition live and shares it (mental-state
        // exchange: the evolved strategy itself is broadcast to the teammate).
        if (isLeader()) {
            const result = partitionTick();
            if (result) {
                beliefs.zones.mine = new Set(result.assignment[beliefs.me.id]);
                beliefs.zones.version = result.version;
                client.emitSay(beliefs.teammate.id, buildMessage(MSG.ZONES, result));
            }
        }
    }, 2000);
};

export {
    initCoordination,
    shareBeliefs,
    announceClaim,
    releaseClaim,
    isClaimedByTeammate,
    hasTeammate,
};
