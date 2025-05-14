import dijkstra from 'graphology-shortest-path';
import { mapGraph, deliverySpots, parcelSpawners } from './belief/index.js';

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

/**
 * Function to evaluate a pickup intention
 * @param {number} reward - Parcel reward
 * @param {{x:number, y:number}} current_pos - Current position of the agent
 * @param {{x:number, y:number}} target_pos_1 - Intermediate target position
 * @param {{x:number, y:number}} target_pos_2 - Final target position 
 * @returns {number} - The effective reward to pick up the parcel
 */
/**
 * TODO: 
 * FinalReward = Reward - [(movement_speed/parcel_decading_interval) * ((distance_agent_to_parcel + distance_parcel_to_delivery)/movement_steps)]
 */
const realPickupReward = (reward, current_pos, target_pos_1, target_pos_2) => {
    const distance_1 = distance(current_pos, target_pos_1);
    const distance_2 = distance(target_pos_1, target_pos_2);

    return reward - distance_1 - distance_2
}

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
 * Find the best option to push as intention in the queue
 * @param {[string, number, number, string]} options - List of possible intentions
 * @param {{x:number, y:number}} agent - The current position of the agent (could be "me" or some "opponents agent")
 * @returns {*} - Best option
 */
const findBestOption = (options, agent) => {
    let best_option;
    let nearest = Number.MAX_VALUE;
    for (const option of options) {
        if(option[0] == 'go_pick_up') {
            const [, x, y] = option;
            console.log("me", agent)
            const current_d = distance({x, y}, agent);
            console.log("DISTANCE", current_d)
            if (current_d < nearest) {
                best_option = option;
                nearest = current_d;
            }
        } else if (option[0] == 'go_deliver') {
            best_option = option;
        } else if (option[0] == 'go_to') {
            best_option = option;
        }
    }

    return best_option
}

// export function distance( {x:x1, y:y1}, {x:x2, y:y2}) {
//     const dx = Math.abs( Math.round(x1) - Math.round(x2) )
//     const dy = Math.abs( Math.round(y1) - Math.round(y2) )
//     return dx + dy;
// }

export { distance, realPickupReward, findNearestDeliverySpot, findFarthestParcelSpawner, findBestOption };