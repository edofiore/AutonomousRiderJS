import { Plan } from "./index.js";
import dijkstra from 'graphology-shortest-path';
import { client } from "../../config/index.js";
import { beliefs, constantBeliefs, GO_TO, ERROR_CODES, debugLog } from "../index.js";
import { findBestPath, isTileFree, noteTeammateBlock, addTemporaryBlockedTile, clearOldBlockedTiles } from "./utilsPlanning.js";

/**
 * Optional move-tracing instrumentation. Enable with `DEBUG_MOVE=1`.
 * Trace lines are written directly to stdout to bypass DeliverooApi's
 * `console.log` override (which mirrors every log line to the server via
 * `emitLog` and can add its own backpressure).
 */
const TRACE = process.env.DEBUG_MOVE === '1';
const trace = TRACE
    ? (...parts) => process.stdout.write(`[TRACE t=${Date.now()}] ${parts.join(' ')}\n`)
    : () => {};
let moveSeq = 0;

class BlindMove extends Plan {

    static isApplicableTo(go_to, x, y) {
        return go_to == GO_TO;
    }

    async execute(go_to, x, y) {
        console.log("Executing go_to...");

        if (beliefs.me.x != x || beliefs.me.y != y) {
            if (this.stopped) throw [ERROR_CODES.STOPPED];    // if stopped then quit

            let path = null;
            let replanAttempts = 0;
            const maxReplanAttempts = 3;

            // Clear old blocked tiles that might no longer be blocked
            clearOldBlockedTiles();

            // Initial path planning
            try {
                path = await findBestPath({x: beliefs.me.x, y: beliefs.me.y}, {x, y}, true);
                debugLog("Initial path planned:", path);
            } catch (error) {
                console.log("No path found to destination");
                throw [ERROR_CODES.PATH_UNAVAILABLE, 'no path available'];
            }

            // Execute path with replanning on blocked tiles
            for (let i = 0; i < path.length; i++) {
                if (this.stopped) throw [ERROR_CODES.STOPPED];

                const nextDest = path[i];
                const nextCoordinates = nextDest.split("-").map(Number);

                const seq = ++moveSeq;
                trace(`#${seq} iter start i=${i} at=(${beliefs.me.x},${beliefs.me.y}) next=${nextDest}`);

                // Check if tile is free
                if (!isTileFree(nextCoordinates)) {
                    console.log(`Tile ${nextCoordinates} is blocked. Attempting to replan...`);
                    noteTeammateBlock(nextCoordinates);

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
                            throw [ERROR_CODES.PATH_BLOCKED, 'max attempts reached'];
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
                                // this.clearSomeBlockedTiles();
                                clearOldBlockedTiles();
                                
                                try {
                                    const currentPos = {x: beliefs.me.x, y: beliefs.me.y};
                                    const retryPath = await findBestPath(currentPos, {x, y});
                                    path = retryPath;
                                    i = -1; // Reset loop counter (will be incremented to 0)
                                    replanAttempts++;
                                    continue;
                                } catch (finalError) {
                                    console.log("Final replan attempt failed");
                                    throw [ERROR_CODES.REPLANNING_FAILED, 'no alternative path found', currentPos, {x, y}];
                                }
                            } else {
                                throw [ERROR_CODES.REPLANNING_FAILED, 'no alternative path', beliefs.me, {x, y}];
                            }
                        }
                    }
                }

                // Final guard against race conditions: recheck right before issuing the move.
                if (!isTileFree(nextCoordinates)) {
                    await new Promise(resolve => setTimeout(resolve, constantBeliefs.config.MOVEMENT_DURATION));

                    if (!isTileFree(nextCoordinates)) {
                        console.log(`Tile ${nextCoordinates} became blocked right before move. Replanning...`);
                        noteTeammateBlock(nextCoordinates);
                        addTemporaryBlockedTile(nextDest);

                        if (replanAttempts >= maxReplanAttempts) {
                            throw [ERROR_CODES.PATH_BLOCKED, 'right-before-move max attempts'];
                        }

                        replanAttempts++;

                        try {
                            const currentPos = {x: beliefs.me.x, y: beliefs.me.y};
                            const newPath = await findBestPath(currentPos, {x, y});
                            path = newPath;
                            i = -1; // Reset loop counter (will be incremented to 0)
                            continue;
                        } catch (error) {
                            throw [ERROR_CODES.REPLANNING_FAILED, 'after final move check'];
                        }
                    }
                }

                // Execute movement
                let dir = null;
                if (nextCoordinates[0] > beliefs.me.x) dir = 'right';
                else if (nextCoordinates[0] < beliefs.me.x) dir = 'left';
                else if (nextCoordinates[1] > beliefs.me.y) dir = 'up';
                else if (nextCoordinates[1] < beliefs.me.y) dir = 'down';

                let movement_status = false;
                if (dir) {
                    trace(`#${seq} emitMove send dir=${dir}`);
                    const t0 = Date.now();
                    movement_status = await client.emitMove(dir);
                    trace(`#${seq} emitMove ack status=${movement_status} Δ=${Date.now() - t0}ms`);
                }

                if (!movement_status) {
                    console.log("Movement failed, possibly due to collision");
                    noteTeammateBlock(nextCoordinates);

                    // Add current tile as blocked and try to replan
                    addTemporaryBlockedTile(nextDest);
                    
                    if (replanAttempts < maxReplanAttempts) {
                        try {
                            const currentPos = {x: beliefs.me.x, y: beliefs.me.y};
                            const newPath = await findBestPath(currentPos, {x, y});
                            path = newPath;
                            i = -1;  // Reset loop counter (will be incremented to 0)
                            replanAttempts++;
                            continue;
                        } catch (error) {
                            throw [ERROR_CODES.MOVEMENT_FAILED, 'replanning unsuccessful'];
                        }
                    } else {
                        throw [ERROR_CODES.MOVEMENT_FAILED];
                    }
                }

                if (this.stopped) throw [ERROR_CODES.STOPPED];

                // No explicit "wait for integer position" here. The DeliverooApi
                // delivers 'you' events (intermediate + integer) BEFORE the move
                // ack over the same socket, so by the time `emitMove` above has
                // resolved, the persistent `onYou` handler has already updated
                // `beliefs.me` to the target tile.
                //
                // The previous `waitForIntegerPosition` used `once('you')`, which
                // races with socket.io's synchronous dispatch: if both `you`
                // packets land in a single socket read, the intermediate one
                // fires the once, and the integer one is emitted with no once
                // registered — hanging the plan forever.

                // Reset replan attempts on successful movement
                replanAttempts = 0;
            }
        }

        if (this.stopped) throw [ERROR_CODES.STOPPED];

        return true;
    }

    /**
     * Clear some blocked tiles that might be old or no longer relevant
     */
    // clearSomeBlockedTiles() {
    //     const currentTime = Date.now();
    //     const maxAge = constantBeliefs.config.MOVEMENT_DURATION * 3; // movement cycles
        
    //     beliefs.tmpBlockedTiles = beliefs.tmpBlockedTiles.filter(blockedTile => {
    //         if (typeof blockedTile === 'object' && blockedTile.timestamp) {
    //             return currentTime - blockedTile.timestamp < maxAge;
    //         }
    //         return false; // Remove tiles without timestamp
    //     });
        
    //     console.log("Cleared old blocked tiles. Remaining:", beliefs.tmpBlockedTiles.length);
    // }
}

export { BlindMove };