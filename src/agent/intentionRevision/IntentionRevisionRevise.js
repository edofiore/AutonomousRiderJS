import { IntentionRevision } from "./index.js"
import { GO_DELIVER, GO_PICK_UP, GO_TO, Intention, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, getFinalReward, me, storedParcels } from "../index.js";


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

        // const first = this.intention_queue[0]
        // const second = this.intention_queue[0]
        
        const intention = new Intention( this, predicate );
        // this.intention_queue.push( intention );

        if(this.intention_queue[0]){
            // console.log("INTENTIONNNNNN", this.intention_queue[0].predicate)
            if(this.intention_queue[0].predicate[0] == GO_TO && intention.predicate[0] == GO_PICK_UP) {
                this.intention_queue[1] = intention;
                console.log("Stopping...");
                this.intention_queue[0].stop();
            } else if (this.intention_queue[0].predicate[0] == GO_DELIVER) {
                this.intention_queue[1] = intention;

                /**
                 * Compare intention and re-order
                 */
                if(intention.predicate[0] == GO_PICK_UP) {

                    /**
                     * TODO: put this in a function
                     */
                    
                    const delivery_pos = {x: this.intention_queue[0].predicate[1], y: this.intention_queue[0].predicate[2]}
                    const parcel_pos = {x: intention.predicate[1], y: intention.predicate[2]}
                    const reward_parcel = storedParcels.get(intention.predicate[3]).reward

                    // TODO: change getFinalReward since I already have the position of the delivery spot
                    const deliver_final_reward = getFinalReward(this.intention_queue[0].predicate[0], me.carriedReward, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, me, delivery_pos);
                    const pickup_final_reward = getFinalReward(intention.predicate[0], me.carriedReward, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, me, parcel_pos, reward_parcel);

                    console.log("FINAL REWARD", deliver_final_reward, pickup_final_reward);


                    if(pickup_final_reward > deliver_final_reward) {
                        console.log("Stopping...");
                        this.intention_queue[0].stop();
                    }
                    
                    // const best_option = findBestOption(this.intention_queue, me);
                    // if(best_option != this.intention_queue[0]) {
                    //     const tmp = this.intention_queue[0];
                    //     this.intention_queue[0].stop();
                    //     this.intention_queue[1] = tmp;
                    // }
                }
            } else if (this.intention_queue[0].predicate[0] == GO_PICK_UP && intention.predicate[0] != GO_TO) {
                /**
                 * TODO: compare to see the best pickup intention. If it is needed to stop and go for another pickup
                 */

                this.intention_queue[1] = intention;
            }
        }else{
            this.intention_queue[0] = intention;
        }

        
        console.log("QUEUE:", this.intention_queue);
    }
}

export {IntentionRevisionRevise};