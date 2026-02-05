import { beliefs, GO_DELIVER, GO_PICK_UP, optionsGeneration } from "../index.js";

/**
 * From intention_revision.js in lab_4 (2025)
 */

class IntentionRevision {
    #intention_queue = new Array();

    get intention_queue () {
        return this.#intention_queue;
    }

    set intention_queue (buffer) {
        this.#intention_queue = [...buffer]
    }

    // Return True if the intention is already in the queue
    isAlreadyQueued = (predicate) => {
        return this.intention_queue.find( (i) => i.predicate.join(' ') == predicate.join(' ') )
    } 

    async loop () {
        while (true) {
            // Consumes intention_queue if not empty
            if (this.intention_queue.length > 0) {
                console.log("IntentionRevision.loop", this.intention_queue.map(i=>i.predicate));

                // Current intention
                const intention = this.intention_queue[0];

                // Is queued intention still valid? Do I still want to achieve it?
                if(!intention.isStillValid()) {
                    console.log("Skipping intention because no more valid", intention.predicate);
                    this.intention_queue.shift();
                    continue;
                }

                // Start achieving intention
                await intention.achieve()
                // Catch eventual error and continue
                .catch( error => {
                    console.log( 'Failed intention', ...intention.predicate)
                    // this.stop();
                })

                // Remove from the queue
                this.intention_queue.shift();
            } else {
                optionsGeneration();
            }

            // Postpone next iteration at setImmediate
            await new Promise( res => setImmediate(res));
        }
    }

    async putInTheQueue (index, new_intention) {
    
        console.log("QUEUE PRE PUT", this.intention_queue.map(i => i?.predicate));
    
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
                    await this.intention_queue[index].stop();
                    console.log(`Stopped intention ${this.intention_queue[index].predicate} at index 0`);
                }
            } catch (error) {
                console.log("Error stopping intention at index 0:", error);
            }
            
            // Insert the new intention at position 0
            this.intention_queue[index] = new_intention;
            
            // Move the old intention to position 1
            this.intention_queue[index+1] = currentIntention;
            
            console.log("Swapped intentions: new intention at index 0, old intention moved to index 1");
            
        } else {        
            // For indices other than 0, just replace - no need to stop queued intentions
            this.intention_queue[index] = new_intention;
            console.log(`Replaced intention at index ${index}`);
        }
    
        console.log("QUEUE POST PUT", this.intention_queue.map(i => i?.predicate));
        return;
    }


    log (...args) {
        console.log(...args)
    }

}

export {IntentionRevision};

