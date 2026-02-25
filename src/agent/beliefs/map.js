import { constantBeliefs, BLOCKED_TILES, WALKABLE_SPAWNING_TILES, DELIVERABLE_TILES } from "../index.js";

let mapWidth;
let mapHeight;
let center = { x: Number.MAX_VALUE, y: Number.MAX_VALUE };

/**
 * Build the map graph from tile data, tracking delivery spots and parcel spawners.
 * @param {number} width
 * @param {number} height
 * @param {Tile[]} data
 */
const processMapData = (width, height, data) => {
    mapWidth = width;
    mapHeight = height;

    for (const tile of data) {
        const nodeId = tile.x + "-" + tile.y;

        if (tile.type == BLOCKED_TILES || constantBeliefs.map.mapGraph.hasNode(nodeId))
            continue;

        constantBeliefs.map.mapGraph.addNode(nodeId, { x: tile.x, y: tile.y, type: tile.type });

        if (tile.x < mapWidth / 2) {
            if (Math.abs(center.x - Math.floor(mapWidth / 2)) > Math.abs(tile.x - Math.floor(mapWidth / 2))
                && Math.abs(center.y - Math.floor(mapHeight / 2)) > Math.abs(tile.y - Math.floor(mapHeight / 2))) {
                center.x = Math.floor(tile.x);
                center.y = Math.floor(tile.y);
            }
        }

        constantBeliefs.map.mapGraph.forEachNode((node, attributes) => {
            if (node != nodeId) {
                if ((attributes.x == tile.x && (attributes.y == tile.y + 1 || attributes.y == tile.y - 1))
                    || (attributes.y == tile.y && (attributes.x == tile.x + 1 || attributes.x == tile.x - 1))) {
                    constantBeliefs.map.mapGraph.addUndirectedEdge(nodeId, node);
                }
            }
        });

        if (tile.type == DELIVERABLE_TILES)
            constantBeliefs.map.deliverySpots.push([tile.x, tile.y]);
        else if (tile.type == WALKABLE_SPAWNING_TILES)
            constantBeliefs.map.parcelSpawners.push([tile.x, tile.y]);
    }
}

/**
 * Populate constantBeliefs.config from the server config object.
 * @param {Config} config
 */
const getMapConfig = (config) => {
    constantBeliefs.config.MOVEMENT_DURATION = config.MOVEMENT_DURATION;
    constantBeliefs.config.MOVEMENT_STEPS = config.MOVEMENT_STEPS;

    constantBeliefs.config.AOD = config.AGENTS_OBSERVATION_DISTANCE == "infinite"
        ? Number.MAX_VALUE : config.AGENTS_OBSERVATION_DISTANCE;

    constantBeliefs.config.POD = config.PARCELS_OBSERVATION_DISTANCE == "infinite"
        ? Number.MAX_VALUE : config.PARCELS_OBSERVATION_DISTANCE;

    constantBeliefs.config.PDI = config.PARCEL_DECADING_INTERVAL == "infinite"
        ? Number.MAX_VALUE : parseInt(config.PARCEL_DECADING_INTERVAL);

    constantBeliefs.config.PGI = parseInt(config.PARCELS_GENERATION_INTERVAL);
    constantBeliefs.config.PRA = config.PARCEL_REWARD_AVG;
    constantBeliefs.config.PRV = config.PARCEL_REWARD_VARIANCE;

    constantBeliefs.config.PARCELS_MAX = config.PARCELS_MAX == "infinite"
        ? Number.MAX_VALUE : config.PARCELS_MAX;

    constantBeliefs.config.PDR = constantBeliefs.config.MOVEMENT_DURATION / (constantBeliefs.config.PDI * 1000);
    constantBeliefs.config.PENALTY = config.PENALTY;
}

export { processMapData, getMapConfig };
