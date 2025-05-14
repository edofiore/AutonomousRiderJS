import UndirectedGraph from "graphology";

const BLOCKED_TILES = 0;    // '0' are blocked tiles (empty or not_tile)
const WALKABLE_SPAWNING_TILES = 1;  // '1' are walkable spawning tiles
const DELIVERABLE_TILES = 2;    // '2' are delivery tiles
const WALKABLE_TILES = 3;   // '3' are walkable non-spawning tiles


let mapWidth;
let mapHeight;
let center = { x:Number.MAX_VALUE, y:Number.MAX_VALUE};
export let deliverySpots = [];
export let parcelSpawners = [];
export const mapGraph = new UndirectedGraph();
let newParcels = true;
let carrying = false;

export function processMapData(width, height, data) {
    mapWidth = width;
    mapHeight = height;
    console.log(mapWidth)
    console.log(mapHeight)
    console.log(data)
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