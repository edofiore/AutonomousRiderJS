import UndirectedGraph from "graphology";

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
        carried_parcels_count: null,    // Number of parcels the agent is carrying
        total_carried_reward: null     // Total reward the agent is carrying
    },
    storedParcels: new Map(),
    otherAgents: new Map(), // Map of <agentId, [name, x, y, score, penalty, timestamp, direction]>
    tmpBlockedTiles: [],
}


/**
 * @type {ConstantBeliefs} - constantBeliefs
 */
const constantBeliefs = {
    config: {
        MOVEMENT_DURATION: null, // (time in ms)
        MOVEMENT_STEPS: null,   // (1 intermediate at 0.6)
        AOD: null,  // AGENTS_OBSERVATION_DISTANCE (number or 'infinite')
        POD: null,  // PARCELS_OBSERVATION_DISTANCE (number or 'infinite')
        PDI: null,  // PARCEL_DECADING_INTERVAL ('1s', '2s', '5s', '10s', 'infinite')
        PGI: null,  // PARCELS_GENERATION_INTERVAL ('1s', '2s', '5s', '10s')
        PRA: null,  // PARCEL_REWARD_AVG (number)
        PRV: null,  // PARCEL_REWARD_VARIANCE (number)
        PDR: null,  // PARCEL_DECAY_RATE (number)
        PARCELS_MAX: null   // (number or 'infinite')
    },
    map: {
        mapGraph: new UndirectedGraph(),
        deliverySpots: [],
        parcelSpawners: [],
    }
}

export { beliefs, constantBeliefs }