import dijkstra from 'graphology-shortest-path';
// Import only the variables that never will change during the execution
import { mapGraph, deliverySpots, parcelSpawners, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI } from './belief/index.js';

const GO_TO = "go_to"
const GO_PICK_UP = "go_pick_up"
const GO_DELIVER = "go_deliver"

/**
 * Function to compute the distance (number of cells/steps) between 2 cells
 * @param {{x:number, y:number}} current_pos - Current Position
 * @param {{x:number, y:number}} target_pos - Target Position
 * @returns {number} - The distance between two tiles
 */
const distance = ( current_pos, target_pos ) => {
    // console.log("{x1: %\i, y1: %\i}, {x2: %\i, y2: %\i}", x1, y1, x2, y2)
    
    if(current_pos.x != undefined && current_pos.y != undefined && target_pos.x != undefined && target_pos.y != undefined) {
        let path = dijkstra.bidirectional(mapGraph, Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y), Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y))
        // console.log("PATHHHHHH", path)
    
        if(!path){
            if(mapGraph.hasNode(Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y)) && mapGraph.hasNode(Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y))){
                console.log("WRONG POSITIONS:", Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y), Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y));
            }
            return Number.MAX_VALUE;
        }
        
        return path.length - 1;
    }
}

// const getTotalReward = (parcels, agent_id) => {
//     let total_reward = 0;
//     console.log("PARCELSSSS", parcels)
    
//     // TODO: parcels will be a map, so check if we are iterating correctly

//     parcels.forEach((p) => {
//         if(p.carriedBy == agent_id) {
//             console.log("SINGLE REWARD", p.reward)
//             total_reward += p.reward}
//     })

//     return total_reward;
// }

/**
 * Find the nearest delivery zone
 * @param {{x:number, y:number}} agent - The current position of the agent (could be "me" or some "opponents agent")
 * @returns {{x:number, y:number}} - The nearest delivery zone
 */
const findNearestDeliverySpot = (agent) => {
    let nearestDeliver = Number.MAX_VALUE;
    let best_spot = [];
    for (const deliverySpot of deliverySpots) {
        let current_d = distance( {x:parseInt(deliverySpot[0]), y:parseInt(deliverySpot[1])}, agent )
        if ( current_d < nearestDeliver ) {
            best_spot = deliverySpot;
            nearestDeliver = current_d
        }
    }

    return best_spot
}

/**
 * Find the farthest parcels spawner. 
 * It is useful when are not parcels perceived and the agent is not bring parcels, so he has to move around the map.
 * @param {{x:number, y:number}} agent - The current position of the agent (could be "me" or some "opponents agent")
 * @returns {{x:number, y:number}} - The farthest parcels spawner
 */
const findFarthestParcelSpawner = (agent) => {
    let farthestDeliver = Number.MIN_VALUE;
    let best_spot = [];
    for (const spawn of parcelSpawners) {
        let current_d = distance( {x:parseInt(spawn[0]), y:parseInt(spawn[1])}, agent )
        if ( current_d > farthestDeliver ) {
            best_spot = spawn;
            farthestDeliver = current_d
        }
    }

    return best_spot
}

/**
 * Function to calculate the final reward at the end of a movement
 * @param {number} reward - Total reward the agent will carry
 * @param {number} movement_duration - 
 * @param {number} movement_steps - 
 * @param {number} parcel_decading_interval - 
 * @param {number} distance_to_delivery - Current position of the agent
 * @param {number} [distance_to_parcel = 0] - Optional intermediate target position
 * @returns {number} - The effective reward to do an intention
 */
const computeFinalReward = (reward, movement_duration, movement_steps, parcel_decading_interval, distance_to_delivery, distance_to_parcel = 0) => {

    // Check if the variable is a number, otherwise convert it
    if(typeof parcel_decading_interval != "number")
        parcel_decading_interval = parseInt(parcel_decading_interval)

    // Calculate the amount of loss of the reward at each agent movement
    const ratio_time = movement_duration/(parcel_decading_interval*1000); // ms
    // Calculate the effective distance of the agent to the final destination, considering also the number of steps for movement
    const effective_distance = (distance_to_delivery + distance_to_parcel) / movement_steps;
    // Compute the final reward
    const final_reward = reward - (ratio_time * effective_distance);

    // console.log("FINAL REWARD", final_reward)

    return final_reward
}

