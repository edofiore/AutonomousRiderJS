// Import only the variables that never will change during the execution
import { beliefs, constantBeliefs } from './index.js';
import { getDistanceTable } from './planning/spawnerDistances.js';

// Debug logging: the per-tick reasoning chatter (score calculations, option
// ranking, queue dumps) is invaluable when debugging but costs real time in
// normal play — every line is formatted and written, thousands per minute.
// Enable with DEBUG=1. Important events (pickups, deliveries, handoffs,
// failures, [TEAM]/[EA]/[TOUR]) stay on plain console.log.
const DEBUG = process.env.DEBUG === '1';
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

const GO_TO = "go_to";
const GO_PICK_UP = "go_pick_up";
const GO_DELIVER = "go_deliver";
const BLOCKED_TILES = 0;    // '0' are blocked tiles (empty or not_tile)
const WALKABLE_SPAWNING_TILES = 1;  // '1' are walkable spawning tiles
const DELIVERABLE_TILES = 2;    // '2' are delivery tiles
const WALKABLE_TILES = 3;   // '3' are walkable non-spawning tiles

const DEFAULT_STOP_CODE = -1; // Default code for stopped intentions
const QUEUE_SWAP_STOP_CODE = -2; // Special code for intentions stopped due to queue swapping (to avoid counting them as failures in intention revision)

// Canonical error codes used across plans/intention-revision.
const ERROR_CODES = Object.freeze({
    STOPPED: 'stopped',
    INTENTION_STOPPED: 'stopped intention',
    INTENTION_INVALID: 'intention invalidated',
    NO_PLAN: 'no plan satisfied intention',
    BAD_COORDINATES: 'bad coordinates',
    PARCEL_UNAVAILABLE: 'parcel unavailable',
    NOTHING_TO_DELIVER: 'nothing to deliver',
    PATH_UNAVAILABLE: 'path unavailable',
    PATH_BLOCKED: 'path blocked',
    REPLANNING_FAILED: 'replanning failed',
    MOVEMENT_FAILED: 'movement failed'
});

const RETRYABLE_ERROR_CODES = [
    ERROR_CODES.PATH_UNAVAILABLE,
    ERROR_CODES.PATH_BLOCKED,
    ERROR_CODES.REPLANNING_FAILED,
    ERROR_CODES.MOVEMENT_FAILED
];

const getErrorCode = (error) => Array.isArray(error) ? error[0] : undefined;
const getErrorStopCode = (error) => Array.isArray(error) ? error[1] : undefined;
const isInterruptionError = (error) => {
    const code = getErrorCode(error);
    return code === ERROR_CODES.STOPPED || code === ERROR_CODES.INTENTION_STOPPED;
}

/**
 * Function to compute the distance (number of cells/steps) between 2 cells
 * @param {{x:number, y:number}} current_pos - Current Position
 * @param {{x:number, y:number}} target_pos - Target Position
 * @returns {number} - The distance between two tiles
 */
const distance = ( current_pos, target_pos ) => {
    if(current_pos.x != undefined && current_pos.y != undefined && target_pos.x != undefined && target_pos.y != undefined) {
        // O(1) lookup in a lazily-built BFS table keyed on the TARGET tile
        // (targets — parcels, delivery spots, teammates — repeat constantly;
        // the graph is undirected so from/to are interchangeable). This
        // replaced a full Dijkstra per call: the scoring pipeline makes
        // hundreds of distance() calls per options tick, which used to cost
        // ~100 ms of event-loop time per tick and made the agents sluggish.
        const from = Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y);
        const to = Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y);

        const table = getDistanceTable(to);
        if (!table) return Number.MAX_VALUE; // target isn't a walkable tile

        const d = table.get(from);
        return d === undefined ? Number.MAX_VALUE : d; // undefined: unreachable (different component)
    } else {
        console.log('BAD_COORDS stack:', new Error().stack.split('\n').slice(1,6).join(' | '));
        throw [ERROR_CODES.BAD_COORDINATES, current_pos, target_pos];
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
    DEFAULT_STOP_CODE, QUEUE_SWAP_STOP_CODE,
    ERROR_CODES,
    RETRYABLE_ERROR_CODES, getErrorCode, getErrorStopCode, isInterruptionError,
    DEBUG, debugLog,
    distance, findNearestDeliverySpot, findFurthestParcelSpawner, getRewardAtDestination, compareUrgency, isIntentionAlreadyQueued, getIntentionKey};