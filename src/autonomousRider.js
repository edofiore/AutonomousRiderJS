import { updateInfoOtherAgents } from "./agent/beliefs/otherAgents.js";
import { Agent, getMapConfig, processMapData, updateInfoAgent, updatePerceivedParcels, optionsGeneration } from "./agent/index.js";
import { client } from "./config/index.js";
    
console.log("Start...")

// Create an instance of Agent
const newAgent = new Agent();

let initialized = false;

const received = {
    config: false,
    map: false,
    you: false,
    parcels: false,
    agents: false
};

let resolveInitialization;
const initializationPromise = new Promise(res => {
    resolveInitialization = res;
});

function checkAllReceived() {
    if (Object.values(received).every(Boolean)) {
        resolveInitialization();
    }
}

client.onConfig(config => {
    getMapConfig(config);
    received.config = true;
    checkAllReceived();
});

client.onMap((width, height, data) => {
    processMapData(width, height, data);
    received.map = true;
    checkAllReceived();
});

client.onYou(({ id, name, x, y, score }) => {
    const updated = updateInfoAgent({ id, name, x, y, score });
    if (updated) {
        received.you = true;
        checkAllReceived();
    }
});

client.onParcelsSensing(async (parcels) => {
    await updatePerceivedParcels(parcels);
    received.parcels = true;
    checkAllReceived();

    if (!initialized) return;

    try {
        await optionsGeneration();
    } catch (e) {
        console.log('optionsGeneration error on parcels:', e);
    }
});

client.onAgentsSensing(async (agents) => {
    updateInfoOtherAgents(agents);
    received.agents = true;
    checkAllReceived();

    if (!initialized) return;

    try {
        await optionsGeneration();
    } catch (e) {
        console.log('optionsGeneration error on agents:', e);
    }
});

/**
 * Initialization: wait for all necessary data to be received before starting the agent
 */
await Promise.race([
    initializationPromise,
    new Promise((_, reject) => 
        setTimeout(() => reject('Initialization timeout'), 10000)
    )
]);

initialized = true;

// Function to trigger the agent when parcels are sensed 
newAgent.start();

export {newAgent};



