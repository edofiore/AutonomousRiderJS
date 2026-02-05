import { Plan } from "./index.js";
import { findBestPath } from "./utilsPlanning.js";
import { client } from "../../config/index.js";
import { GO_PICK_UP, distance } from "../utils.js";
import { beliefs } from "../beliefs/beliefs.js";

class GoPickUp extends Plan {
    static isApplicableTo (go_pick_up, x, y, id) {
        return go_pick_up == GO_PICK_UP;
    }

    // async execute (go_pick_up, x, y, id) {
    //     console.log("Executing go_pick_up...")
    //     let parcel = beliefs?.storedParcels.get(id);
    //     if (!parcel || parcel.carriedBy) {
    //         throw ['Parcel is no longer available', id];
    //     }        
    //     if (this.stopped) throw ['stopped']; // if stopped then quit
    //     await this.subIntention( ['go_to', x, y]);
    //     if (this.stopped) throw ['stopped']; // if stopped then quit
    //     parcel = beliefs.storedParcels.get(id);
    //     if (!parcel || parcel.carriedBy) {
    //         throw ['Parcel is no longer available', id];
    //     }        
    //     await client.emitPickup();
    //     if (this.stopped) throw ['stopped']; // if stopped then quit
    //     return true;    
    // }

    async execute (go_pick_up, x, y, id) {
        console.log("Executing enhanced go_pick_up with path optimization...");
        
        let mainParcel = beliefs?.storedParcels.get(id);
        if (!mainParcel || mainParcel.carriedBy) {
            throw ['Main parcel is no longer available', id];
        }

        if (this.stopped) throw ['stopped'];

        // Find parcels along the path to the main target
        const pathParcels = await this.findParcelsAlongPath(
            { x: beliefs.me.x, y: beliefs.me.y }, 
            { x, y }, 
            id
        );

        console.log(`Found ${pathParcels.length} parcels along the path to main target`);

        // Execute sub-intentions for parcels along the path
        for (const pathParcel of pathParcels) {
            if (this.stopped) throw ['stopped'];
            
            // Check if parcel is still available
            const currentParcel = beliefs.storedParcels.get(pathParcel.id);
            if (currentParcel && !currentParcel.carriedBy && currentParcel.reward > 0) {
                console.log(`Picking up parcel ${pathParcel.id} in { ${currentParcel.x},${currentParcel.y} } along the path (reward: ${currentParcel.reward})`);
                
                try {
                    // Go to the parcel location
                    await this.subIntention(['go_to', pathParcel.x, pathParcel.y]);
                    
                    if (this.stopped) throw ['stopped'];
                    
                    // Verify parcel is still there and pick it up
                    const finalCheck = beliefs.storedParcels.get(pathParcel.id);
                    if (finalCheck && !finalCheck.carriedBy) {
                        await client.emitPickup();
                        console.log(`Successfully picked up parcel ${pathParcel.id}`);
                    } else {
                        console.log(`Parcel ${pathParcel.id} was taken by someone else`);
                    }
                } catch (error) {
                    console.log(`Failed to pick up parcel ${pathParcel.id}:`, error);
                    // Continue with the next parcel, don't abort the whole plan
                }
            }
        }

        if (this.stopped) throw ['stopped'];

        // Finally, go to the main target parcel
        mainParcel = beliefs.storedParcels.get(id);
        if (!mainParcel || mainParcel.carriedBy) {
            throw ['Main parcel is no longer available', id];
        }

        console.log(`Going to main target parcel ${id} at (${x}, ${y})`);
        await this.subIntention(['go_to', x, y]);
        
        if (this.stopped) throw ['stopped'];

        // Pick up the main target parcel
        const finalMainParcel = beliefs.storedParcels.get(id);
        if (!finalMainParcel || finalMainParcel.carriedBy) {
            throw ['Main parcel is no longer available', id];
        }

        await client.emitPickup();
        console.log(`Successfully picked up main target parcel ${id}`);
        
        if (this.stopped) throw ['stopped'];
        return true;
    }

    /**
     * Find parcels that are along or near the path to the target
     * @param {{x: number, y: number}} start - Starting position
     * @param {{x: number, y: number}} target - Target position  
     * @param {string} mainParcelId - ID of the main target parcel to exclude
     * @returns {Array} Array of parcels along the path, sorted by optimal pickup order
     */
    async findParcelsAlongPath(start, target, mainParcelId) {
        try {
            // Get the optimal path to the target
            const pathToTarget = await findBestPath(start, target);
            console.log("Path to target:", pathToTarget);

            const pathParcels = [];
            const maxDetourDistance = 1; // Maximum detour distance to consider a parcel "along the path"
            const minRewardThreshold = 1; // Minimum reward to consider picking up

            // Check each available parcel
            for (const [parcelId, parcel] of beliefs.storedParcels.entries()) {
                // Skip if it's the main target, already carried, or has no reward
                if (parcelId === mainParcelId || 
                    parcel.carriedBy || 
                    parcel.reward < minRewardThreshold) {
                    continue;
                }

                const parcelPos = { x: parcel.x, y: parcel.y };
                
                // Check if the parcel is along the path
                if (this.isParcelAlongPath(pathToTarget, parcelPos, maxDetourDistance)) {
                    // Calculate the distance from start to this parcel
                    const distanceFromStart = distance(start, parcelPos);
                    
                    pathParcels.push({
                        id: parcelId,
                        x: parcel.x,
                        y: parcel.y,
                        reward: parcel.reward,
                        distanceFromStart: distanceFromStart,
                        // Calculate efficiency score (reward per unit distance)
                        efficiency: parcel.reward / Math.max(1, distanceFromStart)
                    });
                }
            }

            // Sort parcels by distance from start (to pick them up in order along the path)
            // You could also sort by efficiency or other criteria
            pathParcels.sort((a, b) => a.distanceFromStart - b.distanceFromStart);

            console.log("Parcels along path:", pathParcels.map(p => 
                `${p.id}(reward:${p.reward}, dist:${p.distanceFromStart})`
            ));

            return pathParcels;

        } catch (error) {
            console.log("Error finding parcels along path:", error);
            return []; // Return empty array if pathfinding fails
        }
    }

    /**
     * Check if a parcel position is along the given path within detour distance
     * @param {string[]} path - Array of tile IDs representing the path
     * @param {{x: number, y: number}} parcelPos - Position of the parcel
     * @param {number} maxDetour - Maximum detour distance to consider
     * @returns {boolean} True if parcel is along the path
     */
    isParcelAlongPath(path, parcelPos, maxDetour) {
        const parcelTile = `${parcelPos.x}-${parcelPos.y}`;
        
        // Check if the parcel is directly on the path
        if (path.includes(parcelTile)) {
            return true;
        }

        // Check if the parcel is within detour distance of any path tile
        for (const pathTile of path) {
            const [pathX, pathY] = pathTile.split('-').map(Number);
            const manhattanDistance = Math.abs(pathX - parcelPos.x) + Math.abs(pathY - parcelPos.y);
            
            if (manhattanDistance <= maxDetour) {
                return true;
            }
        }

        return false;
    }
}

export { GoPickUp };