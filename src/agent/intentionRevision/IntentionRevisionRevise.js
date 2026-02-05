import { IntentionRevision } from "./index.js";
import { beliefs, constantBeliefs, Intention, GO_TO, GO_DELIVER, GO_PICK_UP, calculateScore } from "../index.js";

class IntentionRevisionRevise extends IntentionRevision {
    
    #failureCount = new Map(); // Track failure count per intention type
    #lastFailureTime = new Map(); // Track when intentions last failed
    
    /**
     * Enhanced push method with better failure handling
     * @param {[action: string, x: number, y: number, parcel_id: string]} predicate 
     * @returns 
     */
    async push(predicate) {
        // Check if already queued
        if (this.isAlreadyQueued(predicate)) {
            console.log("Intention is already queued!");
            return;
        }
        
        const new_intention = new Intention(this, predicate);

        // Enhanced validation - check if destination is reachable
        // if (predicate[0] === GO_TO || predicate[0] === GO_PICK_UP || predicate[0] === GO_DELIVER) {
        //     const targetPos = { x: predicate[1], y: predicate[2] };
        //     const currentPos = { x: beliefs.me.x, y: beliefs.me.y };
            
        //     const isReachable = await isDestinationReachable(currentPos, targetPos);
        //     if (!isReachable) {
        //         console.log(`Skipping intention ${predicate} - destination not reachable`);
        //         return;
        //     }
        // }

        // Check for recent failures of similar intentions
        // const intentionKey = this.getIntentionKey(predicate);
        // if (this.shouldSkipDueToRecentFailures(intentionKey)) {
        //     console.log(`Skipping intention due to recent failures: ${intentionKey}`);
        //     return;
        // }

        if (this.intention_queue[0]) {
            // Enhanced decision making for intention management
            await this.handleExistingIntentions(new_intention);
        } else {
            // Queue is empty, add the new intention
            this.intention_queue[0] = new_intention;
            console.log("Added intention to empty queue:", new_intention.predicate);
        }
        
        console.log("QUEUE:", this.intention_queue.map(intention => intention?.predicate || 'undefined'));
    }

    /**
     * Handle the case where there are existing intentions in the queue
     */
    async handleExistingIntentions(new_intention) {
        const currentIntention = this.intention_queue[0];
        const new_predicate = new_intention.predicate;

        // If current intention is GO_TO and new is more important, replace it
        if (currentIntention.predicate[0] === GO_TO && new_predicate[0] !== GO_TO) {
            console.log("Replacing GO_TO intention with more important one");
            // this.intention_queue[1] = new_intention;
            await this.putInTheQueue(0, new_intention);
        }
        // If current intention is GO_DELIVER or GO_PICK_UP
        else if (currentIntention.predicate[0] === GO_DELIVER || currentIntention.predicate[0] === GO_PICK_UP) {
            // await this.putInTheQueue(1, new_intention);

            // Enhanced comparison for GO_PICK_UP and GO_DELIVER intentions
            if (new_predicate[0] === GO_PICK_UP || new_predicate[0] === GO_DELIVER) {
                const shouldSwap = await this.intentionComparison(currentIntention, new_intention);

                if (shouldSwap) {
                    console.log("Swapping intentions based on enhanced comparison");
                    await this.putInTheQueue(0, new_intention);
                } else {
                    // Check if we should insert at position 1
                    if (this.intention_queue[1]) {
                        const shouldSwapWithSecond = await this.intentionComparison(this.intention_queue[1], new_intention);
                        if (shouldSwapWithSecond) {
                            await this.putInTheQueue(1, new_intention);
                        }
                    }
                }
            }
        }
    }

