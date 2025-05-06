import { IntentionRevisionQueue, IntentionRevisionReplace, IntentionRevisionRevise } from "./index.js";

class Agent {
    /**
     * TODO: Incorporate the intention_revision behavior, choosing one push() 
    */

    constructor () {
        // this.intentionRevision = new IntentionRevisionQueue();
        this.intentionRevision = new IntentionRevisionReplace();
        // this.intentionRevision = new IntentionRevisionRevise();
    }

    async start () {
        console.log("Creating new agent...")
        this.intentionRevision.loop();  // Start intentions loop
    }

    async push (predicate) {
        await this.intentionRevision.push(predicate)
    }

    // async intentionLoop() {
    //     while (true) {
    //         const intention = this.intention_queue.shift();
    //         if (intention) 
    //             await intention.achieve();
    //         await new Promise( res => setImmediate(res));
    //     }
    // }

    // async queue (desire, ...args) {
    //     const last = this.intention_queue.at(this.intention_queue.length - 1);
    //     const current = new Intention(desire, ...args);
    //     if (current !== last)
    //         this.intention_queue.push(current)
    // }

    async stop() {
        console.log("Stop agent queued intentions!");
        for (const intention of this.intention_queue) {
            intention.stop();
        }
    }

    /**
     * TODO: Choose one from IntentionRevisionQueue, IntentionRevisionReplace or IntentionRevisionRevise
     */
    // async push(predicate) {
    //     // Check if already queued
    //     const last = this.intention_queue.at(this.intention_queue.length - 1);
    //     if (last && last.predicate.join(' ') == predicate.join(' ') && last.predicate[0] != 'go_deliver') {
    //         return; // Intention is already being achieved
    //     }
    //     console.log('push', predicate);
    //     const intention = new Intention(this, predicate);
    //     this.intention_queue.push(intention);
    //     // Force current intention stop
    //     if (last) {
    //         last.stop();
    //     }
    // }

}

export {Agent};