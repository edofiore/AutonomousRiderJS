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
client.onMap(( width, height, data ) => processMapData(width, height, data));
client.onYou(( {id, name, x, y, score} ) => updateInfoAgent({id, name, x, y, score}));
client.onParcelsSensing(async ( parcels ) => {
    await updateParcelsPerceived(parcels);
    await updateCarryingParcels(parcels);
});

/**
 * Generate options at every sensing event
 */
setInterval(() => {
    client.onParcelsSensing( async () => await optionsGeneration() );
    client.onAgentsSensing( async () => await optionsGeneration() );
    client.onYou( async () => await optionsGeneration() );
    }, [1000]
)

// Function to trigger the agent when parcels are sensed 
newAgent.start();



export {newAgent};



