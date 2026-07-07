import { client } from "../../config/index.js";
import { default as config } from "../../config/config.js";
import { beliefs, constantBeliefs } from "../beliefs/beliefs.js";
import { getIntentionKey, GO_PICK_UP, QUEUE_SWAP_STOP_CODE, distance, findNearestDeliverySpot } from "../utils.js";
import { MSG, CLAIM_TTL, buildMessage, isTeamMessage } from "./messages.js";
import { partitionTick } from "./partitionEA.js";
import { calculateScore } from "../reasoning/reasoning.js";
import { isTileFree } from "../planning/utilsPlanning.js";
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

// --- Opportunistic parcel handoff ---
// When teammates meet while one carries parcels, the carrier may hand its
// load to the other: one consolidated delivery trip instead of two, and the
// agent with better field options keeps harvesting.
const HANDOFF_RANGE = Number(process.env.HANDOFF_RANGE ?? 2); // max Manhattan distance to propose (env-overridable for testing)
const HANDOFF_MARGIN = 1.15;     // proposer's best option must beat receiver's by this factor
const HANDOFF_COOLDOWN = 15000;  // ms between ECONOMIC handoffs (prevents parcel ping-pong)
const HANDOFF_COOLDOWN_POSITIONAL = 5000; // positional relays can't ping-pong; re-arm faster
const PROPOSAL_COOLDOWN = 3000;  // ms between proposal attempts (don't spam rejected asks)
const TEAMMATE_BLOCK_FRESHNESS = 1500; // a block younger than this fast-tracks negotiation
let lastHandoffTime = 0;
let lastProposalTime = 0;
let handoffInFlight = false;     // a proposal of ours is awaiting a reply

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
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue; // malformed share
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
 * Best score among my currently-known free-parcel pickup options — "what I
 * would gain by staying in the field instead of delivering". Note: each
 * agent evaluates this with its OWN carried load included in calculateScore,
 * which slightly inflates a carrier's number; the HANDOFF_MARGIN absorbs
 * that bias (and the bias direction favors consolidation, which is fine).
 */
const bestPickupScore = () => {
    let best = 0;
    const mateEntry = beliefs.teammate.id ? beliefs.otherAgents.get(beliefs.teammate.id) : null;
    const mate = mateEntry && Date.now() - mateEntry.timestamp < 5000 ? mateEntry : null;
    for (const { parcel } of beliefs.storedParcels.values()) {
        if (parcel.carriedBy || !(parcel.reward > 0)) continue;
        // Same rule as optionsGeneration: a parcel under the teammate's feet
        // is not a real opportunity for us — counting it would e.g. make a
        // handoff receiver reject based on "options" it can never take.
        if (mate && Math.floor(mate.x) === Math.floor(parcel.x) && Math.floor(mate.y) === Math.floor(parcel.y)) continue;
        const s = calculateScore([GO_PICK_UP, parcel.x, parcel.y, parcel.id], { x: beliefs.me.x, y: beliefs.me.y });
        if (s > best) best = s;
    }
    return best;
};

/** emitAsk with a client-side timeout: the server's ask can silently never
 *  resolve if the teammate's socket drops between adjacency and reply. */
const askWithTimeout = (toId, msg, ms = 1500) => Promise.race([
    client.emitAsk(toId, msg),
    new Promise(resolve => setTimeout(() => resolve(undefined), ms)),
]);

const stepDelay = () => new Promise(r => setTimeout(r, constantBeliefs.config.MOVEMENT_DURATION || 200));

/**
 * Free neighbor of MY current tile that is farthest from `refPos` (never the
 * tile refPos occupies). Returns {x, y} or null when boxed in.
 */
const freeNeighborAwayFrom = (refPos) => {
    const myTile = `${Math.floor(beliefs.me.x)}-${Math.floor(beliefs.me.y)}`;
    let target = null, bestD = -1;
    for (const nb of constantBeliefs.map.mapGraph.neighbors(myTile)) {
        const [nx, ny] = nb.split('-').map(Number);
        if (Math.floor(refPos.x) === nx && Math.floor(refPos.y) === ny) continue;
        if (!isTileFree([nx, ny])) continue;
        const d = Math.abs(nx - refPos.x) + Math.abs(ny - refPos.y);
        if (d > bestD) { bestD = d; target = { x: nx, y: ny }; }
    }
    return target;
};

