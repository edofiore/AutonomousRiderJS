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
        score: null,
        carried_parcels_count: null,
        total_carried_reward: null
    },
    storedParcels: new Map(), // Map of < parcelId, { parcel, timestamp, visible } >
    otherAgents: new Map(),   // Map of < agentId, { name, x, y, score, penalty, timestamp, direction } >
    tmpBlockedTiles: [],
    invalidOptions: new Map(), // Map of < intentionKey, timestamp >
}

/**
 * @type {ConstantBeliefs}
 */
const constantBeliefs = {
    config: {
        MOVEMENT_DURATION: null, // ms
        MOVEMENT_STEPS: null,    // 1 intermediate at 0.6
        AOD: null,               // AGENTS_OBSERVATION_DISTANCE (number or 'infinite')
        POD: null,               // PARCELS_OBSERVATION_DISTANCE (number or 'infinite')
        PDI: null,               // PARCEL_DECADING_INTERVAL in seconds ('1s', '2s', '5s', '10s', 'infinite')
        PGI: null,               // PARCELS_GENERATION_INTERVAL in seconds
        PRA: null,               // PARCEL_REWARD_AVG
        PRV: null,               // PARCEL_REWARD_VARIANCE
        PDR: null,               // PARCEL_DECAY_RATE per movement step
        PARCELS_MAX: null,       // number or 'infinite'
        PENALTY: null,           // penalty for wall/opponent collision
    },
    map: {
        mapGraph: new UndirectedGraph(),
        deliverySpots: [],
        parcelSpawners: [],
    }
}

export { beliefs, constantBeliefs }
