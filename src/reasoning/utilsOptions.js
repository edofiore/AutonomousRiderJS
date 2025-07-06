import {beliefs, findNearestDeliverySpot, findFarthestParcelSpawner, findBestOption, GO_TO, GO_DELIVER, GO_PICK_UP, isIntentionAlreadyQueued } from "../agent/index.js"
import { newAgent } from "../autonomousRider.js";


async function optionsGeneration() {

    // const me = beliefs.me;
    const intention_queue = newAgent.intentionRevision.intention_queue;

    /**
     * Options generation
     */
    const options = [];
    // console.log("STORED PARCELS", beliefs.storedParcels)

    // For each
    for (const parcel of beliefs.storedParcels.values()) {
        /**
         * TODO: use finalReward instead of parcel reward
         */
        if (!parcel.carriedBy && parcel.reward > 0) {    // TODO: Check if this is necessary, at the moment we store only free parcels
            const new_option = [GO_PICK_UP, parcel.x, parcel.y, parcel.id];
            if (!isIntentionAlreadyQueued(intention_queue, new_option))
                options.push(new_option);
            // options.push([GO_PICK_UP, parcel.x, parcel.y, parcel.id]);
        } 
    }

    /**
     * TODO: control the amount of options I'm generating. I'm generating useless options
     * For example, I'm continuosly generating the same option even if I'm already achieving that intention 
     * 
     * Should I know the intention_queue?
     * 
     */
    // This means no parcel are perceived
    // if (beliefs.storedParcels.length == 0) {
    if (options.length == 0 ) {
        // If the agent are bringing some parcels go to deliver
        /**
         * TODO: dovrei calcolare il reward finale? Magari andare a deliverare solo se il final reward fosse > 0? 
         */


        let new_option = null;

        if(intention_queue.length > 0) {
            const start_pos = {x: intention_queue[0].predicate[1], y: intention_queue[0].predicate[2]}

            if(intention_queue[0].predicate[0] == GO_PICK_UP) {
                if(intention_queue[1] == undefined || intention_queue[1].predicate[0] != GO_PICK_UP ) {
                    // TODO: I should pass the position of the last package the agent will take, not the current package
                    // const start_pos = {x: intention_queue[0].predicate[1], y: intention_queue[0].predicate[2]}
                    const best_spot = findNearestDeliverySpot(start_pos);
                    new_option = [GO_DELIVER, parseInt(best_spot[0]), parseInt(best_spot[1])];
                    // options.push([GO_DELIVER, parseInt(best_spot[0]), parseInt(best_spot[1])]);
                }
            } else if((intention_queue[0].predicate[0] == GO_TO || intention_queue[0].predicate[0] == GO_DELIVER) && intention_queue[1] == undefined) {
                const start_pos = {x: intention_queue[0].predicate[1], y: intention_queue[0].predicate[2]}
                const best_spot = findFarthestParcelSpawner(start_pos);
                new_option = [GO_TO, parseInt(best_spot[0]), parseInt(best_spot[1])];
                // options.push([GO_TO, parseInt(best_spot[0]), parseInt(best_spot[1])]);
            }

        // Otherwise move the agents away to looking for parcels
        } else {
            const best_spot = findFarthestParcelSpawner(beliefs.me);
            new_option = [GO_TO, parseInt(best_spot[0]), parseInt(best_spot[1])];
            // options.push([GO_TO, parseInt(best_spot[0]), parseInt(best_spot[1])]);
        }

        if(new_option && !isIntentionAlreadyQueued(intention_queue, new_option)) {
            options.push(new_option);
        } 
    
    }
    console.log("OPTIONS", options)

    /**
     * Options filtering
     */
    
    // Filter the options from the ones already queued as intentions
    // const filtered_options = options.filter(option => isIntentionAlreadyQueued(intention_queue, option))
    // Find the best option
    const best_option = findBestOption(options, beliefs.storedParcels, beliefs.me);


    /**
     * Best option is selected
     */
    if (best_option) {
        console.log("BEST OPTION",best_option);
        if(!isIntentionAlreadyQueued(intention_queue, best_option)) {
            await newAgent.push(best_option);
        }
        /**
         * TODO: i should check if an option is already queued before to push it
         */
    }
}

export { optionsGeneration };