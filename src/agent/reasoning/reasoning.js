import {beliefs, findNearestDeliverySpot, findFurthestParcelSpawner, GO_TO, GO_DELIVER, GO_PICK_UP, isIntentionAlreadyQueued, distance, getRewardAtDestination, getIntentionKey } from "../index.js"
import { newAgent } from "../../autonomousRider.js";


async function optionsGeneration() {

    // const me = beliefs.me;
    const intention_queue = newAgent.intentionRevision.intention_queue;

    /**
     * Options generation
     */
    const options = [];

    // For each
    for (const parcel_data of beliefs.storedParcels.values()) {
        const parcel = parcel_data.parcel;
        /**
         * TODO: use finalReward instead of parcel reward
         */
        if (!parcel.carriedBy && parcel.reward > 0) {    // TODO: Check if this is necessary, at the moment we store only free parcels
            const new_option = [GO_PICK_UP, parcel.x, parcel.y, parcel.id];
            if (!isIntentionAlreadyQueued(intention_queue, getIntentionKey(new_option))) {
                options.push(new_option);
            }
        }
    }

    /**
     * TODO: control the amount of options I'm generating. I'm generating useless options
     * For example, I'm continuosly generating the same option even if I'm already achieving that intention 
     * 
     * Should I know the intention_queue?
     * 
     */
    // This means no parcel are perceived
    // if (beliefs.storedParcels.length == 0) {
    if (options.length == 0 ) {
        // If the agent are bringing some parcels go to deliver
        /**
         * TODO: dovrei calcolare il reward finale? Magari andare a deliverare solo se il final reward fosse > 0? 
         */


        let new_option = null;

        if(intention_queue.length > 0) {
            const start_pos = {x: intention_queue[0].predicate[1], y: intention_queue[0].predicate[2]}

            if(intention_queue[0].predicate[0] == GO_PICK_UP) {
                if(intention_queue[1] == undefined || intention_queue[1].predicate[0] != GO_PICK_UP ) {
                    // TODO: I should pass the position of the last package the agent will take, not the current package
                    // const start_pos = {x: intention_queue[0].predicate[1], y: intention_queue[0].predicate[2]}
                    const best_spot = findNearestDeliverySpot(start_pos);
                    new_option = [GO_DELIVER, parseInt(best_spot.x), parseInt(best_spot.y)];
                    // options.push([GO_DELIVER, parseInt(best_spot[0]), parseInt(best_spot[1])]);
                }
            } else if((intention_queue[0].predicate[0] == GO_TO || intention_queue[0].predicate[0] == GO_DELIVER) && intention_queue[1] == undefined) {
                const start_pos = {x: intention_queue[0].predicate[1], y: intention_queue[0].predicate[2]}
                const best_spot = findFurthestParcelSpawner(start_pos);
                new_option = [GO_TO, parseInt(best_spot.x), parseInt(best_spot.y)];
                // options.push([GO_TO, parseInt(best_spot[0]), parseInt(best_spot[1])]);
            }

        // Otherwise move the agents away to looking for parcels
        } else {
            const best_spot = findFurthestParcelSpawner(beliefs.me);
            new_option = [GO_TO, parseInt(best_spot.x), parseInt(best_spot.y)];
            // options.push([GO_TO, parseInt(best_spot[0]), parseInt(best_spot[1])]);
        }

        if(new_option && !isIntentionAlreadyQueued(intention_queue, new_option)) {
            options.push(new_option);
        } 
    
    }

    // Deliver directly is always an option if I'm carrying parcels
    if(beliefs.me.carried_parcels_count > 0) {
        const best_spot = findNearestDeliverySpot({x: beliefs.me.x, y: beliefs.me.y});
        const delivery_option = [GO_DELIVER, parseInt(best_spot.x), parseInt(best_spot.y)];
        
        if(!isIntentionAlreadyQueued(intention_queue, delivery_option)) {
                options.push(delivery_option);
        } 
    }
    
    console.log("OPTIONS", options)

    /**
     * Options filtering
     */
    
    // Filter the options from the ones already queued as intentions
    // const filtered_options = options.filter(option => isIntentionAlreadyQueued(intention_queue, option))
    // Find the best option
    let best_option = undefined;
    if(options.length > 0) {
        best_option = findBestOption(options, beliefs.me);
    }

    /**
     * Best option is selected
     */
    if (best_option) {
        console.log("BEST OPTION",best_option);
        if(!isIntentionAlreadyQueued(intention_queue, best_option)) {
            await newAgent.push(best_option);
        }
        /**
         * TODO: i should check if an option is already queued before to push it
         */
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

    console.log("CANDIDATES", options);
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

        console.log("Option:", option, "Reward:", option_reward);
        if (option_reward >= best_reward) {
            best_reward = option_reward;
            best_option = option;
        }
    }

    console.log("Best option found:", best_option, "with reward:", best_reward, "options array length:", options.length);

    return best_option;
};

/**
 * Calculate risk penalty for a position based on nearby agents
 */

// TODO we could take into account also the penalty of hitting another agent
const calculateRiskPenalty = (position) => {
    let penalty = 0;

    const distance_from_me = distance(position, { x: beliefs.me.x, y: beliefs.me.y });

    for (const opponent_log of beliefs.otherAgents?.values()) {

        const opponent_distance = distance(position, { x: opponent_log.x, y: opponent_log.y });
        // Only consider agents that are closer to the target than me and within a certain range
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

    console.log("Calculating score for predicate: ", predicate);

    let score = 0;

    let target_pos = { x: predicate[1], y: predicate[2] };
    let failure_penalty_multiplier = 1;

    // Base reward factor
    if (predicate[0] === GO_PICK_UP) {
        const parcel = beliefs.storedParcels.get(predicate[3])?.parcel;
        if (parcel) {

            let target_reward_at_pickup = getRewardAtDestination(parcel.reward, agent_pos, target_pos);
            let carried_reward_at_pickup = getRewardAtDestination(beliefs.me.total_carried_reward, agent_pos, target_pos, beliefs.me.carried_parcels_count);
            let total_reward_at_pickup = target_reward_at_pickup + carried_reward_at_pickup;

            let nearest_delivery_from_parcel = findNearestDeliverySpot(target_pos);
            let total_reward_at_delivery = getRewardAtDestination(total_reward_at_pickup, target_pos, nearest_delivery_from_parcel, beliefs.me.carried_parcels_count + 1);

            score += total_reward_at_delivery;
        }
        failure_penalty_multiplier = 10;
    } else if (predicate[0] === GO_DELIVER) {

        let total_reward_at_delivery = getRewardAtDestination(beliefs.me.total_carried_reward, agent_pos, target_pos, beliefs.me.carried_parcels_count);

        score += total_reward_at_delivery;
        failure_penalty_multiplier = total_reward_at_delivery / 3; // The penalty is proportional to the reward I'm going to lose if I fail to deliver
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

export { optionsGeneration, calculateScore, compareRisk };