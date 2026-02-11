import { Intention, DEFAULT_STOP_CODE } from "../index.js";

export class Plan {

    // This is an array of sub intention. Multiple ones could eventually being achieved in parallel.
    #sub_intentions = [];

    async subIntention(predicate) {
        const sub_intention = new Intention(this, predicate);
        this.#sub_intentions.push(sub_intention);
        return await sub_intention.achieve();
    }
    
    // This is used to stop the plan
    #stopped = 0; // false

    async stop (stopCode) {
        this.log('Stop plan with stop code:', stopCode);
        this.#stopped = stopCode || DEFAULT_STOP_CODE;
        for(const i of this.#sub_intentions) {
            await i.stop(stopCode);
        }
    }

    get stopped() {
        return this.#stopped;
    }

    /**
     * #parent refers to caller
     */
    #parent;

    constructor (parent) {
        this.#parent = parent; 
    }

    log  (...args) {
        if (this.#parent && this.#parent.log) {
            this.#parent.log('\t', ...args)
        } else {
            console.log(...args)
        }
    }
}