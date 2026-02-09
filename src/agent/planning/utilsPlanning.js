import dijkstra from 'graphology-shortest-path';
import { beliefs, constantBeliefs } from "../index.js";

/**
 * Enhanced blocked tile management structure
 * Each blocked tile now has: { tile: string, timestamp: number, attempts: number }
 */

/**
 * Add a tile to the temporary blocked tiles list with timestamp
 * @param {string} tileId - The tile identifier (e.g., "1-2")
 */
const addTemporaryBlockedTile = (tileId) => {
    clearOldBlockedTiles();
    const currentTime = Date.now();
    
    // Check if tile is already in blocked list
    const existingIndex = beliefs.tmpBlockedTiles.findIndex(item => 
        (typeof item === 'string' ? item : item.tile) === tileId
    );
    
    // Update existing entry
    if (existingIndex !== -1) {
        // beliefs.tmpBlockedTiles[existingIndex].timestamp = currentTime;
        beliefs.tmpBlockedTiles[existingIndex].attempts++;
        
    } else {
        // Add new entry
        beliefs.tmpBlockedTiles.push({
            tile: tileId,
            timestamp: currentTime,
            attempts: 1
        });
    }
    
    console.log(`Added blocked tile ${tileId}. Total blocked tiles: ${beliefs.tmpBlockedTiles.length}`);
};

/**
 * Clear old blocked tiles that are likely no longer blocked
 */
const clearOldBlockedTiles = () => {
    const currentTime = Date.now();
    const maxAge = constantBeliefs.config.MOVEMENT_DURATION * 3; // movement cycles
    // const maxAttempts = 5;
    
    const originalLength = beliefs.tmpBlockedTiles.length;
    
    beliefs.tmpBlockedTiles = beliefs.tmpBlockedTiles.filter(item => {
        // if (typeof item === 'string') {
        //     // Old format, remove after some time
        //     return false;
        // }
        
        const age = currentTime - item.timestamp;
        const tooOld = age > maxAge;
        // const tooManyAttempts = item.attempts > maxAttempts;
        const tooManyAttempts = false;
        return !tooOld && !tooManyAttempts;
    });
    
    if (beliefs.tmpBlockedTiles.length !== originalLength) {
        console.log(`Cleared ${originalLength - beliefs.tmpBlockedTiles.length} old blocked tiles`);
    }
};

/**
 * Check if a specific tile is currently marked as blocked
 * @param {string} tileId - The tile identifier
 * @returns {boolean}
 */
const isTileTemporarilyBlocked = (tileId) => {
    return beliefs.tmpBlockedTiles.some(item => 
        (typeof item === 'string' ? item : item.tile) === tileId
    );
};

/**
 * Find the shortest path to reach the destination with improved blocked tile handling
 * @param {{x: number, y: number}} current_pos 
 * @param {{x: number, y: number}} destination 
 * @param {boolean} allowTemporaryBlocked - Whether to consider temporarily blocked tiles
 * @returns {string[]} Array of tile IDs representing the path
 */
const findBestPath = async (current_pos, destination, allowTemporaryBlocked = false) => {
    let myPos = Math.floor(current_pos.x) + "-" + Math.floor(current_pos.y);
    let dest = Math.floor(destination.x) + "-" + Math.floor(destination.y);

    // Create a copy of the map graph
    let mapGraph = constantBeliefs.map.mapGraph.copy();
    
    // Remove temporarily blocked tiles if not allowing them
    if (!allowTemporaryBlocked && beliefs.tmpBlockedTiles?.length > 0) {
        console.log("Removing temporarily blocked tiles from path calculation:");
        
        for (let blockedItem of beliefs.tmpBlockedTiles) {
            const blockedTile = typeof blockedItem === 'string' ? blockedItem : blockedItem.tile;
            
            if (mapGraph.hasNode(blockedTile)) {
                console.log(`  - Removing blocked tile: ${blockedTile}`);
                mapGraph.dropNode(blockedTile);
            }
        }
    }

    // Check if start and destination nodes exist
    if (!mapGraph.hasNode(myPos)) {
        throw new Error(`Start position ${myPos} is not accessible`);
    }
    
    if (!mapGraph.hasNode(dest)) {
        throw new Error(`Destination ${dest} is not accessible`);
    }

    // Compute the path
    const path = dijkstra.bidirectional(mapGraph, myPos, dest);
    
    // if (!path || path.length === 0) {
    //     // If no path found and we were excluding blocked tiles, try including them
    //     if (!allowTemporaryBlocked && beliefs.tmpBlockedTiles?.length > 0) {
    //         console.log("No path found excluding blocked tiles, trying with blocked tiles included...");
    //         return findBestPath(current_pos, destination, true);
    //     }
    //     throw new Error(`No path found from ${myPos} to ${dest}`);
    // }

    // Remove the starting position from the path
    if (!path || path.length === 0) {
        throw new Error(`No path found from ${myPos} to ${dest}`);
    }
    
    path.shift();

    console.log(`Path found: ${path.join(' -> ')}`);
    return path;
};

