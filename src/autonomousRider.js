import { updateInfoOtherAgents } from "./agent/beliefs/otherAgents.js";
import { Agent, beliefs, getMapConfig, processMapData, updateCarryingParcels, updateInfoAgent, updateParcelsPerceived } from "./agent/index.js";
import { client } from "./config/index.js";
import { optionsGeneration } from "./reasoning/utilsOptions.js";
    
console.log("Start...")

// Create an instance of Agent
const newAgent = new Agent();

/**
 * Belief revision
 */
// client.onConfig(config => getMapConfig(config));
// client.onMap(( width, height, data ) => processMapData(width, height, data));
// client.onYou(( {id, name, x, y, score} ) => updateInfoAgent({id, name, x, y, score}));
// client.onParcelsSensing(async ( parcels ) => {
//     await updateParcelsPerceived(parcels);
//     await updateCarryingParcels(parcels);
// });
// client.onAgentsSensing(agents => updateInfoOtherAgents(agents));

/**
 * TODO: check if this is needed
 */
await new Promise(res => {
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
        await updateParcelsPerceived(parcels);
        await updateCarryingParcels(parcels);
        received.parcels = true;
        checkAllReceived();
    });

    client.onAgentsSensing(agents => {
        updateInfoOtherAgents(agents);
        received.agents = true;
        checkAllReceived();
    });
});


/**
 * Generate options at every sensing event
 */

/**
 * TODO: check if setInterval() is needed
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



