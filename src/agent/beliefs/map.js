import { constantBeliefs, BLOCKED_TILES, WALKABLE_SPAWNING_TILES, DELIVERABLE_TILES } from "../index.js";

/**
 * Define local variables
 */
let mapWidth;
let mapHeight;
let center = { x:Number.MAX_VALUE, y:Number.MAX_VALUE};


/**
 * Process the data about the map
 * @param {number} width 
 * @param {number} height 
 * @param {*} data 
 */
const processMapData = (width, height, data) => {
    mapWidth = width;
    mapHeight = height;
    let nodeId = new String;

    // Add every tile to the graph
    for(let tile of data){
        nodeId = tile.x + "-" + tile.y;
        if(tile.type != BLOCKED_TILES && !constantBeliefs.map.mapGraph.hasNode(nodeId)) {
            constantBeliefs.map.mapGraph.addNode(nodeId, { x:tile.x, y:tile.y, type:tile.type});
            if(tile.x < mapWidth/2){
                if(Math.abs(center.x - Math.floor(mapWidth/2)) > Math.abs(tile.x - Math.floor(mapWidth/2)) 
                    && Math.abs(center.y - Math.floor(mapHeight/2)) > Math.abs(tile.y - Math.floor(mapHeight/2))){
                    center.x = Math.floor(tile.x);
                    center.y = Math.floor(tile.y);
                }
            }
            constantBeliefs.map.mapGraph.forEachNode((node, attributes) => {
                if(node != nodeId){
                    if((attributes.x == tile.x && (attributes.y == tile.y+1 || attributes.y == tile.y-1)) 
                        || (attributes.y == tile.y && (attributes.x == tile.x+1 || attributes.x == tile.x-1))){
                        constantBeliefs.map.mapGraph.addUndirectedEdge(nodeId,node);
                    }
                }
            });
        }
    }

    /**
     * Definition delivery spots and parcels spawner tiles
     */
    constantBeliefs.map.mapGraph.forEachNode((node, attributes) => {
        if(attributes.type == DELIVERABLE_TILES)
            constantBeliefs.map.deliverySpots.push(node.split("-"));
        else if(attributes.type == WALKABLE_SPAWNING_TILES)
            constantBeliefs.map.parcelSpawners.push(node.split("-"));
    })


    console.log("Map graph -->", constantBeliefs.map.mapGraph);
    console.log("Center -->", center);
    console.log("Delivery spots -->", constantBeliefs.map.deliverySpots );
    console.log("Parcel spawners -->", constantBeliefs.map.parcelSpawners );
}

/**
 * Get the config of the map
 * @param {Config} config 
 */
const getMapConfig = (config) => {
    // constantBeliefs.config = config;
    constantBeliefs.config.MOVEMENT_DURATION = config.MOVEMENT_DURATION;        // time in ms
    constantBeliefs.config.MOVEMENT_STEPS = config.MOVEMENT_STEPS;              // 1 intermediate at 0.6
    
    if (config.AGENTS_OBSERVATION_DISTANCE == "infinite")                       // number or 'infinite'
        constantBeliefs.config.AOD = Number.MAX_VALUE
    else
        constantBeliefs.config.AOD = config.AGENTS_OBSERVATION_DISTANCE;         

    if (config.PARCELS_OBSERVATION_DISTANCE == "infinite")                      // number or 'infinite'
        constantBeliefs.config.POD = Number.MAX_VALUE
    else
        constantBeliefs.config.POD = config.PARCELS_OBSERVATION_DISTANCE;       

    if (config.PARCEL_DECADING_INTERVAL == "infinite")                          // '1s', '2s', '5s', '10s', 'infinite'
        constantBeliefs.config.PDI = Number.MAX_VALUE
    else
        constantBeliefs.config.PDI = parseInt(config.PARCEL_DECADING_INTERVAL);     

    constantBeliefs.config.PGI = parseInt(config.PARCELS_GENERATION_INTERVAL);  // '1s', '2s', '5s', '10s'
    constantBeliefs.config.PRA = config.PARCEL_REWARD_AVG;                      // number
    constantBeliefs.config.PRV = config.PARCEL_REWARD_VARIANCE;                 // number

    if (config.PARCELS_MAX == "infinite")                                       // number or 'infinite'
        constantBeliefs.config.PARCELS_MAX = Number.MAX_VALUE
    else
        constantBeliefs.config.PARCELS_MAX = config.PARCELS_MAX;
    // constantBeliefs.config.CLOCK = parseInt(config.CLOCK);                      // (50ms are 20frame/s)

    constantBeliefs.config.PDR = constantBeliefs.config.MOVEMENT_DURATION/(constantBeliefs.config.PDI*1000);    // number
    
    // console.log("config", config)
}

export { processMapData, getMapConfig };