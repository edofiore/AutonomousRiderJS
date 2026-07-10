import { Plan } from "./Plan.js";
import { onlineSolver } from "@unitn-asa/pddl-client";
import { beliefs, constantBeliefs } from "../beliefs/beliefs.js";
import { GO_PICK_UP, GO_DELIVER, ERROR_CODES, distance } from "../utils.js";
import { suppressDonatedParcels } from "../coordination/coordination.js";
import { buildMessage, MSG } from "../coordination/messages.js";
import { client } from "../../config/index.js";
import config from "../../config/config.js";

const DELIVEROO_DOMAIN = `
(define (domain deliveroo)
  (:requirements :strips :negative-preconditions)
  (:predicates
    (is-agent ?a)
    (is-tile ?t)
    (is-parcel ?p)
    (at-agent ?a ?t)
    (at-parcel ?p ?t)
    (carrying ?a ?p)
    (connected ?t1 ?t2)
    (blocked ?t)
    (is-delivery-zone ?t)
    (delivered ?p)
  )

  (:action move
    :parameters (?a ?from ?to)
    :precondition (and
      (is-agent ?a)
      (is-tile ?from)
      (is-tile ?to)
      (at-agent ?a ?from)
      (connected ?from ?to)
      (not (blocked ?to))
    )
    :effect (and
      (at-agent ?a ?to)
      (not (at-agent ?a ?from))
    )
  )

  (:action pickup
    :parameters (?a ?p ?t)
    :precondition (and
      (is-agent ?a)
      (is-parcel ?p)
      (is-tile ?t)
      (at-agent ?a ?t)
      (at-parcel ?p ?t)
    )
    :effect (and
      (carrying ?a ?p)
      (not (at-parcel ?p ?t))
    )
  )

  (:action putdown
    :parameters (?a ?p ?t)
    :precondition (and
      (is-agent ?a)
      (is-parcel ?p)
      (is-tile ?t)
      (at-agent ?a ?t)
      (carrying ?a ?p)
    )
    :effect (and (at-parcel ?p ?t) (not (carrying ?a ?p)))
  )

  (:action deliver
    :parameters (?a ?p ?t)
    :precondition (and
      (is-agent ?a)
      (is-parcel ?p)
      (is-tile ?t)
      (at-agent ?a ?t)
      (carrying ?a ?p)
      (is-delivery-zone ?t)
    )
    :effect (and
      (delivered ?p)
      (not (carrying ?a ?p))
    )
  )
)
`;

// The static part of the problem (tile objects, tile/connection/delivery-zone
// facts) depends only on the map, which is loaded once per session. Building
// it lazily once avoids re-generating and re-joining thousands of strings on
// every intention.
let staticMapPart = null;

const getStaticMapPart = () => {
    if (staticMapPart) return staticMapPart;

    const objects = [];
    const init = [];

    for (const spot of constantBeliefs.map.deliverySpots) {
        // deliverySpots entries are [x, y] arrays (see processMapData)
        init.push(`(is-delivery-zone tile_${spot[0]}_${spot[1]})`);
    }

    for (const node of constantBeliefs.map.mapGraph.nodes()) {
        const tName = `tile_${node.replace(/-/g, '_')}`;
        objects.push(tName);
        init.push(`(is-tile ${tName})`);
        for (const neighbor of constantBeliefs.map.mapGraph.neighbors(node)) {
            init.push(`(connected ${tName} tile_${neighbor.replace(/-/g, '_')})`);
        }
    }

    staticMapPart = {
        objectsStr: objects.join(' '),
        initStr: init.join(' ')
    };
    return staticMapPart;
};

// Circuit breaker: the solver is a remote service polled over HTTP. When it
// is slow or unreachable every PDDL attempt costs the agent a full timeout
// standing still, so after enough consecutive transport failures PddlPlan
// stops applying for the rest of the session (classical plans take over).
let consecutiveSolverFailures = 0;

