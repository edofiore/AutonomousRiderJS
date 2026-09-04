import { IntentionRevision } from "./index.js";

/**
 * High-level Agent class managing the BDI intention revision cycle.
 */
class Agent {

    constructor () {
        this.intentionRevision = new IntentionRevision();
    }

    /**
     * Start the agent's main intention revision loop.
     */
    async start () {
        console.log("Creating new agent...")
        this.intentionRevision.loop().catch(e => console.error('Intention loop crashed:', e));
    }

    /**
     * Push a new candidate intention predicate to the intention revision queue.
     * @param {Array} predicate - The intention predicate [action, x, y, parcelId]
     */
    async push (predicate) {
        await this.intentionRevision.push(predicate)
    }
}

export {Agent};