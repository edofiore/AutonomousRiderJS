import { updateInfoOtherAgents } from "./agent/beliefs/otherAgents.js";
import { Agent, getMapConfig, processMapData, updateInfoAgent, updatePerceivedParcels, optionsGeneration } from "./agent/index.js";
import { client } from "./config/index.js";
    
console.log("Start...")

// Create an instance of Agent
const newAgent = new Agent();

/**
 * Initialization: wait for all necessary data to be received before starting the agent
 */
await Promise.race([
    new Promise(res => {
        let received = {
            config: false,
            map: false,
            you: false,
            parcels: false,
            agents: false
        };

        function checkAllReceived() {
            if (Object.values(received).every(Boolean)) res();
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
            updateInfoAgent({ id, name, x, y, score });
            received.you = true;
            checkAllReceived();
        });

        client.onParcelsSensing(async (parcels) => {
            await updatePerceivedParcels(parcels);
            received.parcels = true;
            checkAllReceived();
        });

        client.onAgentsSensing(agents => {
            updateInfoOtherAgents(agents);
            received.agents = true;
            checkAllReceived();
        });
    }),
    new Promise((_, reject) => 
        setTimeout(() => reject('Initialization timeout'), 10000)
    )
]);

/**
 * Generate options at every sensing event
 */

client.onParcelsSensing(async (parcels) => {
    await updatePerceivedParcels(parcels);
    try {
        await optionsGeneration();
    } catch (e) {
        console.log('optionsGeneration error on parcels:', e);
    }
});

client.onAgentsSensing(async (agents) => {
    updateInfoOtherAgents(agents);
    try {
        await optionsGeneration();
    } catch (e) {
        console.log('optionsGeneration error on agents:', e);
    }
});

// Function to trigger the agent when parcels are sensed 
newAgent.start();

export {newAgent};



