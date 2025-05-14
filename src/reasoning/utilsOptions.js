import {storedParcels, me, distance, deliverySpots, parcelSpawners, findNearestDeliverySpot, findFarthestParcelSpawner, findBestOption } from "../agent/index.js"
import { newAgent } from "../autonomousRider.js";


function optionsGeneration() {

    /**
     * Options generation
     */
    const options = [];
    console.log("STORED PARCELS", storedParcels)

    for (const parcel of storedParcels.values()) {
        if (!parcel.carriedBy) {
            options.push(['go_pick_up', parcel.x, parcel.y, parcel.id]);
        } 
    }

    /**
     * Find the nearest delivery zone
     */
    // This means no parcel are perceived
    if (options.length == 0 ) {
        // If the agent are bringing some parcels go to deliver
        if(me.parcelsImCarrying > 0) {
            const best_spot = findNearestDeliverySpot(me);

            options.push(['go_deliver', best_spot[0], best_spot[1]]);

        // Otherwise move the agents to looking for parcels
        } else {
            const best_spot = findFarthestParcelSpawner(me);
            options.push(['go_to', best_spot[0], best_spot[1]]);
        }
    }

    console.log("OPTIONS", options)

    /**
     * Options filtering
     */
    const best_option = findBestOption(options, me);

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