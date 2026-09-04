import {beliefs, constantBeliefs, findNearestDeliverySpot, findFurthestParcelSpawner, GO_TO, GO_DELIVER, GO_PICK_UP, isIntentionAlreadyQueued, distance, getRewardAtDestination, getIntentionKey, INVALID_STOP_CODE, debugLog } from "../index.js"
import { isClaimedByTeammate } from "../coordination/index.js";
import { nextPatrolStops, advanceCursor } from "./tourEA.js";
import { newAgent } from "../../autonomousRider.js";

// Multiplier applied to the reward component of a pickup whose parcel
// lies outside the assigned evolved zone (only while a partition is active). Soft
// division of labor: each agent prefers its own zone, but an out-of-zone
// parcel still wins when its discounted value beats all in-zone options.
const OUT_OF_ZONE_DISCOUNT = 0.65;

// Multiplier applied to the reward component of a pickup when the
// teammate is significantly closer to the parcel (mirror of the opponent
// risk penalty, which deliberately excludes the teammate). Soft discount
// applied only by the farther agent to avoid redundant competing trips.
const TEAMMATE_PROXIMITY_DISCOUNT = 0.5;

// How old an opponent sighting may be before it stops counting toward the
// risk penalty. `beliefs.otherAgents` is an append-only log — entries are
// never evicted — so without this a competitor seen once at the start of the
// match would keep penalizing that region for the whole game. Matches the
// freshness window used for teammate sightings.
const OPPONENT_SIGHTING_FRESHNESS = 5000;

// Keys currently yielded to the teammate. Used to log a yield only on
// transition (first tick an option starts being yielded), not on every options tick.
let yieldedKeys = new Set();

