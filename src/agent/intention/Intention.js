/**
 * Intention
 */

import { beliefs } from "../beliefs/beliefs.js";
import { planLibrary } from "../planning/index.js";
import { GO_DELIVER, GO_PICK_UP, GO_TO } from "../utils.js";

class Intention {
    // Plan currently used for achieving the intention
    #current_plan;

    // This is used to stop the intention
    #stopped = false;
    get stopped () {
        return this.#stopped;
    }
    async stop () {
        this.log( 'stop intention', ...this.#predicate );
        this.#stopped = true;
        if (this.#current_plan)
            await this.#current_plan.stop();
    }

    /**
     * #parent refers to caller
     */
    #parent;

    /**
     * @returns { Option[] } #predicate is in the form [action, x, y, parcel_id]
     */
    get predicate () {
        return this.#predicate;
    }
    /**
     * @type { Option[] } #predicate is in the form [action, x, y, parcel_id]
     */
    #predicate;

    /**
     * @param {Object} parent - The caller of the intention
     * @param {Option[]} predicate - The intention description, in the form [action, x, y, parcel_id]
     */
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

    /**
     * Check if the intention is still valid before trying to achieve it
     * @returns {boolean}
    */
    isStillValid () {
        
        const [action, x, y, p_id] = this.#predicate;

        console.log(`Is intention ${action} ${x}-${y} still valid?`);

        if(action == GO_PICK_UP) {
            let p = beliefs.storedParcels.get(p_id);

            if (!p || p.carriedBy || p.reward <= 0) {
                console.log(`Parcel at ${x},${y} is either no longer available or carried by someone!`);
                console.log("Skipping intention because no more valid", this.#predicate);
                return false;
            }
        } else if(action == GO_DELIVER) {
            if (!beliefs.me?.carried_parcels_count || beliefs.me.carried_parcels_count === 0) {
                console.log('Nothing to deliver!');
                console.log("Skipping intention because no more valid", this.#predicate);
                return false;
            }
        }
        // TODO should we consider GO_TO also????

        return true;
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

        if (!this.isStillValid()) {
            this.log('Intention no longer valid:', ...this.#predicate);
            throw ['intention invalidated', ...this.#predicate];
        }

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
                    this.log('Failed intention', ...this.predicate, 'with plan', planClass.name, 'with error:', error);
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