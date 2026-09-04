// Import constant beliefs and distance table helper
import { beliefs, constantBeliefs } from './index.js';
import { getDistanceTable } from './planning/spawnerDistances.js';

// Debug logging (enable with DEBUG=1)
const DEBUG = process.env.DEBUG === '1';
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

const GO_TO = "go_to";
const GO_PICK_UP = "go_pick_up";
const GO_DELIVER = "go_deliver";
const BLOCKED_TILES = 0;    // Blocked tiles (empty or not_tile)
const WALKABLE_SPAWNING_TILES = 1;  // Walkable spawning tiles
const DELIVERABLE_TILES = 2;    // Delivery tiles
const WALKABLE_TILES = 3;   // Walkable non-spawning tiles

const DEFAULT_STOP_CODE = -1; // Default code for stopped intentions
const QUEUE_SWAP_STOP_CODE = -2; // Special code for intentions stopped due to queue swapping (to avoid counting them as failures in intention revision)
const INVALID_STOP_CODE = -3; // Head intention stopped because its target became invalid mid-execution

const STOP_CODE_LABELS = Object.freeze({
    [DEFAULT_STOP_CODE]: 'unspecified',
    [QUEUE_SWAP_STOP_CODE]: 'queue swap',
    [INVALID_STOP_CODE]: 'intention invalidated'
});

/**
 * Format a stop code for logging
 * @param {number|undefined} code
 * @returns {string}
 */
const describeStopCode = (code) => {
    const resolved = code || DEFAULT_STOP_CODE;
    return `${STOP_CODE_LABELS[resolved] || 'unknown'} (${resolved})`;
}

// Canonical error codes used across plans and intention revision
const ERROR_CODES = Object.freeze({
    STOPPED: 'stopped',
    INTENTION_STOPPED: 'stopped intention',
    INTENTION_INVALID: 'intention invalidated',
    NO_PLAN: 'no plan satisfied intention',
    BAD_COORDINATES: 'bad coordinates',
    PARCEL_UNAVAILABLE: 'parcel unavailable',
    NOTHING_TO_DELIVER: 'nothing to deliver',
    DELIVERY_FAILED: 'delivery failed',
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
 * Compute shortest distance between 2 positions using BFS distance table
 * @param {{x:number, y:number}} current_pos
 * @param {{x:number, y:number}} target_pos
 * @returns {number}
 */
const distance = ( current_pos, target_pos ) => {
    if(current_pos.x != undefined && current_pos.y != undefined && target_pos.x != undefined && target_pos.y != undefined) {
        // O(1) lookup in precomputed BFS table
        const from = Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y);
        const to = Math.floor(target_pos.x) + "-" + Math.floor(target_pos.y);

        const table = getDistanceTable(to);
        if (!table) return Number.MAX_VALUE; // Target tile is not walkable

        const d = table.get(from);
        return d === undefined ? Number.MAX_VALUE : d;
    } else {
        console.log('BAD_COORDS stack:', new Error().stack.split('\n').slice(1,6).join(' | '));
        throw [ERROR_CODES.BAD_COORDINATES, current_pos, target_pos];
    }
}

/**
 * Find the nearest delivery spot
 * @param {{x:number, y:number}} current_pos
 * @returns {{x:number, y:number}}
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

    return { x:best_spot[0], y:best_spot[1] };
}

/**
 * Find the farthest parcel spawner
 * @param {{x:number, y:number}} agent
 * @returns {{x:number, y:number}}
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

    return { x:best_spot[0], y:best_spot[1] };
}

const getRewardAtDestination = (initial_reward, starting_pos, destination, n_parcels = 1) => {
    return initial_reward - n_parcels * (constantBeliefs.config.PDR * distance(starting_pos, destination));
}

/**
 * Compare urgency of two intentions
 */
const compareUrgency = (intention1, intention2) =>{
    if (intention1.predicate[0] === GO_DELIVER && intention2.predicate[0] !== GO_DELIVER) {
        return beliefs.me.carried_parcels_count > 0 ? -1 : 0;
    }
    if (intention2.predicate[0] === GO_DELIVER && intention1.predicate[0] !== GO_DELIVER) {
        return beliefs.me.carried_parcels_count > 0 ? 1 : 0;
    }
    return 0;
}

/**
 * Generate a unique key for an intention
 * @param {Array} predicate
 * @returns {string}
 */
const getIntentionKey = (predicate) => {
    if (predicate[0] === GO_PICK_UP && predicate[3]) {
        return `${predicate[0]}-${predicate[3]}`;
    }
    return `${predicate[0]}-${predicate[1]}-${predicate[2]}`;
}

const isIntentionAlreadyQueued = (intention_queue, intentionKey) =>{
    return intention_queue.find((i) => getIntentionKey(i.predicate) == intentionKey);
}

export {
    GO_TO, GO_PICK_UP, GO_DELIVER, BLOCKED_TILES, WALKABLE_SPAWNING_TILES, DELIVERABLE_TILES, WALKABLE_TILES,
    DEFAULT_STOP_CODE, QUEUE_SWAP_STOP_CODE, INVALID_STOP_CODE, STOP_CODE_LABELS, describeStopCode,
    ERROR_CODES,
    RETRYABLE_ERROR_CODES, getErrorCode, getErrorStopCode, isInterruptionError,
    DEBUG, debugLog,
    distance, findNearestDeliverySpot, findFurthestParcelSpawner, getRewardAtDestination, compareUrgency, isIntentionAlreadyQueued, getIntentionKey};