    /**
     * Enhanced intention comparison that considers multiple factors
     */
    async intentionComparison(intention1, intention2) {
        
        if (this.getIntentionKey(intention1.predicate) === this.getIntentionKey(intention2.predicate)) {
            console.log(`Intention comparison: Same intention (${this.getIntentionKey(intention1.predicate)}, ${this.getIntentionKey(intention2.predicate)}), no swap needed`);
            return false; // Same intention, no swap needed
        }

        const agent_pos = { x: beliefs.me.x, y: beliefs.me.y };

        const score1 = calculateScore(intention1.predicate, agent_pos, this.#failureCount.get(this.getIntentionKey(intention1.predicate)) || 0);
        const score2 = calculateScore(intention2.predicate, agent_pos, this.#failureCount.get(this.getIntentionKey(intention2.predicate)) || 0);
        
        console.log(`Intention comparison: ${intention1.predicate} (${score1}) vs ${intention2.predicate} (${score2})`);
        
        return score2 > score1;
    }

    /**
     * Compare reachability of two intentions
     */
    async compareReachability(intention1, intention2, agent_pos) {
        const pos1 = { x: intention1.predicate[1], y: intention1.predicate[2] };
        const pos2 = { x: intention2.predicate[1], y: intention2.predicate[2] };
        
        const reachable1 = await isDestinationReachable(agent_pos, pos1);
        const reachable2 = await isDestinationReachable(agent_pos, pos2);
        
        if (reachable1 && !reachable2) return -1; // intention1 is better
        if (!reachable1 && reachable2) return 1;  // intention2 is better
        return 0; // both equally reachable/unreachable
    }

    /**
     * Get a key to identify similar intentions for failure tracking
     */
    getIntentionKey(predicate) {
        if (predicate[0] === GO_PICK_UP) {
            return `${predicate[0]}-${predicate[3]}`; // Include parcel ID
        }
        return `${predicate[0]}-${predicate[1]}-${predicate[2]}`; // Include coordinates
    }

    /**
     * Check if we should skip an intention due to recent failures
     */
    shouldSkipDueToRecentFailures(intentionKey) {
        const failures = this.#failureCount.get(intentionKey) || 0;
        const lastFailure = this.#lastFailureTime.get(intentionKey) || 0;
        const currentTime = Date.now();
        
        // Skip if too many recent failures
        if (failures >= 3 && (currentTime - lastFailure) < 30000) { // 30 seconds
            return true;
        }
        
        // Reset failure count if enough time has passed
        if ((currentTime - lastFailure) > 60000) { // 1 minute
            this.#failureCount.set(intentionKey, 0);
        }
        
        return false;
    }

    /**
     * Record a failure for an intention
     */
    recordIntentionFailure(predicate, error) {
        const intentionKey = this.getIntentionKey(predicate);
        const currentFailures = this.#failureCount.get(intentionKey) || 0;
        
        this.#failureCount.set(intentionKey, currentFailures + 1);
        this.#lastFailureTime.set(intentionKey, Date.now());
        
        console.log(`Recorded failure for ${intentionKey}: ${currentFailures + 1} total failures`);
        console.log(`Failure reason: `, error);
    }

    /**
     * Enhanced loop with better error handling and replanning
     */
    async loop() {
        while (true) {
            if (this.intention_queue.length > 0) {
                console.log("IntentionRevision.loop", this.intention_queue.map(i => i?.predicate || 'undefined'));

                const intention = this.intention_queue[0];
                if (!intention) {
                    this.intention_queue.shift();
                    continue;
                }

                // Enhanced validity check
                if (!this.isIntentionStillValid(intention)) {
                    console.log("Skipping invalid intention:", intention.predicate);
                    this.intention_queue.shift();
                    continue;
                }

                // Execute intention with enhanced error handling
                try {
                    await intention.achieve();
                    console.log('Successfully completed intention:', intention.predicate);
                } catch (error) {
                    console.log('Failed intention:', intention.predicate, 'Error:', error);
                    
                    // Record the failure
                    this.recordIntentionFailure(intention.predicate, error);
                    
                    // Determine if we should retry or abandon
                    if (this.shouldRetryIntention(intention, error)) {
                        console.log('Retrying intention after brief delay');
                        // Add some delay before retry
                        await new Promise(resolve => 
                            setTimeout(resolve, constantBeliefs.config.MOVEMENT_DURATION)
                        );
                        continue; // Don't remove from queue, try again
                    }
                }

                // Remove completed/failed intention from queue
                this.intention_queue.shift();
            }

            // Postpone next iteration
            await new Promise(res => setImmediate(res));
        }
    }

    /**
     * Enhanced validity check for intentions
     */
    isIntentionStillValid(intention) {
        const predicate = intention.predicate;
        
        if (predicate[0] === GO_PICK_UP) {
            const parcel_id = predicate[3];
            const parcel = beliefs.storedParcels.get(parcel_id);
            
            if (!parcel || parcel.carriedBy) {
                return false; // Parcel no longer available
            }
            
            // Check if parcel is still worth picking up
            if (parcel.reward <= 0) {
                return false;
            }
        } else if (predicate[0] === GO_DELIVER) {
            if (!beliefs.me?.parcelsImCarrying || beliefs.me.parcelsImCarrying === 0) {
                return false; // Nothing to deliver
            }
        }
        
        return true;
    }

    /**
     * Determine if an intention should be retried based on the error
     */
    shouldRetryIntention(intention, error) {
        if (!Array.isArray(error)) return false;
        
        const errorType = error[0];
        const intentionKey = this.getIntentionKey(intention.predicate);
        const failures = this.#failureCount.get(intentionKey) || 0;
        
        // Don't retry if too many failures
        if (failures >= 3) return false;
        
        // Retry for certain error types
        const retryableErrors = [
            'path blocked - max attempts reached',
            'tile blocked',
            'no alternative path found',
            'movement failed'
        ];
        
        return retryableErrors.includes(errorType);
    }

    log(...args) {
        console.log(...args);
    }
}


export { IntentionRevisionRevise };
