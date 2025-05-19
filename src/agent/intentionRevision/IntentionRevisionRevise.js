import { IntentionRevision } from "./index.js"
import { GO_DELIVER, GO_PICK_UP, GO_TO, Intention, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, getFinalReward, me } from "../index.js";


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
            this.intention_queue[1] = intention;
            if(this.intention_queue[0].predicate[0] == GO_TO && intention.predicate[0] != GO_TO) {
                console.log("Stopping...");
                this.intention_queue[0].stop();
            }
        }else{
            this.intention_queue[0] = intention;
        }

        /**
         * Compare intention and re-order
         */
        if(this.intention_queue[0].predicate[0] == GO_DELIVER && intention.predicate[0] == GO_PICK_UP) {
            
            const delivery_pos = {x: this.intention_queue[0].predicate[1], y: this.intention_queue[0].predicate[2]}

            // TODO: change getFinalReward since I already have the position of the delivery spot
            const final_reward = getFinalReward(this.intention_queue[0].predicate[0], me.carriedReward, MOVEMENT_DURATION, MOVEMENT_STEPS, PDI, me, delivery_pos);

            console.log("FINAL REWARD", final_reward);
            // const best_option = findBestOption(this.intention_queue, me);
            // if(best_option != this.intention_queue[0]) {
            //     const tmp = this.intention_queue[0];
            //     this.intention_queue[0].stop();
            //     this.intention_queue[1] = tmp;
            // }
        }
        console.log("QUEUE:", this.intention_queue);
    }
}

export {IntentionRevisionRevise};