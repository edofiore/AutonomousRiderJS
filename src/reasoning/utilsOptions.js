import {Beliefs, findNearestDeliverySpot, findFarthestParcelSpawner, findBestOption, GO_TO, GO_DELIVER, GO_PICK_UP } from "../agent/index.js"
import { newAgent } from "../autonomousRider.js";


function optionsGeneration() {

    // const me = beliefs.me;

    /**
     * Options generation
     */
    const options = [];
    console.log("STORED PARCELS", Beliefs.storedParcels)

    for (const parcel of Beliefs.storedParcels.values()) {
        if (!parcel.carriedBy) {    // TODO: Check if this is necessary, at the moment we store only free parcels
            options.push([GO_PICK_UP, parcel.x, parcel.y, parcel.id]);
        } 
    }

    /**
     * Find the nearest delivery zone
     */
    // This means no parcel are perceived
    // if (storedParcels.length == 0 ) {
    if (options.length == 0 ) {
        // If the agent are bringing some parcels go to deliver
        /**
         * TODO: dovrei calcolare il reward finale? Magari andare a deliverare solo se il final reward fosse > 0? 
         */
        if(Beliefs.me.parcelsImCarrying > 0) {
            const best_spot = findNearestDeliverySpot(Beliefs.me);

            options.push([GO_DELIVER, best_spot[0], best_spot[1]]);

        // Otherwise move the agents away to looking for parcels
        } else {
            const best_spot = findFarthestParcelSpawner(Beliefs.me);
            options.push([GO_TO, best_spot[0], best_spot[1]]);
        }
    }

    console.log("OPTIONS", options)

    /**
     * Options filtering
     */
    const best_option = findBestOption(options, Beliefs.storedParcels, Beliefs.me);

    /**
     * Find the nearest delivery zone
     */
    // if(options.length == 0 && me.parcelsImCarrying > 0){
    //     let nearestDeliver = Number.MAX_VALUE;
    //     let best_spot = [];
    //     for (const deliverySpot of deliverySpots) {
    //         let current_d = distance( {x:parseInt(deliverySpot[0]), y:parseInt(deliverySpot[1])}, me )
    //         if ( current_d < nearestDeliver ) {
    //             best_spot = deliverySpot;
    //             nearestDeliver = current_d
    //         }
    //     }
    //     // if(distance({x:best_spot[0],y:best_spot[1]}, me) <= 3){
    //     best_option = ['go_deliver', best_spot[0], best_spot[1]];
    //     // }
    // }


    /**
     * Best option is selected
     */
    if (best_option) {
        console.log("BEST OPTION",best_option)
        newAgent.push(best_option);
    }
}

export { optionsGeneration };