const solveWithTimeout = async (domain, problem) => {
    let timer;
    try {
        return await Promise.race([
            onlineSolver(domain, problem),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`solver timed out after ${config.pddl.timeoutMs} ms`)),
                    config.pddl.timeoutMs
                );
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
};

export class PddlPlan extends Plan {
    static isApplicableTo(action, x, y, id) {
        return config.pddl.enabled
            && consecutiveSolverFailures < config.pddl.maxConsecutiveFailures
            && (action === GO_PICK_UP || action === GO_DELIVER);
    }

    async execute(action, x, y, id) {
        console.log(`[PDDL] Executing PDDL plan for ${action} at (${x}, ${y}) target=${id || 'none'}`);

        if (this.stopped) throw [ERROR_CODES.STOPPED];

        const { problem, goalParcelIds } = this.generateProblem(action, x, y, id);

        let planSteps;
        try {
            console.log(`[PDDL] Invoking online solver...`);
            planSteps = await solveWithTimeout(DELIVEROO_DOMAIN, problem);
            consecutiveSolverFailures = 0;
        } catch (e) {
            consecutiveSolverFailures++;
            console.error(`[PDDL] Solver failed (${consecutiveSolverFailures}/${config.pddl.maxConsecutiveFailures} consecutive):`, e);
            if (consecutiveSolverFailures >= config.pddl.maxConsecutiveFailures) {
                console.error(`[PDDL] Circuit breaker tripped: PDDL planning disabled for the rest of the session.`);
            }
            throw [ERROR_CODES.NO_PLAN, e];
        }

        if (!planSteps || planSteps.length === 0) {
            console.log(`[PDDL] Solver returned no plan.`);
            throw [ERROR_CODES.NO_PLAN];
        }

        console.log(`[PDDL] Plan found with ${planSteps.length} steps:`);
        for (const step of planSteps) {
            console.log(`  - (${step.action} ${step.args.join(' ')})`);
        }

        // Parcels whose (delivered ?p) goal has actually been settled by our
        // own actions: dropped on a delivery zone, or handed off to the mate.
        const settledParcels = new Set();

        // Execute plan steps
        for (const step of planSteps) {
            if (this.stopped) throw [ERROR_CODES.STOPPED];

            const actionName = step.action.toLowerCase();
            const agentName = step.args[0].toLowerCase();

            // Steps assigned to the teammate cannot be executed from here.
            // The only cooperative pattern we can realize is "me putdown →
            // mate pickup" (communicated via HANDOFF_DONE below); any other
            // step the solver delegates to the mate leaves its goal parcel
            // unsettled and is caught by the postcondition check after the loop.
            if (agentName !== 'me') {
                console.log(`[PDDL] Action (${step.action} ...) is for agent ${agentName}. Skipping it.`);
                continue;
            }

            if (actionName === 'move') {
                const destTile = step.args[2].toLowerCase();
                const coords = this.getCoordsFromTilePddlName(destTile);
                console.log(`[PDDL] Moving to (${coords.x}, ${coords.y})`);
                await this.subIntention(['go_to', coords.x, coords.y]);
            } else if (actionName === 'pickup') {
                const parcelId = this.fromPddlParcelId(step.args[1].toLowerCase());
                console.log(`[PDDL] Picking up parcel ${parcelId}`);
                const picked = await client.emitPickup();
                const pickedIds = Array.isArray(picked) ? picked.map(p => p.id) : [];
                if (!pickedIds.includes(parcelId)) {
                    console.log(`[PDDL] Pickup of ${parcelId} failed! Parcel might have decayed or been taken.`);
                    beliefs.storedParcels.delete(parcelId);
                    throw [ERROR_CODES.PARCEL_UNAVAILABLE, parcelId];
                }
            } else if (actionName === 'putdown' || actionName === 'deliver') {
                const parcelId = this.fromPddlParcelId(step.args[1].toLowerCase());
                const tileName = step.args[2].toLowerCase();
                const coords = this.getCoordsFromTilePddlName(tileName);
                console.log(`[PDDL] Putting down parcel ${parcelId} at (${coords.x}, ${coords.y})`);

                const dropped = await client.emitPutdown();
                const droppedIds = Array.isArray(dropped) ? dropped.map(p => p.id) : [];

                if (actionName === 'deliver') {
                    // Dropping on a delivery zone delivers everything we carry.
                    for (const did of droppedIds) settledParcels.add(did);
                } else if (droppedIds.length > 0 && beliefs.teammate.id !== null) {
                    // A putdown on a non-delivery tile only appears in a plan
                    // as a donation to the teammate: goal parcels dropped here
                    // count as settled only if the handoff message went out.
                    const mateLog = beliefs.otherAgents.get(beliefs.teammate.id);
                    if (mateLog && Date.now() - mateLog.timestamp < 2000) {
                        console.log(`[PDDL-TEAM] Donating dropped parcels [${droppedIds}] to teammate`);
                        suppressDonatedParcels(droppedIds, coords);
                        client.emitSay(beliefs.teammate.id, buildMessage(MSG.HANDOFF_DONE, {
                            parcelIds: droppedIds,
                            x: coords.x,
                            y: coords.y
                        }));
                        for (const did of droppedIds) settledParcels.add(did);
                    }
                }
            } else {
                console.warn(`[PDDL] Unknown plan action: ${actionName}`);
            }
        }

        // Postcondition check: goals are agent-agnostic ((delivered ?p)), so
        // the solver may have assigned goal-critical pickups/delivers to the
        // teammate. Those steps were skipped above, so without this check the
        // intention would "succeed" with nothing actually done.
        const unsettled = goalParcelIds.filter(pid => !settledParcels.has(pid));
        if (unsettled.length > 0) {
            console.log(`[PDDL] Plan finished but goal parcels [${unsettled}] were not settled by this agent (steps likely assigned to the teammate). Failing over to classical plans.`);
            throw [ERROR_CODES.NO_PLAN, 'pddl postcondition unsatisfied', ...unsettled];
        }

        return true;
    }