async function optionsGeneration() {

    clearInvalidOptions();

    const intention_queue = newAgent.intentionRevision.intention_queue;

    // Kill ghost commitments: the executing head intention is otherwise only
    // validity-checked BEFORE achieve() starts, so if its parcel vanishes
    // from beliefs mid-walk (picked up by someone, decayed away) the agent
    // would finish the whole walk for nothing. Stop it here; the loop then
    // discards it as an interruption, not a failure.
    const head = intention_queue[0];
    if (head && !head.stopped && !head.isStillValid()) {
        console.log("Head intention no longer valid, stopping it:", head.predicate);
        head.stop(INVALID_STOP_CODE);
    }

    // Fresh teammate sighting, used by several filters below.
    const mate_sighting = beliefs.teammate.id ? beliefs.otherAgents.get(beliefs.teammate.id) : null;
    const mate_pos = mate_sighting && Date.now() - mate_sighting.timestamp < 5000 ? mate_sighting : null;

    /**
     * Options generation
     */
    const options = new Map();
    const currentYielded = new Set();

    for (const parcel_data of beliefs.storedParcels.values()) {
        const parcel = parcel_data.parcel;
        if (!parcel.carriedBy && parcel.reward > 0) {
            // Parcel sitting on the teammate's current tile: teammate collects it
            // directly; skip to avoid stepping onto an occupied tile.
            if (mate_pos && Math.floor(mate_pos.x) === Math.floor(parcel.x) && Math.floor(mate_pos.y) === Math.floor(parcel.y)) continue;

            const new_option = [GO_PICK_UP, parcel.x, parcel.y, parcel.id];
            const option_key = getIntentionKey(new_option);
            if (!isIntentionAlreadyQueued(intention_queue, option_key) && !beliefs.invalidOptions.has(option_key)) {
                // Yield a contested parcel to the teammate when they have a better score.
                const my_score = calculateScore(new_option, { x: beliefs.me.x, y: beliefs.me.y });
                if (isClaimedByTeammate(option_key, my_score)) {
                    currentYielded.add(option_key);
                    if (!yieldedKeys.has(option_key)) {
                        console.log(`[TEAM] Yielding parcel ${parcel.id} to teammate (my score ${my_score})`);
                    }
                    continue;
                }
                options.set(option_key, new_option);
            }
        }
    }

    yieldedKeys = currentYielded;

    if (options.size == 0) {
        // If the agent is currently carrying parcels, consider delivery options
        let new_option = null;

        if(intention_queue.length > 0) {
            const start_pos = {x: intention_queue[0].predicate[1], y: intention_queue[0].predicate[2]}

            if(intention_queue[0].predicate[0] == GO_PICK_UP && (intention_queue[1] == undefined || intention_queue[1].predicate[0] != GO_PICK_UP)) {
                const best_spot = findNearestDeliverySpot(start_pos);
                new_option = [GO_DELIVER, parseInt(best_spot.x), parseInt(best_spot.y)];
            }
        }
        if(new_option && !isIntentionAlreadyQueued(intention_queue, getIntentionKey(new_option)) && !beliefs.invalidOptions.has(getIntentionKey(new_option))) {
            options.set(getIntentionKey(new_option), new_option);
        }
    }

    // Deliver directly is always an option if the agent is carrying parcels. Iterate
    // delivery spots from nearest to farthest and pick the first one that
    // isn't already queued, isn't marked invalid (e.g. recently failed), and
    // isn't claimed by the teammate with a better score. This keeps a single
    // blocked or contested zone from suppressing delivery entirely.
    if(beliefs.me.carried_parcels_count > 0) {
        const me_pos = {x: beliefs.me.x, y: beliefs.me.y};
        const spots = [...constantBeliefs.map.deliverySpots]
            .map(([x, y]) => ({x, y}))
            .sort((a, b) => distance(me_pos, a) - distance(me_pos, b));

        // Prefer a delivery spot the teammate hasn't claimed, but treat the
        // claim as a soft preference: delivery tiles are not rivalrous (both
        // agents can put down back-to-back), so when every spot is claimed —
        // e.g. a single-delivery-zone map while the teammate is on its own
        // delivery run — the agent still delivers to the nearest one rather than
        // sitting on decaying cargo with no delivery option at all.
        let claimed_fallback = null;
        for (const spot of spots) {
            const delivery_option = [GO_DELIVER, parseInt(spot.x), parseInt(spot.y)];
            const key = getIntentionKey(delivery_option);
            if (isIntentionAlreadyQueued(intention_queue, key)) continue;
            if (beliefs.invalidOptions.has(key)) continue;
            const my_score = calculateScore(delivery_option, me_pos);
            if (isClaimedByTeammate(key, my_score)) {
                claimed_fallback = claimed_fallback ?? { key, option: delivery_option };
                continue;
            }
            options.set(key, delivery_option);
            claimed_fallback = null; // an unclaimed spot won; drop the fallback
            break;
        }
        if (claimed_fallback) {
            options.set(claimed_fallback.key, claimed_fallback.option);
        }
    }

    if (options.size == 0) {
        // Wander: follow the evolved patrol tour (tourEA). The tour already
        // restricts to the assigned evolved zone when the team partition is active,
        // and covers the whole map when solo. Skip generation entirely while
        // a go_to is already queued: pushing another one would be dropped by
        // intention revision anyway, and advancing the patrol cursor for a
        // target never committed to would skip stops without visiting them.
        const wander_already_queued = intention_queue.some(i => i?.predicate?.[0] === GO_TO);

        if (!wander_already_queued) {
            let candidates = nextPatrolStops()
                .map(id => { const [x, y] = id.split('-').map(Number); return { x, y, id }; });

            if (candidates.length === 0) {
                // Fallback (e.g. map without spawner tiles in the cache yet):
                // farthest-first sweep over all spawners.
                const me_pos = {x: beliefs.me.x, y: beliefs.me.y};
                candidates = [...constantBeliefs.map.parcelSpawners]
                    .map(([x, y]) => ({x, y, id: `${x}-${y}`}))
                    .sort((a, b) => distance(me_pos, b) - distance(me_pos, a));
            }

            // Approaching a loaded teammate while carrying no parcels is how
            // handoffs get triggered (courier walking toward harvester), so
            // the occupied-stop skip below yields in that case.
            const approach_for_handoff =
                (beliefs.teammate.carriedCount ?? 0) > 0 && !(beliefs.me.carried_parcels_count > 0);

            for (const spot of candidates) {
                // Already standing on this stop: a go_to to the current tile
                // completes instantly and gets re-generated repeatedly.
                if (Math.floor(beliefs.me.x) === spot.x && Math.floor(beliefs.me.y) === spot.y) continue;

                // Stop currently occupied by the teammate: they are already
                // observing it, and entering their tile causes collisions.
                if (!approach_for_handoff && mate_pos && Math.floor(mate_pos.x) === spot.x && Math.floor(mate_pos.y) === spot.y) continue;

                const go_to_option = [GO_TO, parseInt(spot.x), parseInt(spot.y)];
                const key = getIntentionKey(go_to_option);
                if (isIntentionAlreadyQueued(intention_queue, key)) continue;
                if (beliefs.invalidOptions.has(key)) continue;
                // Flat score 1 mirrors findBestOption's go_to scoring and
                // IntentionRevision's announceClaim score for wander.
                if (isClaimedByTeammate(key, 1)) continue;
                options.set(key, go_to_option);
                advanceCursor(spot.id);
                break;
            }
        }
    }
    
    // Select the best option
    let best_option = undefined;
    if(options.size > 0) {
        best_option = findBestOption(options.values(), beliefs.me);
    }

    /**
     * Best option is selected
     */
    if (best_option) {
        if(!isIntentionAlreadyQueued(intention_queue, getIntentionKey(best_option))) {
            await newAgent.push(best_option);
        }
    }
}