/**
 * Get the final reward for a deliver intention
 * @param {number} reward - Parcel reward or total reward
 * @param {number} movement_duration 
 * @param {number} movement_steps 
 * @param {number} parcel_decading_interval 
 * @param {{x:number, y:number}} agent - Current agent position
 * @param {{x:number, y:number}} delivery_pos - Delivery spot position
 * @returns {number} - final_reward
 */
const getDeliverFinalReward = (reward, movement_duration, movement_steps, parcel_decading_interval, agent, delivery_pos) => {
    
    // Compute the distance between the agent current position and the delivery spot
    const distance_to_delivery_spot = distance(agent, delivery_pos);
    // Calculate final rewardt
    const final_reward = computeFinalReward(
        reward, movement_duration, movement_steps, parcel_decading_interval, distance_to_delivery_spot
    );
    
    return final_reward
}

/**
 * Get the final reward for a pickup intention
 * @param {number} agent_reward - Total reward agent is carrying
 * @param {number} parcel_reward - Parcel reward 
 * @param {number} movement_duration 
 * @param {number} movement_steps 
 * @param {number} parcel_decading_interval 
 * @param {{x:number, y:number}} agent - Current agent position
 * @param {{x:number, y:number}} parcel_pos - Parcel position to pick up
 * @returns {number} - final_reward
 */
const getPickupFinalReward = (agent_reward, parcel_reward, movement_duration, movement_steps, parcel_decading_interval, agent, parcel_pos) => {

    // Find the nearest delivery spot to the parcel the agent would pick up
    const nearest_delivery = findNearestDeliverySpot(parcel_pos); 

    // Compute the distance agent current position to the parcel
    const distance_agent_to_parcel = distance(agent, parcel_pos);
    // Compute the distance agent future position to the delivery spot
    const distance_parcel_to_delivery = distance(parcel_pos, nearest_delivery);
    // Calculate final reward
    const final_reward = computeFinalReward(
        agent_reward + parcel_reward, movement_duration, movement_steps, parcel_decading_interval, distance_agent_to_parcel, distance_parcel_to_delivery
    );
    
    return final_reward
}

/**
 * Get the final reward of a specified intention
 * @param {string} intention_type - Intention type
 * @param {number} agent_reward - Reward the agent is carrying
 * @param {number} movement_duration 
 * @param {number} movement_steps 
 * @param {number} parcel_decading_interval 
 * @param {{x:number, y:number}} agent - Current agent position
 * @param {{x:number, y:number}} parcel_pos - Parcel position to pick up
 * @param {number} [parcel_reward = 0] - Parcel reward 
 * @returns {number} - final_reward
 */
const getFinalReward = (intention_type, agent_reward, movement_duration, movement_steps, parcel_decading_interval, agent, target_pos, parcel_reward = 0) => {
    
    let final_reward = 0;
    if(intention_type == GO_PICK_UP)
        final_reward = getPickupFinalReward(agent_reward, parcel_reward, movement_duration, movement_steps, parcel_decading_interval, agent, target_pos);
    else if (intention_type == GO_DELIVER) 
        final_reward = getDeliverFinalReward(agent_reward, movement_duration, movement_steps, parcel_decading_interval, agent, target_pos);

    return final_reward
}


/**
 * Find the best option to push as intention in the queue
 * @param {[[type: string, x: number, y: number, parcel_id: string]]} options - List of possible intentions
 * @param {[{id: string, carriedBy?: string, x:number, y:number, reward:number}]} parcels - List of the parcels
 * @param {{id:string, name:string, x:number, y:number, score:number, parcelsImCarrying:number, carriedReward:number}} agent - Agent for which to find the best option 
 * @returns {[string, number, number, string]} - Best option
 */