    generateProblem(action, tx, ty, targetId) {
        const staticPart = getStaticMapPart();
        const objects = new Set();
        const init = [];
        const goal = [];
        const goalParcelIds = [];

        // Add agents
        objects.add('me');
        init.push('(is-agent me)');
        init.push(`(at-agent me tile_${Math.floor(beliefs.me.x)}_${Math.floor(beliefs.me.y)})`);

        // Check if teammate is active and close (topological distance <= 3)
        const useTeammate = beliefs.teammate.id !== null;
        let mateLog = null;
        let includeTeammate = false;
        if (useTeammate) {
            mateLog = beliefs.otherAgents.get(beliefs.teammate.id);
            if (mateLog && Date.now() - mateLog.timestamp < 2000) {
                const dist = distance({ x: beliefs.me.x, y: beliefs.me.y }, { x: mateLog.x, y: mateLog.y });
                if (dist <= 3) {
                    includeTeammate = true;
                    objects.add('mate');
                    init.push('(is-agent mate)');
                    init.push(`(at-agent mate tile_${Math.floor(mateLog.x)}_${Math.floor(mateLog.y)})`);
                }
            }
        }

        // Declare blocked tiles (avoiding teammate's current tile since they are active)
        for (const item of beliefs.tmpBlockedTiles) {
            const blockedTile = typeof item === 'string' ? item : item.tile;
            init.push(`(blocked tile_${blockedTile.replace(/-/g, '_')})`);
        }
        for (const [oid, agentLog] of beliefs.otherAgents.entries()) {
            if (oid === beliefs.me.id) continue;
            if (includeTeammate && oid === beliefs.teammate.id) continue;
            if (Date.now() - agentLog.timestamp < 1000) {
                init.push(`(blocked tile_${Math.floor(agentLog.x)}_${Math.floor(agentLog.y)})`);
            }
        }

        // Collect relevant parcels
        const relevantParcels = new Map();

        // 1. Add currently carried parcels by me
        for (const pid of beliefs.me.carried_parcel_ids || []) {
            const pInfo = beliefs.storedParcels.get(pid)?.parcel || { id: pid, reward: 1 };
            relevantParcels.set(pid, pInfo);

            const pPddlId = this.toPddlParcelId(pid);
            objects.add(pPddlId);
            init.push(`(is-parcel ${pPddlId})`);
            init.push(`(carrying me ${pPddlId})`);
            goal.push(`(delivered ${pPddlId})`);
            goalParcelIds.push(pid);
        }

        // 2. Add target parcel
        if (action === GO_PICK_UP && targetId) {
            const pInfo = beliefs.storedParcels.get(targetId)?.parcel;
            if (pInfo) {
                relevantParcels.set(targetId, pInfo);
                const pPddlId = this.toPddlParcelId(targetId);

                objects.add(pPddlId);
                init.push(`(is-parcel ${pPddlId})`);
                init.push(`(at-parcel ${pPddlId} tile_${Math.floor(pInfo.x)}_${Math.floor(pInfo.y)})`);
                goal.push(`(delivered ${pPddlId})`);
                goalParcelIds.push(targetId);
            }
        }

        // 3. Add nearby optional free parcels (Use Case A - picking up along the way)
        // Detour check: if it is on the way (topological distance check)
        if (action === GO_PICK_UP && targetId) {
            const targetParcel = beliefs.storedParcels.get(targetId)?.parcel;
            if (targetParcel) {
                const startPos = { x: Math.floor(beliefs.me.x), y: Math.floor(beliefs.me.y) };
                const targetPos = { x: Math.floor(targetParcel.x), y: Math.floor(targetParcel.y) };
                const totalDist = distance(startPos, targetPos);

                for (const [pid, data] of beliefs.storedParcels.entries()) {
                    if (pid === targetId || data.parcel.carriedBy || relevantParcels.has(pid)) continue;
                    const pPos = { x: Math.floor(data.parcel.x), y: Math.floor(data.parcel.y) };
                    const distStart = distance(startPos, pPos);
                    const distTarget = distance(pPos, targetPos);

                    // If topological detour <= 2:
                    if (distStart + distTarget <= totalDist + 2) {
                        relevantParcels.set(pid, data.parcel);
                        const pPddlId = this.toPddlParcelId(pid);
                        objects.add(pPddlId);
                        init.push(`(is-parcel ${pPddlId})`);
                        init.push(`(at-parcel ${pPddlId} tile_${pPos.x}_${pPos.y})`);
                        goal.push(`(delivered ${pPddlId})`);
                        goalParcelIds.push(pid);
                    }
                }
            }
        }

        // A problem with no goal is trivially "solved" by an empty plan (e.g.
        // go_deliver while beliefs say nothing is carried): fail here instead
        // of paying the solver round trip for nothing.
        if (goal.length === 0) {
            console.log(`[PDDL] No goal facts for ${action} (target=${targetId || 'none'}) — skipping solver.`);
            throw [ERROR_CODES.NO_PLAN, 'empty pddl goal'];
        }

        const objectsStr = `${[...objects].join(' ')} ${staticPart.objectsStr}`;
        const initStr = `${init.join(' ')} ${staticPart.initStr}`;
        const goalStr = `and ${goal.join(' ')}`;

        const problem = `
(define (problem deliveroo-pb)
  (:domain deliveroo)
  (:objects ${objectsStr})
  (:init ${initStr})
  (:goal (${goalStr}))
)
        `;

        return { problem, goalParcelIds };
    }

    toPddlParcelId(uuid) {
        return 'p_' + uuid.replace(/-/g, '_');
    }

    fromPddlParcelId(pddlId) {
        const parts = pddlId.substring(2).split('_');
        return parts.join('-');
    }

    getCoordsFromTilePddlName(tilePddlName) {
        const parts = tilePddlName.substring(5).split('_');
        return { x: parseInt(parts[0]), y: parseInt(parts[1]) };
    }
}