/**
 * Find alternative path that avoids a specific tile
 * @param {{x: number, y: number}} current_pos 
 * @param {{x: number, y: number}} destination 
 * @param {string} avoidTile - Tile to avoid
 * @returns {string[]}
 */
const findAlternativePath = async (current_pos, destination, avoidTile) => {
    // Temporarily add the tile to avoid to blocked tiles
    const wasBlocked = isTileTemporarilyBlocked(avoidTile);
    
    if (!wasBlocked) {
        addTemporaryBlockedTile(avoidTile);
    }
    
    try {
        const path = await findBestPath(current_pos, destination);
        return path;
    } finally {
        // Remove the tile from blocked tiles if it wasn't there originally
        if (!wasBlocked) {
            beliefs.tmpBlockedTiles = beliefs.tmpBlockedTiles.filter(item => 
                (typeof item === 'string' ? item : item.tile) !== avoidTile
            );
        }
    }
};

/**
 * Check if a tile is free (not occupied by other agents)
 * @param {[number, number]} nextCoordinates 
 * @returns {boolean}
 */
const isTileFree = (nextCoordinates) => {
    const timestamp = Date.now();
    // Check if any other agent is currently on this tile
    const isOccupied = [...beliefs.otherAgents?.values()].some((agent_logs) => {
        const lastLog = agent_logs.at(-1);
        return (lastLog.x === nextCoordinates[0] && lastLog.y === nextCoordinates[1] && (timestamp - lastLog.timestamp) < constantBeliefs.config.MOVEMENT_DURATION * 2);
    });
    
    return !isOccupied;
};

/**
 * Get the safest path by considering agent movement patterns
 * @param {{x: number, y: number}} current_pos 
 * @param {{x: number, y: number}} destination 
 * @returns {string[]}
 */
const findSafestPath = async (current_pos, destination) => {
    // First try normal path
    try {
        const normalPath = await findBestPath(current_pos, destination);
        
        // Check if any part of the path has high traffic
        const riskyTiles = normalPath.filter(tile => {
            const coords = tile.split('-').map(Number);
            
            // Check if any agent is moving towards this tile
            return [...beliefs.otherAgents?.values()]?.flat().some(agent_logs => {
                const lastLog = agent_logs[agent_logs.length - 1];
                const agentCoords = [Math.floor(lastLog.x), Math.floor(lastLog.y)];
                const distance = Math.abs(agentCoords[0] - coords[0]) + Math.abs(agentCoords[1] - coords[1]);
                
                // Consider tiles that are close to other agents as risky
                return distance <= 2;
            });
        });
        
        // If path has many risky tiles, try to find alternative
        if (riskyTiles.length > normalPath.length * 0.3) {
            console.log("Path has high traffic, looking for alternative...");
            
            // Temporarily block risky tiles and find alternative
            for (const riskyTile of riskyTiles) {
                addTemporaryBlockedTile(riskyTile);
            }
            
            try {
                const safePath = await findBestPath(current_pos, destination);
                console.log("Found safer alternative path");
                return safePath;
            } catch (error) {
                console.log("No safer alternative found, using original path");
                // Clear the temporarily added risky tiles
                beliefs.tmpBlockedTiles = beliefs.tmpBlockedTiles.filter(item => {
                    const tile = typeof item === 'string' ? item : item.tile;
                    return !riskyTiles.includes(tile);
                });
                return normalPath;
            }
        }
        
        return normalPath;
    } catch (error) {
        console.log("Normal pathfinding failed:", error);
        throw error;
    }
};

/**
 * Check if destination is reachable without going through blocked tiles
 * @param {{x: number, y: number}} current_pos 
 * @param {{x: number, y: number}} destination 
 * @returns {boolean}
 */
const isDestinationReachable = async (current_pos, destination) => {
    try {
        await findBestPath(current_pos, destination);
        return true;
    } catch (error) {
        return false;
    }
};

export { 
    findBestPath, 
    findAlternativePath,
    findSafestPath,
    isTileFree, 
    addTemporaryBlockedTile, 
    clearOldBlockedTiles,
    isTileTemporarilyBlocked,
    isDestinationReachable
};