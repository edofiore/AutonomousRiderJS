import UndirectedGraph from "graphology";

/**
 * @typedef {Object} Beliefs
 * @property {{ id: string, name: string, x: number, y: number, score: number, parcelsImCarrying: number, carriedReward: number }} me
 * @property {Map<string, { id: string, carriedBy?: string, x: number, y: number, reward: number }>} storedParcels
 * @property {{ [id: string]: { id: string, name: string, x: number, y: number, score: number, parcelsImCarrying: number, carriedReward: number } }} otherAgents
 */

/**
 * @type {Beliefs}
 */
const beliefs = {
    me: {
        id: null, 
        name: null, 
        x: null, 
        y: null, 
        score: null,    // Total score of the agent
        parcelsImCarrying: null,    // Number of parcels the agent is carrying
        carriedReward: null     // Total reward the agent is carrying
    },
    storedParcels: new Map(),
    otherAgents: {},
}

/**
 * @typedef {Object} ConstantBeliefs
 * @property {Object} config
 * @property {{
 *   mapGraph: import("graphology").UndirectedGraph,
 *   deliverySpots: string[],
 *   parcelSpawners: string[]
 * }} map
 */

/**
 * @type {ConstantBeliefs} - constantBeliefs
 */
const constantBeliefs = {
    config: {},
    map: {
        mapGraph: new UndirectedGraph(),
        deliverySpots: [],
        parcelSpawners: [],
    }
}

export { beliefs as Beliefs, constantBeliefs }