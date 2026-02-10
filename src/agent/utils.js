import dijkstra from 'graphology-shortest-path';
// Import only the variables that never will change during the execution
import { constantBeliefs } from './index.js';

const GO_TO = "go_to";
const GO_PICK_UP = "go_pick_up";
const GO_DELIVER = "go_deliver";
const BLOCKED_TILES = 0;    // '0' are blocked tiles (empty or not_tile)
const WALKABLE_SPAWNING_TILES = 1;  // '1' are walkable spawning tiles
const DELIVERABLE_TILES = 2;    // '2' are delivery tiles
const WALKABLE_TILES = 3;   // '3' are walkable non-spawning tiles

/**
 * Function to compute the distance (number of cells/steps) between 2 cells
 * @param {{x:number, y:number}} current_pos - Current Position
 * @param {{x:number, y:number}} target_pos - Target Position
 * @returns {number} - The distance between two tiles
 */
const distance = ( current_pos, target_pos ) => {
    // console.log("{x1: %\i, y1: %\i}, {x2: %\i, y2: %\i}", x1, y1, x2, y2)
    
    if(current_pos.x != undefined && current_pos.y != undefined && target_pos.x != undefined && target_pos.y != undefined) {
        let path = dijkstra.bidirectional(constantBeliefs.map.mapGraph, Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y), Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y))
    
        if(!path){
            if(constantBeliefs.map.mapGraph.hasNode(Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y)) && constantBeliefs.map.mapGraph.hasNode(Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y))){
                console.log("WRONG POSITIONS:", Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y), Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y));
            }
            return Number.MAX_VALUE;
        }
        
        return path.length - 1;
    } else {
        throw ['Some coordinates were undefined', current_pos, target_pos];
    }
}

/**
 * Find the nearest delivery zone
 * @param {{x:number, y:number}} current_pos - The current position of the agent (could be "me" or some "opponents agent")
 * @returns {{x:number, y:number}} - The nearest delivery zone
 */
const findNearestDeliverySpot = (current_pos) => {
    let nearestDeliver = Number.MAX_VALUE;
    let best_spot = [];
    for (const deliverySpot of constantBeliefs.map.deliverySpots) {
        let current_d = distance( {x:parseInt(deliverySpot[0]), y:parseInt(deliverySpot[1])}, current_pos )
        if ( current_d < nearestDeliver ) {
            best_spot = deliverySpot;
            nearestDeliver = current_d
        }
    }

    return { x:best_spot[0], y:best_spot[1] }; // Return an object with x and y properties
}

/**
 * Find the farthest parcels spawner. 
 * It is useful when are not parcels perceived and the agent is not bring parcels, so he has to move around the map.
 * @param {{x:number, y:number}} agent - The current position of the agent (could be "me" or some "opponents agent")
 * @returns {{x:number, y:number}} - The farthest parcels spawner
 */
const findFurthestParcelSpawner = (agent) => {
    let furthestDeliver = 0;
    let best_spot = [];
    for (const spawn of constantBeliefs.map.parcelSpawners) {
        let current_d = distance( {x:parseInt(spawn[0]), y:parseInt(spawn[1])}, agent )
        if ( current_d > furthestDeliver ) {
            best_spot = spawn;
            furthestDeliver = current_d
        }
    }

    return { x:best_spot[0], y:best_spot[1] }; // Return an object with x and y properties
}

const getRewardAtDestination = (initial_reward, starting_pos, destination, n_parcels = 1) => {
    return initial_reward - n_parcels * (constantBeliefs.config.PDR * distance(starting_pos, destination));
}

/**
 * Compare urgency of two intentions
 */
const compareUrgency = (intention1, intention2) =>{
    // Delivery is generally more urgent when carrying parcels
    if (intention1.predicate[0] === GO_DELIVER && intention2.predicate[0] !== GO_DELIVER) {
        return beliefs.me.carried_parcels_count > 0 ? -1 : 0;
    }
    if (intention2.predicate[0] === GO_DELIVER && intention1.predicate[0] !== GO_DELIVER) {
        return beliefs.me.carried_parcels_count > 0 ? 1 : 0;
    }
    return 0;
}

/**
 * Generate a unique key for an intention (for failure tracking)
 * @param {Array} predicate - The intention predicate
 * @returns {string} Unique key for the intention
 */
const getIntentionKey = (predicate) => {
    if (predicate[0] === GO_PICK_UP && predicate[3]) {
        return `${predicate[0]}-${predicate[3]}`; // Include parcel_id
    }
    return `${predicate[0]}-${predicate[1]}-${predicate[2]}`;
}

const isIntentionAlreadyQueued = (intention_queue, intentionKey) =>{
    return intention_queue.find((i) => getIntentionKey(i.predicate) == intentionKey);
}

export { 
    GO_TO, GO_PICK_UP, GO_DELIVER, BLOCKED_TILES, WALKABLE_SPAWNING_TILES, DELIVERABLE_TILES, WALKABLE_TILES, 
    distance, findNearestDeliverySpot, findFurthestParcelSpawner, getRewardAtDestination, compareUrgency, isIntentionAlreadyQueued, getIntentionKey};