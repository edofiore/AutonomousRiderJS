import { IntentionRevisionQueue, IntentionRevisionReplace, IntentionRevisionRevise } from "./index.js";

class Agent {

    constructor () {
        // this.intentionRevision = new IntentionRevisionQueue();
        // this.intentionRevision = new IntentionRevisionReplace();
        this.intentionRevision = new IntentionRevisionRevise();
    }

    async start () {
        console.log("Creating new agent...")
        this.intentionRevision.loop();  // Start intentions loop
    }

    async push (predicate) {
        await this.intentionRevision.push(predicate)
    }

    async stop() {
        console.log("Stop agent queued intentions!");
        for (const intention of this.intention_queue) {
            intention.stop();
        }
    }
}

export {Agent};