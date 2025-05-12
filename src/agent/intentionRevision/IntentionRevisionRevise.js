import {IntentionRevision} from "./index.js"
import { Intention } from "../index.js";


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
            if(this.intention_queue[0].predicate[0] == "go_to" && intention.predicate[0] != "go_to") {
                this.intention_queue[1] = intention;
                console.log("Stopping...")
                this.intention_queue[0].stop();
            }
        }else{
            this.intention_queue[0] = intention;
        }
        console.log("QUEUE:", this.intention_queue);
    }
}

export {IntentionRevisionRevise};