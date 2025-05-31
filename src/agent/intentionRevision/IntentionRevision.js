import { beliefs, GO_DELIVER, GO_PICK_UP } from "../index.js";

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
                // TODO: this hard-coded implementation is an example
                if(intention.predicate[0] == GO_PICK_UP) {
                    let id = intention.predicate[3];
                    let p = beliefs.storedParcels.get(id);
                    if (p && p.carriedBy) {
                        console.log('Nothing to pick up!');
                        console.log("Skipping intention because no more valid", intention.predicate);
                        this.intention_queue.shift();
                        continue;
                    }
                } else if(intention.predicate[0] == GO_DELIVER) {
                    if (beliefs.me?.parcelsImCarrying == 0) {
                        console.log('Nothing to deliver!');
                        console.log("Skipping intention because no more valid", intention.predicate);
                        this.intention_queue.shift();
                        continue;
                    }
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
            }

            // Postpone next iteration at setImmediate
            await new Promise( res => setImmediate(res));
        }
    }


    log (...args) {
        console.log(...args)
    }

}

export {IntentionRevision};

