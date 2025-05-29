import { IntentionRevision } from "./index.js"
import { beliefs, constantBeliefs, Intention, putInTheQueue, swapIntentions, GO_TO, GO_DELIVER, GO_PICK_UP } from "../index.js";


class IntentionRevisionRevise extends IntentionRevision {
    
    // async push(predicate) {
    //     console.log("Revising intention queue. Received", ...predicate);
    //      // TODO
    //     // - order intentions based on utility function (reward - cost) (for example, parcel score minus distance)
    //     // - eventually stop current one
    //     // - evaluate validity of intention
    // }

    /**
     * 
     * @param {[action: string, x: number, y: number, parcel_id: number]} predicate 
     * @returns 
     */
    async push ( predicate ) {

        // Check if already queued
        if ( this.isAlreadyQueued(predicate) ) {
            console.log("Intention is already queued!");
            return; // intention is already queued
        }
        
        const new_intention = new Intention( this, predicate );

        /**
         * In this way the deliver intention will be not put immediately after the pick up intention if the agent has not pick up other packages before.
         * This due the fact that when we check the new_intention, the pick-up intention is not already finished, so the agent is not carrying any parcels
        */
        // // Check if the new intention is still valid
        // if (!new_intention.isStillValid()) {
        //     console.log("Skipping invalid intention:", new_intention.predicate);
        //     return; // intention is not still valid
        // }
        // this.intention_queue.push( intention );

        /**
         * TODO: 
         * - if the agent is going to pick up a specific parcel, but along his path there is another pack, he must pick up that package;
         * - the same in the case he's bringing packages and along the path pass over a delivery spot, he must deliver the packages he has
         * - Put new intentions as sub_intentions?
         */

        // If the first position of the queue is occupied, evaluate the intentions
        if(this.intention_queue[0]){

            // If the current intention is "go_to" and the new intention is "go_pick_up" or "go_deliver", stop the "go_to" intention.
            // May happen that a "go_to" intention is added before a deliver even if the agent is picking up a parcel due to delay;
            // in that case we stop the go_to.
            if(this.intention_queue[0].predicate[0] == GO_TO && new_intention.predicate[0] != GO_TO) {
                this.intention_queue[1] = new_intention;
                // console.log("UPDATED QUEUE 1:", this.intention_queue.map(intention => intention.predicate))
                console.log("Stopping...");
                await this.intention_queue[0].stop();
                // console.log("UPDATED QUEUE 2:", this.intention_queue.map(intention => intention.predicate))

            // Otherwise if the current intention is "go_deliver" or "go_pick_up"
            } else if (this.intention_queue[0].predicate[0] == GO_DELIVER || this.intention_queue[0].predicate[0] == GO_PICK_UP) {
                this.intention_queue[1] = new_intention;
                // console.log("UPDATED QUEUE 3:", this.intention_queue.map(intention => intention.predicate))

                /**
                 * Compare intention and re-order
                 */
                // If the new intention is "go_deliver" or "go_pick_up"
                if(new_intention.predicate[0] == GO_PICK_UP || new_intention.predicate[0] == GO_DELIVER) {

                    /**
                     * TODO: Decide if to swap 2 intentions or simply stop the first one  
                     */
                    // Compare if the new intention is better than the first in the queue 
                    const swap = swapIntentions(this.intention_queue[0], new_intention, beliefs.me, constantBeliefs.config?.MOVEMENT_DURATION, 
                        constantBeliefs.config.MOVEMENT_STEPS, constantBeliefs.config.PDI, beliefs.storedParcels)

                    // If true, put the new intention in first position and shift the rest
                    if(swap) {
                        // console.log("Stopping...");
                        // this.intention_queue[0].stop();
                        this.intention_queue = await putInTheQueue(0, new_intention, this.intention_queue);
                        
                        // console.log("UPDATED QUEUE 4:", this.intention_queue.map(intention => intention.predicate))
                    // Otherwise, if the first in the queue is better, compare the new intention with the second one of the queue
                    } else {
                        const swap_again = swapIntentions(this.intention_queue[1], new_intention, beliefs.me, constantBeliefs.config.MOVEMENT_DURATION, 
                        constantBeliefs.config.MOVEMENT_STEPS, constantBeliefs.config.PDI, beliefs.storedParcels)

                        if (swap_again) {
                            this.intention_queue = await putInTheQueue(1, new_intention, this.intention_queue);
                        }
                    }
                    
                    // const best_option = findBestOption(this.intention_queue, me);
                    // if(best_option != this.intention_queue[0]) {
                    //     const tmp = this.intention_queue[0];
                    //     this.intention_queue[0].stop();
                    //     this.intention_queue[1] = tmp;
                    // }
                }
            } 
            // else if (this.intention_queue[0].predicate[0] == GO_PICK_UP && new_intention.predicate[0] != GO_TO) {

            //     /**
            //      * TODO: compare to see the best pickup intention. If it is needed to stop and go for another pickup
            //      */

            //     this.intention_queue[1] = new_intention;
            // }

        // Otherwise, if the queue is empty, put the new intention in the first position of the queue
        } else{
            this.intention_queue[0] = new_intention;
            // console.log("UPDATED QUEUE 0:", this.intention_queue.map(intention => intention.predicate))
        }
        
        console.log("QUEUE:", this.intention_queue.map(intention => intention.predicate));
    }
}

export {IntentionRevisionRevise};