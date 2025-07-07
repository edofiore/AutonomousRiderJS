import { Plan } from "./index.js";
import dijkstra from 'graphology-shortest-path';
import { client } from "../../config/index.js";
import { beliefs, constantBeliefs, GO_TO } from "../index.js";
import { findBestPath, isTileFree, addTemporaryBlockedTile, clearOldBlockedTiles } from "./utilsPlanning.js";

class BlindMove extends Plan {

    static isApplicableTo(go_to, x, y) {
        return go_to == GO_TO;
    }

    async execute(go_to, x, y) {
        console.log("Executing go_to...");

        if (beliefs.me.x != x || beliefs.me.y != y) {
            if (this.stopped) throw ['stopped'];

            let path = null;
            let replanAttempts = 0;
            const maxReplanAttempts = 3;

            // Clear old blocked tiles that might no longer be blocked
            clearOldBlockedTiles();

            // Initial path planning
            try {
                path = await findBestPath({x: beliefs.me.x, y: beliefs.me.y}, {x, y});
                console.log("Initial path planned:", path);
            } catch (error) {
                console.log("No path found to destination");
                throw ['no path available'];
            }

            if (this.stopped) throw ['stopped'];

            // Execute path with replanning on blocked tiles
            for (let i = 0; i < path.length; i++) {
                if (this.stopped) throw ['stopped'];

                const nextDest = path[i];
                const nextCoordinates = nextDest.split("-").map(Number);

                // Check if the agent has reached integer coordinates
                const check = new Promise(res => 
                    client.onYou(m => m.x % 1 != 0 || m.y % 1 != 0 ? null : res())
                );

                // Check if tile is free
                if (!isTileFree(nextCoordinates)) {
                    console.log(`Tile ${nextCoordinates} is blocked. Attempting to replan...`);

                    // Add the blocked tile to temporary blocked tiles
                    addTemporaryBlockedTile(nextDest);

                    // Wait a moment to see if the blockage clears
                    await new Promise(resolve => setTimeout(resolve, constantBeliefs.config.MOVEMENT_DURATION));

                    // Check again if tile is now free
                    if (isTileFree(nextCoordinates)) {
                        console.log(`Tile ${nextCoordinates} is now free, continuing...`);
                    } else {
                        // Tile is still blocked, need to replan
                        console.log(`Tile ${nextCoordinates} still blocked. Replanning path...`);

                        if (replanAttempts >= maxReplanAttempts) {
                            console.log("Max replan attempts reached. Path may be impossible.");
                            throw ['path blocked - max attempts reached'];
                        }

                        replanAttempts++;

                        try {
                            // Replan from current position to destination
                            const currentPos = {x: beliefs.me.x, y: beliefs.me.y};
                            const newPath = await findBestPath(currentPos, {x, y});
                            
                            console.log(`Replanned path (attempt ${replanAttempts}):`, newPath);
                            
                            // Update the path and restart from current position
                            path = newPath;
                            i = -1; // Reset loop counter (will be incremented to 0)
                            continue;

                        } catch (replanError) {
                            console.log("Replanning failed:", replanError);
                            
                            // If we can't find any path, wait longer and try one more time
                            if (replanAttempts < maxReplanAttempts) {
                                await new Promise(resolve => 
                                    setTimeout(resolve, constantBeliefs.config.MOVEMENT_DURATION * 3)
                                );
                                
                                // Try to clear some blocked tiles and replan
                                this.clearSomeBlockedTiles();
                                
                                try {
                                    const currentPos = {x: beliefs.me.x, y: beliefs.me.y};
                                    const retryPath = await findBestPath(currentPos, {x, y});
                                    path = retryPath;
                                    i = -1;
                                    replanAttempts++;
                                    continue;
                                } catch (finalError) {
                                    console.log("Final replan attempt failed");
                                    throw ['no alternative path found'];
                                }
                            } else {
                                throw ['replanning failed - no alternative path'];
                            }
                        }
                    }
                }

                // Execute movement
                let movement_status = false;
                if (nextCoordinates[0] > beliefs.me.x) {
                    movement_status = await client.emitMove('right');
                } else if (nextCoordinates[0] < beliefs.me.x) {
                    movement_status = await client.emitMove('left');
                } else if (nextCoordinates[1] > beliefs.me.y) {
                    movement_status = await client.emitMove('up');
                } else if (nextCoordinates[1] < beliefs.me.y) {
                    movement_status = await client.emitMove('down');
                }

                if (!movement_status) {
                    console.log("Movement failed, possibly due to collision");
                    
                    // Add current tile as blocked and try to replan
                    addTemporaryBlockedTile(nextDest);
                    
                    if (replanAttempts < maxReplanAttempts) {
                        try {
                            const currentPos = {x: beliefs.me.x, y: beliefs.me.y};
                            const newPath = await findBestPath(currentPos, {x, y});
                            path = newPath;
                            i = -1;
                            replanAttempts++;
                            continue;
                        } catch (error) {
                            throw ['movement failed and replanning unsuccessful'];
                        }
                    } else {
                        throw ['movement failed'];
                    }
                }

                if (this.stopped) throw ['stopped'];

                await check;

                if (this.stopped) throw ['stopped'];

                // Reset replan attempts on successful movement
                replanAttempts = 0;
            }
        }

        if (this.stopped) throw ['stopped'];

        return true;
    }

    /**
     * Clear some blocked tiles that might be old or no longer relevant
     */
    clearSomeBlockedTiles() {
        const currentTime = Date.now();
        const maxAge = constantBeliefs.config.MOVEMENT_DURATION * 10; // 10 movement cycles
        
        beliefs.tmpBlockedTiles = beliefs.tmpBlockedTiles.filter(blockedTile => {
            if (typeof blockedTile === 'object' && blockedTile.timestamp) {
                return currentTime - blockedTile.timestamp < maxAge;
            }
            return false; // Remove tiles without timestamp
        });
        
        console.log("Cleared old blocked tiles. Remaining:", beliefs.tmpBlockedTiles.length);
    }
}

export { BlindMove };