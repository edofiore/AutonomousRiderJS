import {IntentionRevision} from "./index.js"

class IntentionRevisionRevise extends IntentionRevision {
    
    async push(predicate) {
        console.log("Revising intention queue. Received", ...predicate);
    }
}

export {IntentionRevisionRevise};