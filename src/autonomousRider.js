import { Agent, getMapConfig, processMapData, updateCarryingParcels, updateInfoAgent, updateParcelsPerceived } from "./agent/index.js";
import { client } from "./config/index.js";
import { optionsGeneration } from "./reasoning/utilsOptions.js";
    
console.log("Start...")

// Create an instance of Agent
const newAgent = new Agent();

/**
 * Belief revision
 */
client.onConfig(config => getMapConfig(config));
client.onMap((width, height, data) => processMapData(width, height, data));
client.onYou(( {id, name, x, y, score} ) => updateInfoAgent({id, name, x, y, score}));
client.onParcelsSensing(async (parcels) => {
    await updateParcelsPerceived(parcels);
    await updateCarryingParcels(parcels);
});

/**
 * Generate options at every sensing event
 */
client.onParcelsSensing( optionsGeneration );
client.onAgentsSensing( optionsGeneration );
client.onYou( optionsGeneration );

// Function to trigger the agent when parcels are sensed 
newAgent.start();



export {newAgent};



