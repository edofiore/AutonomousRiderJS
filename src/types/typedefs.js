/**
 * @global
 * @typedef {'1s' | '2s' | '5s' | '10s'} Interval
 */


/**
 * Config type configuration
 * @global
 * @typedef {Object} Config
 * @property {number} MOVEMENT_DURATION - Movement duration in ms
 * @property {number} MOVEMENT_STEPS - Number of movement steps (e.g., 1 intermediate at 0.6)
 * @property {number | 'infinite'} AOD - AGENTS_OBSERVATION_DISTANCE (number or 'infinite')
 * @property {number | 'infinite'} POD - PARCELS_OBSERVATION_DISTANCE (number or 'infinite')
 * @property {Interval | 'infinite'} PDI - PARCEL_DECADING_INTERVAL
 * @property {Interval} PGI - PARCELS_GENERATION_INTERVAL
 * @property {number} PRA - PARCEL_REWARD_AVG
 * @property {number} PRV - PARCEL_REWARD_VARIANCE
 * @property {number | 'infinite'} PARCELS_MAX - Maximum number of parcels or 'infinite'
 * @property {number} PDR - PARCEL_DECAY_RATE
 */

/**
 * TODO:
 * - add options/intentions type
 * - 
 */

/**
 * @global
 * @typedef {Object} Agent
 * @property {string} id - Unique agent identifier
 * @property {string} name - Agent name
 * @property {number} x - X coordinate
 * @property {number} y - Y coordinate
 * @property {number} score - Agent score
 */

/**
 * @global
 * @typedef {Agent} MeAgent
 * @property {number} carried_parcels_count - Number of parcels the agent is carrying
 * @property {number} total_carried_reward - Total reward of carried parcels
 */

/**
 * @global
 * @typedef {MeAgent} OtherAgent
 * 
 */

/**
 * @global
 * @typedef {Object} Parcel
 * @property {string} id - Unique parcel identifier
 * @property {string} [carriedBy] - ID of the agent carrying it (if any)
 * @property {number} x - X coordinate
 * @property {number} y - Y coordinate
 * @property {number} reward - Reward value of the parcel
 */

/**
 * @global
 * @typedef {Object} Beliefs
 * @property {MeAgent} me - The agent's own data
 * @property {Map<string, Parcel>} storedParcels - A map of all known parcels
 * @property {Map<string, Agent[]>} otherAgents - Other agents indexed by ID
 * @property {*} tmpBlockedTiles - Tiles temporally blocked by other agents
 */

/**
 * @global
 * @typedef {Object} ConstantBeliefs
 * @property {Config} config
 * @property {{
 *   mapGraph: import("graphology").UndirectedGraph,
 *   deliverySpots: string[],
 *   parcelSpawners: string[]
 * }} map
 */

/**
 * @global
 * @typedef {[string, number, number, (string|undefined)]} Option
 * - [0] action: Type of action ('go_to', 'go_pick_up', 'go_deliver')
 * - [1] x: X coordinate
 * - [2] y: Y coordinate
 * - [3] parcel_id: Parcel ID (optional)
 */