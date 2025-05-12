/**
 * Intention
 */

import { planLibrary } from "../planning/index.js";

class Intention {
    // Plan currently used for achieving the intention
    #current_plan;

    // This is used to stop the intention
    #stopped = false;
    get stopped () {
        return this.#stopped;
    }
    stop () {
        this.log( 'stop intention', ...this.#predicate );
        this.#stopped = true;
        if (this.#current_plan)
            this.#current_plan.stop();
    }

    /**
     * #parent refers to caller
     */
    #parent;

    /**
     * @type { any[] } #predicate is in the form ['go_to', x, y]
     */
    get predicate () {
        return this.#predicate;
    }
    /**
     * @type { any[] } #predicate is in the form ['go_to', x, y]
     */
    #predicate;

    constructor (parent, predicate) {
        this.#parent = parent;
        this.#predicate = predicate;
    }

    log (...args) {
        if (this.#parent && this.#parent.log)
            this.#parent.log('\t', ...args)
        else
            console.log(...args)
    }
    
    #started = false;
    
    /**
     * using the plan library to achieve an intention
     */
    async achieve () {
        // Cannot start twice
        if(this.#started)
            return this;
        else
            this.#started = true;

        // Trying all plans in the library
        for (const planClass of planLibrary) {
            
            // if stopped then quit
            if (this.stopped) throw ['stopped intention', ...this.predicate];
            
            // if plan is 'statically' applicable
            if (planClass.isApplicableTo(...this.predicate)) {
                // Plan is instantiated
                this.#current_plan = new planClass(this.#parent);
                this.log('Achieving intention', ...this.predicate, 'with plan', planClass.name);
                
                // Plan is executed and result is returned
                try {
                    const plan_res = await this.#current_plan.execute(...this.#predicate);
                    this.log('Succesfull intention', ...this.predicate, 'with plan', planClass.name, 'with result', plan_res);
                    return plan_res;

                // Errors are caught so to continue with next plan
                } catch (error) {
                    this.log('Failed intention', ...this.predicate, 'with plan', planClass.name, 'with error:', ...error);
                }
            }
        }

        // If stopped then quit
        if (this.stopped) throw ['stopped intention', ...this.predicate];

        // No plans have been found to satisfy the intention
        // this.log( 'no plan satisfied the intention ', ...this.predicate );
        throw ['No plan satisfied the intention', ...this.predicate]

    }

}

export {Intention};