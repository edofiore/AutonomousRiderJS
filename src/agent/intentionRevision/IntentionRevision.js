import { storedParcels } from "../belief/index.js";

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

    async loop () {
        while (true) {
            // Consumes intention_queue if not empty
            if (this.intention_queue.length > 0) {
                console.log("IntentionRevision.loop", this.intention_queue.map(i=>i.predicate));

                // Current intention
                const intention = this.intention_queue[0];

                // Is queued intention still valid? Do I still want to achieve it?
                // TODO: this hard-coded implementation is an example
                let id = intention.predicate[2]
                let p = storedParcels.get(id)
                if (p && p.carriedBy) {
                    console.log("Skipping intention because no more valid", intention.predicate)
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