/** Single-step move toward an adjacent tile, with retries. True on success. */
const moveOneStep = async (target, retries = 3) => {
    let dir = null;
    if (target.x > beliefs.me.x) dir = 'right';
    else if (target.x < beliefs.me.x) dir = 'left';
    else if (target.y > beliefs.me.y) dir = 'up';
    else if (target.y < beliefs.me.y) dir = 'down';
    for (let attempt = 0; attempt < retries && dir; attempt++) {
        const moved = await client.emitMove(dir);
        if (moved) return true;
        await stepDelay();
    }
    return false;
};

/**
 * Mark donated parcels as off-limits for ourselves, and stop any of our own
 * queued/executing pickups that target them. The second part is essential:
 * sensing-triggered optionsGeneration can enqueue a pickup for the parcel we
 * JUST dropped (it's free and one tile away — top score) in the milliseconds
 * before the suppression lands, and achieving it would both steal the gift
 * back and broadcast a claim that preempts the receiver.
 */
const suppressDonatedParcels = (ids, dropPos) => {
    for (const pid of ids) {
        beliefs.invalidOptions.set(getIntentionKey([GO_PICK_UP, dropPos.x, dropPos.y, pid]), Date.now());
    }
    const queue = newAgent?.intentionRevision?.intention_queue ?? [];
    for (const intention of queue) {
        if (intention?.predicate?.[0] === GO_PICK_UP && ids.includes(intention.predicate[3]) && !intention.stopped) {
            console.log(`[TEAM] Purging our own queued pickup of donated parcel ${intention.predicate[3]}`);
            intention.stop(QUEUE_SWAP_STOP_CODE);
        }
    }
};

/**
 * Receiver-side choreography for a BOXED proposer (carrier standing on a
 * dead-end tile with us blocking its only exit — e.g. camping the hallway
 * spawner): we retreat two tiles so the carrier can step out, drop the
 * parcels on the freed tile, and step back in. Fire-and-forget: runs while
 * our accept reply travels back.
 */
const retreatForHandoff = async (proposerPos) => {
    beliefs.handoffInProgress = true;
    try {
        newAgent?.intentionRevision?.intention_queue?.[0]?.stop(QUEUE_SWAP_STOP_CODE);
        for (let step = 0; step < 2; step++) {
            await stepDelay();
            const target = freeNeighborAwayFrom(proposerPos);
            if (!target) break;
            await moveOneStep(target);
        }
    } finally {
        beliefs.handoffInProgress = false;
    }
};

/**
 * Propose a handoff when we carry parcels and the teammate is right next to
 * us. The receiver decides (it knows both agents' numbers); on accept we
 * put our load down and step off the drop tile: the dropped parcels become
 * ordinary free parcels that the receiver's normal sensing/scoring pipeline
 * picks up (it is 1-2 tiles away, so they are its top option), while we
 * self-suppress them via invalidOptions so we don't re-grab our own gift.
 * Our now-empty go_deliver is killed by the ghost-head check on the next
 * options tick. The random jitter breaks proposal symmetry when both agents
 * carry and propose simultaneously (both would reject while inFlight).
 *
 * BOXED case (we stand on a dead-end tile and the receiver blocks the only
 * exit — the steady state on corridor maps, where the harvester camps the
 * single spawner): no drop position on our own tile is reachable by the
 * receiver, so the choreography inverts — the receiver retreats (see
 * retreatForHandoff), we step out onto the freed tile, drop THERE, and step
 * back into the dead end; the receiver then returns and collects.
 */