const findBestOption = (options, parcels, agent) => {
    let best_option;
    // let nearest = Number.MAX_VALUE;

    let biggest_reward = Number.MIN_VALUE;

    for (const option of options) {
        if(option[0] == GO_PICK_UP) {
            const [, x, y, p_id] = option;
            const agent_pos = {x: agent.x, y: agent.y}
            // console.log("me", agent)
            // const current_d = distance({x, y}, agent);
            // console.log("DISTANCE", current_d)
            // if (current_d < nearest) {
            //     best_option = option;
            //     nearest = current_d;
            // }

            const parcel = parcels.get(p_id);
            // const nearest_delivery = findNearestDeliverySpot({x, y});
            // const final_reward = getFinalReward(
            //     parcel.reward, MOVEMENT_DURATION, MOVEMENT_STEPS, parseInt(PDI),
            //     agent, {x, y}, {x:parseInt(nearest_delivery[0]), y:parseInt(nearest_delivery[1])},
            // );

            const final_reward = getFinalReward(option[0], agent.carriedReward, MOVEMENT_DURATION, MOVEMENT_STEPS, parseInt(PDI), agent_pos, {x, y}, parcel.reward);
            // console.log("final_reward")
            
            if (final_reward > biggest_reward) {
                best_option = option;
                biggest_reward = final_reward;
            }

        } else if (option[0] == GO_DELIVER) {
            best_option = option;
        } else if (option[0] == GO_TO) {
            best_option = option;
        }
    }

    return best_option
}

/**
 * Compare two intentions to decide if swap them
 * @param {*} intention_1 
 * @param {*} intention_2 
 * @param {*} agent 
 * @param {*} movement_duration 
 * @param {*} movement_steps 
 * @param {*} parcel_decading_interval 
 * @param {Map< string, {id: string, carriedBy?: string, x:number, y:number, reward:number} >} parcels 
 * @returns 
 */
const swapIntentions = (intention_1, intention_2, agent, movement_duration, movement_steps, parcel_decading_interval, parcels = null) => {
    const agent_pos = {x: agent.x, y: agent.y}
    let target_pos_1;
    // let parcel_pos_1;
    let reward_parcel_1;
    let target_pos_2;
    // let parcel_pos_2;
    let reward_parcel_2;
    
    // If the first intention is "go_deliver"
    if(intention_1.predicate[0] == GO_DELIVER) {
        target_pos_1 = {x: intention_1.predicate[1], y: intention_1.predicate[2]}
    // else if it is "go_pick_up"
    } else if(intention_1.predicate[0] == GO_PICK_UP) {
        target_pos_1 = {x: intention_1.predicate[1], y: intention_1.predicate[2]}
        reward_parcel_1 = parcels.get(intention_1.predicate[3]).reward ?? 0
    }

    // If the second intention is "go_deliver"
    if(intention_2.predicate[0] == GO_DELIVER) {
        target_pos_2 = {x: intention_2.predicate[1], y: intention_2.predicate[2]}
        reward_parcel_2 = parcels.get(intention_2.predicate[3]).reward ?? 0
    // else if it is "go_pick_up"
    } else if(intention_2.predicate[0] == GO_PICK_UP) {
        target_pos_2 = {x: intention_2.predicate[1], y: intention_2.predicate[2]}
    }

    // Get the final rewards for the two intentions
    const intention_1_final_reward = getFinalReward(intention_1.predicate[0], agent.carriedReward, movement_duration, 
        movement_steps, parcel_decading_interval, agent_pos, target_pos_1, reward_parcel_1);
    const intention_2_final_reward = getFinalReward(intention_2.predicate[0], agent.carriedReward, movement_duration, 
        movement_steps, parcel_decading_interval, agent_pos, target_pos_2, reward_parcel_2);

    // Return TRUE if the second reward is bigger, otherwise FALSE
    return (intention_2_final_reward > intention_1_final_reward)
}

export { GO_TO, GO_PICK_UP, GO_DELIVER, distance, computeFinalReward, getPickupFinalReward, getDeliverFinalReward, getFinalReward, 
    findNearestDeliverySpot, findFarthestParcelSpawner, findBestOption, swapIntentions };