/**
 * Find the best option to push as intention in the queue
 * @param {[[action: string, x: number, y: number, parcel_id: string]]} options - List of possible intentions
 * @param {Parcel[]} parcels - List of the parcels
 * @param {MeAgent} agent - Agent for which to find the best option
 * @returns {[string, number, number, string]} - Best option
 */
const findBestOption = (options, agent) => {

    debugLog("Finding best option between: ", options);
    let best_option;
    let best_reward = Number.MIN_SAFE_INTEGER;

    // Compare options
    for (const option of options) {
        let option_reward = 0;
        if (option[0] == GO_PICK_UP || option[0] == GO_DELIVER) {
            option_reward = calculateScore(option, { x: agent.x, y: agent.y });
        } else if (option[0] == GO_TO) {
            option_reward = 1;
        }

        debugLog("Option:", option, "Reward:", option_reward);
        if (option_reward >= best_reward) {
            best_reward = option_reward;
            best_option = option;
        }
    }

    debugLog("Best option found:", best_option, "with reward:", best_reward);

    return best_option;
};

/**
 * Calculate risk penalty for a position based on nearby agents
 */

const calculateRiskPenalty = (position) => {
    let penalty = 0;

    const distance_from_me = distance(position, { x: beliefs.me.x, y: beliefs.me.y });

    const now = Date.now();

    for (const [id, opponent_log] of beliefs.otherAgents?.entries() ?? []) {
        // The teammate coordinates via claims and is not considered an opponent.
        if (id === beliefs.teammate.id) continue;

        // Stale sighting: the agent has long since moved on, so its last known
        // position says nothing about who reaches this target first.
        if (now - opponent_log.timestamp > OPPONENT_SIGHTING_FRESHNESS) continue;

        const opponent_distance = distance(position, { x: opponent_log.x, y: opponent_log.y });
        // Only consider agents that are closer to the target than the current agent and within range
        if (opponent_distance < distance_from_me && distance_from_me <= 5) {
            penalty += 10; // Higher penalty for closer agents
        }
    }

    return penalty;
};

/**
 * Calculate a comprehensive score for an intention
 */
