import { IntentionRevision } from "./index.js";
import { Intention } from "../index.js";

class IntentionRevisionReplace extends IntentionRevision {

    async push (predicate) {
        // Check if already queued
        const last = this.intention_queue.at(this.intention_queue.length - 1);
        if(last && last.predicate.join(' ') == predicate.join(' ')) {
            return; // intention is already being achieved
        }

        console.log( "IntentionRevisionReplace.push", predicate);
        const intention = new Intention(this, predicate);
        this.intention_queue.push(intention);

        // Force current intention stop
        if (last) {
            last.stop();
        }
    }
}

export {IntentionRevisionReplace};