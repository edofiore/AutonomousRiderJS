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
        carried_parcel_ids: [],         // Ids of the parcels the agent is carrying
        total_carried_reward: null     // Total reward the agent is carrying
    },
    storedParcels: new Map(), // Map of < parcelId, {{ id, x, y, carriedBy, reward }, timestamp, visible } >
    otherAgents: new Map(), // Map of < agentId, { name, x, y, score, penalty, timestamp, direction } >
    tmpBlockedTiles: [],
    invalidOptions: new Map(), // Map of <intentionKey, timestamp> to keep track of invalid options and avoid generating them

    // --- Multi-agent (Part 2) coordination state ---
    teammate: {
        id: null,       // Deliveroo agent id of the teammate (null until discovered)
        name: null,
        x: null,        // last self-reported position (heartbeat, ~200ms fresh)
        y: null,
        carriedCount: 0,   // self-reported carried parcels
        carriedReward: 0,  // self-reported carried reward
        lastSeen: 0,    // timestamp of the last message received from the teammate
    },
    // Intentions the teammate has committed to (prevents pursuing conflicting targets).
    // Map of < intentionKey, { parcelId, x, y, score, timestamp } >
    teamClaims: new Map(),

    // Evolved map partition (Part 2 strategy). 'mine' contains spawner tile IDs
    // ("x-y") assigned to this agent when idle; null = no partition active
    // (solo mode, no teammate, or map with < 2 spawners).
    zones: {
        version: 0,
        mine: null,
    },

    // True while executing a handoff drop: pauses the intention loop to
    // prevent issuing moves that would cause the server to reject emitPutdown.
    handoffInProgress: false,

    // Timestamp of the last time movement was blocked by the teammate's position.
    // Used to fast-track handoff negotiation instead of repeating blocked move attempts.
    teammateBlockedAt: 0,
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
        PARCELS_MAX: null,   // (number or 'infinite')
        PENALTY: null,   // Penalty for wall/opponent collision
    },
    map: {
        mapGraph: new UndirectedGraph(),
        deliverySpots: [],
        parcelSpawners: [],
    }
}

export { beliefs, constantBeliefs }