import dijkstra from 'graphology-shortest-path';
import { beliefs, constantBeliefs } from "../index.js";

/**
 * Find the shortest path to reach the destination
 * @param {{x: number, y: number}} current_pos 
 * @param {{x: number, y: number}} destination 
 * @returns 
 */
const findBestPath = async (current_pos, destination) => {
    let myPos = Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y);
    let dest = Math.floor(destination.x) + "-" + Math.floor(destination.y);

    let mapGraph = constantBeliefs.map.mapGraph.copy();
    if (beliefs.tmpBlockedTiles?.length > 0) {

        for(let blockedTile of beliefs.tmpBlockedTiles) {
            console.log("BLOCKED TILE", blockedTile)
            console.log("OLD", mapGraph);
            mapGraph.dropNode(blockedTile);
            console.log("NEW", mapGraph);
        }
    }

    // Compute the path
    const path = dijkstra.bidirectional(mapGraph, myPos, dest);

    // TODO: reset blocked tiles?
    // beliefs.tmpBlockedTiles = []; ???????

    // Remove the starting position
    path.shift();

    return path
}

/**
 * 
 * @param {[x: number, y: number]} nextCoordinates 
 */
const isTileFree = (nextCoordinates) => {
    // console.log("CHECKING")

    const res = [...beliefs.otherAgents?.values()]?.flat().some((agent) =>
        agent.x == nextCoordinates[0] && agent.y == nextCoordinates[1]
    );
    // console.log("RES", res)s
    
    return !res
}

export { findBestPath , isTileFree};