import { IntentionRevision } from "./index.js";
import { Intention } from "../index.js";

class IntentionRevisionQueue extends IntentionRevision {
    async push (predicate) {
        // Check if already queued
        if ( this.intention_queue.find( (i) => i.predicate.join(' ') == predicate.join(' ') ) )
            return; // intention is already queued

        console.log("IntentionRevisionQueue.push", predicate);
        const intention = new Intention(this, predicate)
        this.intention_queue.push(intention);
    }
}

export {IntentionRevisionQueue};