const calculateScore = (predicate, agent_pos, failures = undefined) => {

    debugLog("Calculating score for predicate: ", predicate);

    let score = 0;

    let target_pos = { x: predicate[1], y: predicate[2] };
    let failure_penalty_multiplier = 1;

    // Base reward factor
    if (predicate[0] === GO_PICK_UP) {
        const parcel = beliefs.storedParcels.get(predicate[3])?.parcel;
        if (parcel) {

            // Pickup collects EVERY parcel on the tile, so score them all
            // together: sum their rewards and count each one toward the
            // per-parcel decay after pickup.
            let tile_reward = 0;
            let tile_parcels_count = 0;
            for (const { parcel: p } of beliefs.storedParcels.values()) {
                if (Math.floor(p.x) === Math.floor(parcel.x) && Math.floor(p.y) === Math.floor(parcel.y)
                    && (p.id === parcel.id || (!p.carriedBy && p.reward > 0))) {
                    tile_reward += p.reward;
                    tile_parcels_count++;
                }
            }

            let target_reward_at_pickup = getRewardAtDestination(tile_reward, agent_pos, target_pos, tile_parcels_count);
            let carried_reward_at_pickup = getRewardAtDestination(beliefs.me.total_carried_reward, agent_pos, target_pos, beliefs.me.carried_parcels_count);
            let total_reward_at_pickup = target_reward_at_pickup + carried_reward_at_pickup;

            let nearest_delivery_from_parcel = findNearestDeliverySpot(target_pos);
            let total_reward_at_delivery = getRewardAtDestination(total_reward_at_pickup, target_pos, nearest_delivery_from_parcel, beliefs.me.carried_parcels_count + tile_parcels_count);

            // Soft own-zone preference. Both agents rank the shared
            // global parcel list with this same formula, so without a bias
            // they compute the same best parcel and herd toward it. When the
            // evolved partition is active, discount parcels outside the assigned zone:
            // the teammate applies the mirror-image discount, so contested
            // rankings split apart, while a sufficiently valuable out-of-zone parcel can
            // still win. Applied only to a positive reward component (scaling
            // a negative one would make out-of-zone look better), and never
            // to the risk/failure penalties below.
            const parcel_tile = `${Math.floor(predicate[1])}-${Math.floor(predicate[2])}`;
            const in_my_zone = !(beliefs.zones?.mine?.size > 0) || beliefs.zones.mine.has(parcel_tile);
            if (!in_my_zone && total_reward_at_delivery > 0) {
                total_reward_at_delivery *= OUT_OF_ZONE_DISCOUNT;
            }

            // Teammate significantly closer to this parcel (graph distance):
            // discount it — see TEAMMATE_PROXIMITY_DISCOUNT. Applied only to
            // a positive reward component.
            const mate_sighting = beliefs.teammate.id ? beliefs.otherAgents.get(beliefs.teammate.id) : null;
            if (mate_sighting && Date.now() - mate_sighting.timestamp < 5000 && total_reward_at_delivery > 0) {
                const my_dist = distance(agent_pos, target_pos);
                const mate_dist = distance({ x: mate_sighting.x, y: mate_sighting.y }, target_pos);
                if (mate_dist < my_dist / 2) {
                    total_reward_at_delivery *= TEAMMATE_PROXIMITY_DISCOUNT;
                }
            }

            score += total_reward_at_delivery;
        }
        failure_penalty_multiplier = 10;
    } else if (predicate[0] === GO_DELIVER) {

        let total_reward_at_delivery = getRewardAtDestination(beliefs.me.total_carried_reward, agent_pos, target_pos, beliefs.me.carried_parcels_count);

        score += total_reward_at_delivery;
        // The penalty is proportional to the reward lost upon delivery failure.
        // Clamped at 0: once the cargo has decayed past the travel cost the
        // reward goes negative, and a negative multiplier would turn
        // `score -= failures * multiplier` into a bonus (making failed deliveries
        // improperly attractive).
        failure_penalty_multiplier = Math.max(0, total_reward_at_delivery) / 3;
    }

    // Risk factor (penalize if area has many agents)
    const riskPenalty = calculateRiskPenalty(target_pos);
    score -= riskPenalty;

    if (failures !== undefined) {
        // Failure history penalty, valid just for intention
        score -= (failures * failure_penalty_multiplier);
    }

    return score;
};


/**
 * Compare risk level of two intentions
 */
const compareRisk = (intention1, intention2) =>{
    const risk1 = calculateRiskPenalty({ x: intention1.predicate[1], y: intention1.predicate[2] });
    const risk2 = calculateRiskPenalty({ x: intention2.predicate[1], y: intention2.predicate[2] });
    
    if (risk1 < risk2) return -1; // intention1 is safer
    if (risk1 > risk2) return 1;  // intention2 is safer
    return 0;
}

const clearInvalidOptions = () => {
    for (const [key, timestamp] of beliefs.invalidOptions.entries()) {
        const timeSinceInvalid = Date.now() - timestamp;
        if (timeSinceInvalid >= 10000) { // 10 seconds cooldown
            beliefs.invalidOptions.delete(key);
        }
    }
}


export { optionsGeneration, calculateScore, compareRisk };