import { IntentionRevision } from "./index.js"
import { GO_DELIVER, GO_PICK_UP, GO_TO, Intention, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, getFinalReward, me, putInFirstPosition, storedParcels, swapIntentions } from "../index.js";


class IntentionRevisionRevise extends IntentionRevision {
    
    // async push(predicate) {
    //     console.log("Revising intention queue. Received", ...predicate);
    //      // TODO
    //     // - order intentions based on utility function (reward - cost) (for example, parcel score minus distance)
    //     // - eventually stop current one
    //     // - evaluate validity of intention
    // }

    async push ( predicate ) {
        // Check if already queued
        if ( this.intention_queue.find( (i) => i.predicate.join(' ') == predicate.join(' ') ) )
            return; // intention is already queued
        
        const new_intention = new Intention( this, predicate );
        // this.intention_queue.push( intention );

        /**
         * TODO: 
         * - if the agent is going to pick up a specific parcel, but along his path there is another pack, he must pick up that package;
         * - the same in the case he's bringing packages and along the path pass over a delivery spot, he must deliver the packages he has
         */

        // If the first position of the queue is occupied, evaluate the intentions
        if(this.intention_queue[0]){

            // If the current intention is "go_to" and the new intention is "go_pick_up"
            if(this.intention_queue[0].predicate[0] == GO_TO && new_intention.predicate[0] == GO_PICK_UP) {
                this.intention_queue[1] = new_intention;
                console.log("Stopping...");
                this.intention_queue[0].stop();

            // Otherwise if the current intention is "go_deliver" or "go_pick_up"
            } else if (this.intention_queue[0].predicate[0] == GO_DELIVER || this.intention_queue[0].predicate[0] == GO_PICK_UP) {
                this.intention_queue[1] = new_intention;

                /**
                 * Compare intention and re-order
                 */
                // If the new intention is "go_deliver" or "go_pick_up"
                if(new_intention.predicate[0] == GO_PICK_UP || new_intention.predicate[0] == GO_DELIVER) {
                    
                    // const delivery_pos = {x: this.intention_queue[0].predicate[1], y: this.intention_queue[0].predicate[2]}
                    // const parcel_pos = {x: intention.predicate[1], y: intention.predicate[2]}
                    // const reward_parcel = storedParcels.get(intention.predicate[3]).reward

                    // // TODO: change getFinalReward since I already have the position of the delivery spot
                    // const deliver_final_reward = getFinalReward(this.intention_queue[0].predicate[0], me.carriedReward, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, me, delivery_pos);
                    // const pickup_final_reward = getFinalReward(intention.predicate[0], me.carriedReward, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, me, parcel_pos, reward_parcel);

                    // console.log("FINAL REWARD", deliver_final_reward, pickup_final_reward);

                    /**
                     * TODO: Decide if to swap 2 intentions or simply stop the first one  
                     */
                    const swap = swapIntentions(this.intention_queue[0], new_intention, me, MOVEMENT_DURATION, MOVEMENT_STEPS, parseInt(PDI), storedParcels)

                    // If true 
                    if(swap) {
                        // console.log("Stopping...");
                        // this.intention_queue[0].stop();
                        this.intention_queue = putInFirstPosition(new_intention, this.intention_queue);
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
        }
        
        console.log("QUEUE:", this.intention_queue);
    }
}

export {IntentionRevisionRevise};