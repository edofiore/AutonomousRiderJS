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

export class PddlPlan extends Plan {
    static isApplicableTo(action, x, y, id) {
        return config.pddl.enabled && (action === GO_PICK_UP || action === GO_DELIVER);
    }

    async execute(action, x, y, id) {
        console.log(`[PDDL] Executing PDDL plan for ${action} at (${x}, ${y}) target=${id || 'none'}`);

        if (this.stopped) throw [ERROR_CODES.STOPPED];

        const problem = this.generateProblem(action, x, y, id);
        
        let planSteps;
        try {
            console.log(`[PDDL] Invoking online solver...`);
            planSteps = await onlineSolver(DELIVEROO_DOMAIN, problem);
        } catch (e) {
            console.error(`[PDDL] Solver failed with error:`, e);
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

        // Execute plan steps
        for (const step of planSteps) {
            if (this.stopped) throw [ERROR_CODES.STOPPED];

            const actionName = step.action.toLowerCase();
            const agentName = step.args[0].toLowerCase();

            // If the action is for the teammate (cooperative step), we skip it and continue.
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
                if (!picked || picked.length === 0) {
                    console.log(`[PDDL] Pickup failed! Parcel might have decayed or been taken.`);
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

                if (droppedIds.length > 0) {
                    // Check if teammate exists and is active (to trigger handoff coordination)
                    if (beliefs.teammate.id !== null) {
                        const mateLog = beliefs.otherAgents.get(beliefs.teammate.id);
                        if (mateLog && Date.now() - mateLog.timestamp < 2000) {
                            console.log(`[PDDL-TEAM] Donating dropped parcel ${parcelId} to teammate`);
                            suppressDonatedParcels(droppedIds, coords);
                            client.emitSay(beliefs.teammate.id, buildMessage(MSG.HANDOFF_DONE, {
                                parcelIds: droppedIds,
                                x: coords.x,
                                y: coords.y
                            }));
                        }
                    }
                }
            } else {
                console.warn(`[PDDL] Unknown plan action: ${actionName}`);
            }
        }

        return true;
    }

    generateProblem(action, tx, ty, targetId) {
        const objects = [];
        const init = [];
        const goal = [];

        // Add agents
        objects.push('me');
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
                    objects.push('mate');
                    init.push('(is-agent mate)');
                    init.push(`(at-agent mate tile_${Math.floor(mateLog.x)}_${Math.floor(mateLog.y)})`);
                }
            }
        }

        // Add delivery zones
        for (const spot of constantBeliefs.map.deliverySpots) {
            const tName = `tile_${spot.x}_${spot.y}`;
            init.push(`(is-delivery-zone ${tName})`);
        }

        // Collect all nodes (tiles) and declare them
        const allNodes = constantBeliefs.map.mapGraph.nodes();
        for (const node of allNodes) {
            const tName = `tile_${node.replace(/-/g, '_')}`;
            if (!objects.includes(tName)) {
                objects.push(tName);
            }
            init.push(`(is-tile ${tName})`);
        }

        // Declare connections
        for (const node of allNodes) {
            const uName = `tile_${node.replace(/-/g, '_')}`;
            const neighbors = constantBeliefs.map.mapGraph.neighbors(node);
            for (const neighbor of neighbors) {
                const vName = `tile_${neighbor.replace(/-/g, '_')}`;
                init.push(`(connected ${uName} ${vName})`);
            }
        }

        // Declare blocked tiles (avoiding teammate's current tile since they are active)
        for (const item of beliefs.tmpBlockedTiles) {
            const blockedTile = typeof item === 'string' ? item : item.tile;
            const tName = `tile_${blockedTile.replace(/-/g, '_')}`;
            init.push(`(blocked ${tName})`);
        }
        for (const [oid, agentLog] of beliefs.otherAgents.entries()) {
            if (oid === beliefs.me.id) continue;
            if (includeTeammate && oid === beliefs.teammate.id) continue;
            if (Date.now() - agentLog.timestamp < 1000) {
                const tName = `tile_${Math.floor(agentLog.x)}_${Math.floor(agentLog.y)}`;
                init.push(`(blocked ${tName})`);
            }
        }

        // Collect relevant parcels
        const relevantParcels = new Map();

        // 1. Add currently carried parcels by me
        for (const pid of beliefs.me.carried_parcel_ids || []) {
            const pInfo = beliefs.storedParcels.get(pid)?.parcel || { id: pid, reward: 1 };
            relevantParcels.set(pid, pInfo);
            
            const pPddlId = this.toPddlParcelId(pid);
            if (!objects.includes(pPddlId)) {
                objects.push(pPddlId);
            }
            init.push(`(is-parcel ${pPddlId})`);
            init.push(`(carrying me ${pPddlId})`);
            goal.push(`(delivered ${pPddlId})`);
        }

        // 2. Add target parcel
        if (action === GO_PICK_UP && targetId) {
            const pInfo = beliefs.storedParcels.get(targetId)?.parcel;
            if (pInfo) {
                relevantParcels.set(targetId, pInfo);
                const pPddlId = this.toPddlParcelId(targetId);
                
                if (!objects.includes(pPddlId)) {
                    objects.push(pPddlId);
                }
                init.push(`(is-parcel ${pPddlId})`);
                init.push(`(at-parcel ${pPddlId} tile_${Math.floor(pInfo.x)}_${Math.floor(pInfo.y)})`);
                goal.push(`(delivered ${pPddlId})`);
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
                        if (!objects.includes(pPddlId)) {
                            objects.push(pPddlId);
                        }
                        init.push(`(is-parcel ${pPddlId})`);
                        init.push(`(at-parcel ${pPddlId} tile_${pPos.x}_${pPos.y})`);
                        goal.push(`(delivered ${pPddlId})`);
                    }
                }
            }
        }

        const objectsStr = objects.join(' ');
        const initStr = init.join(' ');
        const goalStr = `and ${goal.join(' ')}`;

        return `
(define (problem deliveroo-pb)
  (:domain deliveroo)
  (:objects ${objectsStr})
  (:init ${initStr})
  (:goal (${goalStr}))
)
        `;
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