const maybeProposeHandoff = async () => {
    if (!config.team.enabled || !hasTeammate() || handoffInFlight) return;
    const now = Date.now();

    // A recent physical block by the teammate fast-tracks negotiation: skip
    // the jitter and shorten the proposal throttle — a mutual block should be
    // resolved by talking, not by fail/replan churn (which also costs server
    // penalties). The handoff-type cooldowns below still apply: they are the
    // anti-ping-pong guarantee.
    const blockedByMate = now - (beliefs.teammateBlockedAt ?? 0) < TEAMMATE_BLOCK_FRESHNESS;

    if (now - lastProposalTime < (blockedByMate ? 1000 : PROPOSAL_COOLDOWN)) return;
    if (!(beliefs.me.carried_parcels_count > 0)) return;
    if (!blockedByMate && Math.random() < 0.5) return; // symmetry-breaking jitter

    const mate = beliefs.otherAgents.get(beliefs.teammate.id);
    if (!mate || now - mate.timestamp > 2000) return; // no fresh sighting

    // Range check: Manhattan is only a cheap pre-filter — two agents one
    // wall apart (parallel corridors) are 2 tiles by Manhattan but far
    // apart on foot, and a handshake through the wall would drop parcels
    // the receiver cannot reach. The GRAPH distance is authoritative.
    const manhattan = Math.abs(mate.x - beliefs.me.x) + Math.abs(mate.y - beliefs.me.y);
    if (manhattan > HANDOFF_RANGE) return;
    if (distance({ x: beliefs.me.x, y: beliefs.me.y }, { x: mate.x, y: mate.y }) > HANDOFF_RANGE) return;

    // Don't gift to bystanders: an opponent hovering near the drop position
    // would simply take the parcels we put down.
    for (const [oid, opponent] of beliefs.otherAgents.entries()) {
        if (oid === beliefs.teammate.id) continue;
        if (now - opponent.timestamp > 3000) continue;
        const d = Math.abs(opponent.x - beliefs.me.x) + Math.abs(opponent.y - beliefs.me.y);
        if (d <= 2) return;
    }

    // A handoff makes sense when there is something worth returning to
    // (economic trigger), or when the teammate is strictly better placed to
    // deliver than we are (positional trigger — the relay pattern: on
    // corridor maps the harvester camps the spawner, free parcels barely
    // exist, and the courier's position IS the whole reason to hand off).
    const myBest = bestPickupScore();
    const myDeliveryDist = distance({ x: beliefs.me.x, y: beliefs.me.y }, findNearestDeliverySpot({ x: beliefs.me.x, y: beliefs.me.y }));
    const mateDeliveryDist = distance({ x: mate.x, y: mate.y }, findNearestDeliverySpot({ x: mate.x, y: mate.y }));
    const positionalRelay = mateDeliveryDist < myDeliveryDist;
    if (!(myBest > 0) && !positionalRelay) return;

    // Anti-ping-pong cooldown, but only as long as it needs to be: economic
    // handoffs keep the long one, positional relays structurally can't
    // ping-pong (the proposer stops carrying and the acceptance rule is
    // direction-monotone), so they re-arm faster — this is what unsticks
    // mutually-blocking teammates without waiting out the full cooldown.
    const cooldown = positionalRelay ? HANDOFF_COOLDOWN_POSITIONAL : HANDOFF_COOLDOWN;
    if (now - lastHandoffTime < cooldown) return;

    // Are we boxed in (no free neighbor besides the teammate's tile)? Decided
    // BEFORE asking so the receiver knows whether it must retreat first.
    const boxed = freeNeighborAwayFrom(mate) === null;

    handoffInFlight = true;
    lastProposalTime = now;
    try {
        console.log(`[TEAM] Proposing handoff (carrying ${beliefs.me.carried_parcels_count}, myBest=${myBest.toFixed(1)}, positional=${positionalRelay}, boxed=${boxed})`);
        const reply = await askWithTimeout(beliefs.teammate.id, buildMessage(MSG.HANDOFF, {
            carriedReward: beliefs.me.total_carried_reward,
            carriedCount: beliefs.me.carried_parcels_count,
            bestPickupScore: myBest,
            x: beliefs.me.x,
            y: beliefs.me.y,
            boxed,
        }));

        if (!reply?.accept) {
            console.log('[TEAM] Handoff proposal rejected (or timed out)');
            return;
        }

        // Pause the intention loop and stop the current intention: the server
        // rejects actions issued while a move is in progress, and without the
        // pause the loop would immediately start the NEXT intention and keep
        // moving right through our putdown retries (verified failure mode on
        // the hallway map). The plan aborts at its next movement boundary,
        // then the agent is genuinely still.
        let ids = [];
        let dropPos = null;
        beliefs.handoffInProgress = true;
        try {
            newAgent?.intentionRevision?.intention_queue?.[0]?.stop(QUEUE_SWAP_STOP_CODE);

            if (boxed) {
                // Wait for the receiver's retreat to free our exit, step out,
                // drop there, and step back into the dead end.
                const origin = { x: Math.floor(beliefs.me.x), y: Math.floor(beliefs.me.y) };
                let exitTile = null;
                for (let attempt = 0; attempt < 12 && !exitTile; attempt++) {
                    await stepDelay();
                    exitTile = freeNeighborAwayFrom({ x: -999, y: -999 }); // any free neighbor
                }
                if (!exitTile || !(await moveOneStep(exitTile, 5))) {
                    console.log('[TEAM] Handoff aborted: exit never freed');
                    return;
                }
                dropPos = { x: exitTile.x, y: exitTile.y };
                for (let attempt = 0; attempt < 5 && ids.length === 0; attempt++) {
                    await stepDelay();
                    const dropped = await client.emitPutdown();
                    ids = Array.isArray(dropped) ? dropped.map(p => p.id) : [];
                }
                if (ids.length > 0) suppressDonatedParcels(ids, dropPos); // BEFORE any further await
                await moveOneStep(origin, 5); // step back so the receiver can reach the drop
            } else {
                // Normal case: pick the tile we will step to after dropping —
                // the receiver must walk onto our tile to collect.
                const mateNow = beliefs.otherAgents.get(beliefs.teammate.id) ?? mate;
                const vacate = freeNeighborAwayFrom(mateNow);
                if (!vacate) {
                    console.log('[TEAM] Handoff aborted: no free tile to vacate to');
                    return;
                }
                dropPos = { x: Math.floor(beliefs.me.x), y: Math.floor(beliefs.me.y) };
                for (let attempt = 0; attempt < 5 && ids.length === 0; attempt++) {
                    await stepDelay();
                    const dropped = await client.emitPutdown();
                    ids = Array.isArray(dropped) ? dropped.map(p => p.id) : [];
                }
                if (ids.length > 0) {
                    suppressDonatedParcels(ids, dropPos); // BEFORE any further await
                    // Step off the drop tile so the receiver can step onto it.
                    await moveOneStep(vacate);
                }
            }

            if (ids.length === 0) {
                console.log('[TEAM] Handoff drop failed (nothing put down)');
                return;
            }
        } finally {
            beliefs.handoffInProgress = false;
        }

        lastHandoffTime = Date.now();
        client.emitSay(beliefs.teammate.id, buildMessage(MSG.HANDOFF_DONE, {
            parcelIds: ids, x: dropPos.x, y: dropPos.y,
        }));
        console.log(`[TEAM] Handed off ${ids.length} parcels at (${dropPos.x},${dropPos.y})`);
    } finally {
        handoffInFlight = false;
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

/** Dispatch an incoming teammate message. `reply` is set for 'ask' messages. */
const onTeamMessage = (id, name, msg, reply) => {
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

        case MSG.PARCELS: {
            setTeammate(id, name);
            mergeSharedParcels(msg.payload?.parcels ?? []);

            // Heartbeat: refresh the teammate's otherAgents entry from their
            // self-report, so proximity/freshness consumers (handoff gates,
            // under-teammate skips, isTileFree) keep working even when nobody
            // moves and sensing therefore emits nothing.
            const meState = msg.payload?.me;
            if (meState && meState.x != null) {
                const prev = beliefs.otherAgents.get(id);
                beliefs.otherAgents.set(id, {
                    name,
                    x: meState.x,
                    y: meState.y,
                    score: prev?.score,
                    penalty: prev?.penalty,
                    timestamp: Date.now(),
                    direction: prev?.direction ?? 'none',
                    shared: true,
                });
                beliefs.teammate.x = meState.x;
                beliefs.teammate.y = meState.y;
                beliefs.teammate.carriedCount = meState.carriedCount ?? 0;
                beliefs.teammate.carriedReward = meState.carriedReward ?? 0;
            }
            break;
        }

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

        case MSG.HANDOFF: {
            if (typeof reply !== 'function') break;
            setTeammate(id, name);
            const proposerBest = msg.payload?.bestPickupScore ?? 0;
            let accept = false;
            // Reject while proposing ourselves (simultaneous-proposal guard).
            if (!handoffInFlight) {
                const myBest = bestPickupScore();

                // Positional (relay) rule: we are strictly closer to the
                // delivery AND forgo no more field value than the proposer.
                // The second condition keeps this from firing on open maps
                // where we have strictly better things to do; ping-pong can't
                // happen because after the drop the proposer no longer
                // carries and a courier walking toward delivery only gets
                // closer, never farther, than the harvester behind it.
                let positional = false;
                if (msg.payload?.x != null) {
                    const proposerPos = { x: msg.payload.x, y: msg.payload.y };
                    const myPos = { x: beliefs.me.x, y: beliefs.me.y };
                    const myDeliveryDist = distance(myPos, findNearestDeliverySpot(myPos));
                    const proposerDeliveryDist = distance(proposerPos, findNearestDeliverySpot(proposerPos));
                    positional = myDeliveryDist < proposerDeliveryDist && myBest <= proposerBest;
                }

                // Cooldown matched to the proposal type (positional relays
                // can't ping-pong, so they re-arm faster — mirrors the
                // proposer-side gate).
                const cooldown = positional ? HANDOFF_COOLDOWN_POSITIONAL : HANDOFF_COOLDOWN;
                if (Date.now() - lastHandoffTime >= cooldown) {
                    // Economic rule: the proposer is meaningfully better used
                    // in the field than us — we become the courier.
                    accept = proposerBest > myBest * HANDOFF_MARGIN || positional;
                }

                console.log(`[TEAM] Handoff proposal: proposerBest=${proposerBest.toFixed(1)} vs myBest=${myBest.toFixed(1)}, positional=${positional} → ${accept ? 'ACCEPT' : 'reject'}`);

                // Boxed proposer (dead-end, we block its only exit): retreat
                // so it can step out and drop. Fire-and-forget — runs while
                // our accept travels back.
                if (accept && msg.payload?.boxed && msg.payload?.x != null) {
                    retreatForHandoff({ x: msg.payload.x, y: msg.payload.y });
                }
            }
            reply({ accept });
            break;
        }

        case MSG.HANDOFF_DONE: {
            const { parcelIds, x, y } = msg.payload ?? {};
            // Cooldown starts only on a CONFIRMED drop (a failed drop on the
            // proposer's side shouldn't lock us out of the next handoff), and
            // it also stops us from immediately handing the parcels back.
            if (parcelIds?.length > 0) lastHandoffTime = Date.now();
            // Clear any stale invalidation of the donated parcels (e.g. from
            // pickup attempts that bounced off the carrier's body while it
            // was still standing on the drop tile) so we retarget them fresh.
            for (const pid of parcelIds ?? []) {
                beliefs.invalidOptions.delete(getIntentionKey([GO_PICK_UP, x, y, pid]));
            }
            // Nothing else to do: the dropped parcels are 1-2 tiles away, well
            // within sensing range, and the normal pipeline will target them.
            console.log(`[TEAM] Teammate dropped ${parcelIds?.length ?? 0} parcels for us at (${x},${y})`);
            break;
        }

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

    // The PARCELS message doubles as the team's STATUS HEARTBEAT: it always
    // goes out (even with an empty parcel list) and carries our own position
    // and cargo. Sensing timestamps only refresh on movement events, so two
    // stationary teammates would otherwise go mutually "stale" and the
    // handoff freshness gate would veto every proposal (observed grind-lock).
    if (beliefs.me.x != null) {
        client.emitSay(beliefs.teammate.id, buildMessage(MSG.PARCELS, {
            parcels,
            me: {
                x: beliefs.me.x,
                y: beliefs.me.y,
                carriedCount: beliefs.me.carried_parcels_count ?? 0,
                carriedReward: beliefs.me.total_carried_reward ?? 0,
            },
        }));
    }
    if (agents.length) client.emitSay(beliefs.teammate.id, buildMessage(MSG.AGENTS, { agents }));

    // Opportunistic handoff check rides the same per-sensing throttle
    // (fire-and-forget: the ask/reply handshake runs in the background).
    maybeProposeHandoff();
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
