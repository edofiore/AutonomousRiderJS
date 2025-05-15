import UndirectedGraph from "graphology";

const BLOCKED_TILES = 0;    // '0' are blocked tiles (empty or not_tile)
const WALKABLE_SPAWNING_TILES = 1;  // '1' are walkable spawning tiles
const DELIVERABLE_TILES = 2;    // '2' are delivery tiles
const WALKABLE_TILES = 3;   // '3' are walkable non-spawning tiles

/**
 * TODO: do a Belief class? Having a Belief class we could store in belief.map, belief.parcels, belief.me, belief.me.score, ...
 */

let mapWidth;
let mapHeight;
let center = { x:Number.MAX_VALUE, y:Number.MAX_VALUE};
let deliverySpots = [];
let parcelSpawners = [];
const mapGraph = new UndirectedGraph();
// let newParcels = true;
// let carrying = false;

/**
 * Config map variables
 */
let MOVEMENT_DURATION = 0;
let MOVEMENT_STEPS = 0;
let PDI = "";    // PARCEL DECADING INTERVAL
let AOD = 0;    // AGENTS OBSERVATION DISTANCE
let POD = 0;    // PARCELS OBSERVATION DISTANCE
let PGI = "";   // PARCELS GENERATION INTERVAL
let PRA = 0;    // PARCEL REWARD AVG
let PRV = 0;    // PARCEL REWARD VARIANCE
let PARCELS_MAX = 0;

const processMapData = (width, height, data) => {
    mapWidth = width;
    mapHeight = height;
    // console.log(mapWidth)
    // console.log(mapHeight)
    // console.log(data)
    let nodeId = new String;
    for(let tile of data){
        nodeId = tile.x + "-" + tile.y;
        if(tile.type != BLOCKED_TILES && !mapGraph.hasNode(nodeId)) {
            mapGraph.addNode(nodeId, { x:tile.x, y:tile.y, type:tile.type});
            if(tile.x < mapWidth/2){
                if(Math.abs(center.x - Math.floor(mapWidth/2)) > Math.abs(tile.x - Math.floor(mapWidth/2)) && Math.abs(center.y - Math.floor(mapHeight/2)) > Math.abs(tile.y - Math.floor(mapHeight/2))){
                    center.x = Math.floor(tile.x);
                    center.y = Math.floor(tile.y);
                }
            }
            mapGraph.forEachNode((node, attributes) => {
                if(node != nodeId){
                    if((attributes.x == tile.x && (attributes.y == tile.y+1 || attributes.y == tile.y-1)) || (attributes.y == tile.y && (attributes.x == tile.x+1 || attributes.x == tile.x-1))){
                        mapGraph.addUndirectedEdge(nodeId,node);
                    }
                }
            });
        }
    }
    console.log("MAPGRAPH", mapGraph);
    // TODO: check buffer and what is saves
    // let buffer = mapGraph.filterNodes((node, attributes) => {
    //     // console.log("NODE", node);
    //     console.log("ATTRIBUTES", attributes)
    //     return attributes.type == DELIVERABLE_TILES;
    // })

    /**
     * Definition delivery spots and parcels spawner tiles
     */

    mapGraph.forEachNode((node, attributes) => {
        // console.log("NODE", node);
        console.log("ATTRIBUTES", attributes)
        if(attributes.type == DELIVERABLE_TILES)
            deliverySpots.push(node.split("-"));
        else if(attributes.type == WALKABLE_SPAWNING_TILES)
            parcelSpawners.push(node.split("-"));
    })
    
    // const buffer = [];
    // mapGraph.filterNodes((node, attributes) => {
    //     // console.log("NODE", node);
    //     console.log("ATTRIBUTES", attributes)
    //     return attributes == ;
    // })
    // console.log("BUFFER", buffer)
    // for(const spot of buffer){
    //     console.log("SPOT", spot)
    //     /**
    //      * Delivery zones
    //      */
    //     // if(spot == DELIVERABLE_TILES)
    //     deliverySpots.push(spot.split("-"));
    //     /**
    //      * Parcel Spawners
    //      */
    //     // else if(spot == WALKABLE_SPAWNING_TILES)
    //     //     parcelSpawners.push(spot.split("-"));
    // }

    

    console.log("Map graph -->", mapGraph);
    console.log("Center -->", center);
    console.log("Delivery spots -->", deliverySpots );
    console.log("Parcel spawners -->", parcelSpawners );
}

/**
 * Get the config of the map
 * @param {*} config 
 */
const getMapConfig = (config) => {
    MOVEMENT_DURATION = config.MOVEMENT_DURATION;
    MOVEMENT_STEPS = config.MOVEMENT_STEPS;
    PDI = config.PARCEL_DECADING_INTERVAL;
    AOD = config.AGENTS_OBSERVATION_DISTANCE;
    POD = config.PARCELS_OBSERVATION_DISTANCE;
    PGI = config.PARCELS_GENERATION_INTERVAL;
    PRA = config.PARCEL_REWARD_AVG;
    PRV = config.PARCEL_REWARD_VARIANCE;
    PARCELS_MAX = config.PARCELS_MAX;

    console.log(MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, AOD, POD, PGI, PRA, PRV, PARCELS_MAX)
}
// client.onMap( ( width, height, data ) => {
//     mapWidth = width;
//     mapHeight = height;
//     let nodeId = new String;
//     for(let tile of data){
//         nodeId = tile.x + "-" + tile.y;
//         mapGraph.addNode(nodeId, { x:tile.x, y:tile.y, delivery:tile.delivery, parcelSpawner:tile.parcelSpawner});
//         if(tile.x < mapWidth/2){
//             if(Math.abs(center.x - Math.floor(mapWidth/2)) > Math.abs(tile.x - Math.floor(mapWidth/2)) && Math.abs(center.y - Math.floor(mapHeight/2)) > Math.abs(tile.y - Math.floor(mapHeight/2))){
//                 center.x = Math.floor(tile.x);
//                 center.y = Math.floor(tile.y);
//             }
//         }
//         mapGraph.forEachNode((node, attributes) => {
//             if(node != nodeId){
//                 if((attributes.x == tile.x && (attributes.y == tile.y+1 || attributes.y == tile.y-1)) || (attributes.y == tile.y && (attributes.x == tile.x+1 || attributes.x == tile.x-1))){
//                     mapGraph.addUndirectedEdge(nodeId,node);
//                 }
//             }
//         });
//     }

//     let buffer = mapGraph.filterNodes((node, attributes) => {
//         return attributes.delivery;
//     })
//     for(const spot of buffer){
//         deliverySpots.push(spot.split("-"));
//     }

//     // Parcel Spawners
//     buffer = mapGraph.filterNodes((node, attributes) => {
//         return attributes.parcelSpawner;
//     })

//     for(const spot of buffer){
//         parcelSpawners.push(spot.split("-"));
//     }

//     console.log(center);
// })

export { mapGraph, deliverySpots, parcelSpawners, MOVEMENT_DURATION, MOVEMENT_STEPS, AOD, PDI, PGI, POD, PRA, PRV, PARCELS_MAX, processMapData, getMapConfig };