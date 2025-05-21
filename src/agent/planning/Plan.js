import { Intention } from "../index.js";

export class Plan {

    // This is an array of sub intention. Multiple ones could eventually being achieved in parallel.
    #sub_intentions = [];

    async subIntention(predicate) {
        const sub_intention = new Intention(this, predicate);
        this.#sub_intentions.push(sub_intention);
        return await sub_intention.achieve();
    }
    
    // This is used to stop the plan
    #stopped = false;   // private

    async stop () {
        this.log('Stop plan');
        this.#stopped = true;
        for(const i of this.#sub_intentions) {
            await i.stop();
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