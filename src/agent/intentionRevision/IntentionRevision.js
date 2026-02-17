import { beliefs, constantBeliefs, Intention, GO_TO, GO_DELIVER, GO_PICK_UP, calculateScore, optionsGeneration, getIntentionKey, QUEUE_SWAP_STOP_CODE } from "../index.js";

/**
 * Unified IntentionRevision class for BDI architecture
 * Combines base functionality with enhanced intention revision and replanning
 */
class IntentionRevision {
    #intention_queue = new Array();
    #failureCount = new Map(); // Track failure count per intention type <intentionKey, count>
    #lastFailureTime = new Map(); // Track when intentions last failed <intentionKey, timestamp>

    get intention_queue() {
        return this.#intention_queue;
    }

    set intention_queue(buffer) {
        this.#intention_queue = [...buffer];
    }

    /**
     * Check if intention is already in the queue
     * @param {string} intentionKey - The intention key to check
     * @returns {boolean} True if already queued
     */
    isAlreadyQueued(intentionKey) {
        return this.intention_queue.find((i) => getIntentionKey(i.predicate) == intentionKey);
    }

    /**
     * Record an intention failure for tracking
     * @param {string} intentionKey - The failed intention key
     * @param {*} error - The error that occurred
     */
    recordIntentionFailure(intentionKey, error) {
        const currentFailures = this.#failureCount.get(intentionKey) || 0;
        
        this.#failureCount.set(intentionKey, currentFailures + 1);
        this.#lastFailureTime.set(intentionKey, Date.now());
        
        console.log(`Recorded failure for ${intentionKey}: ${currentFailures + 1} total failures`);
        console.log(`Failure reason: `, error);

        if(this.#failureCount.get(intentionKey) >= 5) {
            console.log(`Intention ${intentionKey} has failed 5 or more times. Marking as invalid for 10 seconds.`);
            beliefs.invalidOptions.set(intentionKey, Date.now());
        }
    }

    /**
     * Enhanced push method with validation and failure handling
     * @param {Array} predicate - [action: string, x: number, y: number, parcel_id: string]
     */
    async push(predicate) {
        const intentionKey = getIntentionKey(predicate);

        // Check if already queued
        if (this.isAlreadyQueued(intentionKey)) {
            console.log("Intention is already queued!");
            return;
        }
        
        const new_intention = new Intention(this, predicate);

        if (this.intention_queue[0]) {
            // Enhanced decision making for intention management
            await this.handleExistingIntentions(new_intention);
        } else {
            // Queue is empty, add the new intention
            this.intention_queue[0] = new_intention;
            console.log("Added intention to empty queue:", new_intention.predicate);
        }
        
        console.log("CURRENT QUEUE:", this.intention_queue.map(intention => intention?.predicate || 'undefined'));
    }

    /**
     * Handle the case where there are existing intentions in the queue
     * @param {Intention} new_intention - The new intention to add
     */
    async handleExistingIntentions(new_intention) {
        const currentIntention = this.intention_queue[0];
        const new_predicate = new_intention.predicate;

        // If current intention is GO_TO and new is more important, replace it
        if (currentIntention.predicate[0] === GO_TO && new_predicate[0] !== GO_TO) {
            console.log("Replacing GO_TO intention with more important one");
            await this.putInTheQueue(0, new_intention);
        }
        // If current intention is GO_DELIVER or GO_PICK_UP
        else if (currentIntention.predicate[0] === GO_DELIVER || currentIntention.predicate[0] === GO_PICK_UP) {
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
     * @param {Intention} intention1 - First intention to compare
     * @param {Intention} intention2 - Second intention to compare
     * @returns {boolean} True if intention2 should replace intention1
     */
    async intentionComparison(intention1, intention2) {
        if (getIntentionKey(intention1.predicate) === getIntentionKey(intention2.predicate)) {
            console.log(`Intention comparison: Same intention, no swap needed`);
            return false; // Same intention, no swap needed
        }

        const agent_pos = { x: beliefs.me.x, y: beliefs.me.y };

        const score1 = calculateScore(
            intention1.predicate, 
            agent_pos, 
            this.#failureCount.get(getIntentionKey(intention1.predicate)) || 0
        );
        const score2 = calculateScore(
            intention2.predicate, 
            agent_pos, 
            this.#failureCount.get(getIntentionKey(intention2.predicate)) || 0
        );

        console.log(`Intention comparison: score1=${score1}, score2=${score2}`);

        // Return true if intention2 has higher score (should swap)
        return score2 > score1;
    }

    /**
     * Determine if an intention should be retried based on the error
     * @param {string} intentionKey - The failed intention key
     * @param {*} error - The error that occurred
     * @returns {boolean} True if should retry
     */
    shouldRetryIntention(intentionKey, error) {
        if (!Array.isArray(error)) return false;
        
        const errorType = error[0];
        const failures = this.#failureCount.get(intentionKey) || 0;
        
        // Don't retry if too many failures
        if (failures >= 5) return false;
        
        // Retry for certain error types
        const retryableErrors = [
            'tile blocked',
            'movement failed'
        ];
        
        return retryableErrors.includes(errorType);
    }

    /**
     * Enhanced main loop with error handling and replanning
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
                if (!intention.isStillValid()) {
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
                    
                    const intentionKey = getIntentionKey(intention.predicate);

                    // Record the failure
                    if(error[1] != QUEUE_SWAP_STOP_CODE) { // Don't record as failure if we intentionally stopped for a queue swap
                        this.recordIntentionFailure(intentionKey, error);
                    }
                    
                    // Determine if we should retry or abandon
                    if (this.shouldRetryIntention(intentionKey, error)) {
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
            } else {
                // Queue is empty, generate new options
                try {
                    await optionsGeneration();
                } catch (e) {
                    console.log('optionsGeneration error:', e);
                }
            }

            // Postpone next iteration
            await new Promise(res => setImmediate(res));
        }
    }

    /**
     * Insert or replace intention at specific index in the queue
     * @param {number} index - The queue position
     * @param {Intention} new_intention - The intention to insert
     */
    async putInTheQueue(index, new_intention) {
        // Check if the index is valid
        if (index < 0 || index >= this.intention_queue.length) {
            console.log(`Invalid index ${index}. Queue length: ${this.intention_queue.length}`);
            return;
        }

        if (index == 0) {
            const currentIntention = this.intention_queue[index];
            
            // Stop the current intention at position 0
            try {
                if (this.intention_queue[index]) {
                    await this.intention_queue[index].stop(QUEUE_SWAP_STOP_CODE);
                    console.log(`Stopped intention ${currentIntention?.predicate || 'undefined'} at index 0`);
                }
            } catch (error) {
                console.log("Error stopping intention at index 0:", error);
            }
            
            // Insert the new intention at position 0
            this.intention_queue[index] = new_intention;
            
            // Move the old intention to position 1
            this.intention_queue[index + 1] = currentIntention;
            
            console.log(`Swapped intentions: new intention ${new_intention.predicate} at index 0, old intention ${currentIntention?.predicate || 'undefined'} moved to index 1`);
        } else {
            // For indexes other than 0, just replace - no need to stop queued intentions
            this.intention_queue[index] = new_intention;
            console.log(`Replaced intention at index ${index}`);
        }
    }

    /**
     * Logging utility
     */
    log(...args) {
        console.log(...args);
    }
}

export { IntentionRevision };