import {storedParcels, me, distance, deliverySpots, parcelSpawners } from "../agent/index.js"
import { newAgent } from "../autonomousRider.js";


export function optionsGeneration() {

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
    /**
     * TODO: if there is a parcel that from a tile is not perceived, but then from the next tile is visible, a loop start. 
     * This because not seeing the parcel the agent wants to go to deliver, but at the moment he sees something he would go to pickup 
     * the parcel, but the then the moment that it comes back to go to pick up it, the parcel exits from the perceived area, 
     * and so the agent changes again to go to deliver. So we have this loop where the agents continues to move between two tiles, 
     * where from one he doesn't see the parcel, while from the other tile he perceives the parcel
     * 
     */
    // This means no parcel are perceived
    if (options.length == 0 ) {
        // If the agent are bringing some parcels go to deliver
        if(me.parcelsImCarrying > 0) {
            let nearestDeliver = Number.MAX_VALUE;
            let best_spot = [];
            for (const deliverySpot of deliverySpots) {
                let current_d = distance( {x:parseInt(deliverySpot[0]), y:parseInt(deliverySpot[1])}, me )
                if ( current_d < nearestDeliver ) {
                    best_spot = deliverySpot;
                    nearestDeliver = current_d
                }
            }

            options.push(['go_deliver', best_spot[0], best_spot[1]]);

        // Otherwise move the agents to looking for parcels
        } else {
            let farthestDeliver = Number.MIN_VALUE;
            let best_spot = [];
            for (const spawn of parcelSpawners) {
                let current_d = distance( {x:parseInt(spawn[0]), y:parseInt(spawn[1])}, me )
                if ( current_d > farthestDeliver ) {
                    best_spot = spawn;
                    farthestDeliver = current_d
                }
            }
            options.push(['go_to', best_spot[0], best_spot[1]]);
        }
    }

    console.log("OPTIONS", options)

    /**
     * Options filtering
     */
    let best_option;
    let nearest = Number.MAX_VALUE;
    for (const option of options) {
        if(option[0] == 'go_pick_up') {
            const [, x, y] = option;
            console.log("me", me)
            const current_d = distance({x, y}, me);
            console.log("DISTANCE", current_d)
            if (current_d < nearest) {
                best_option = option;
                nearest = current_d;
            }
        } else if (option[0] == 'go_deliver') {
            best_option = option;
        } else if (option[0] == 'go_to') {
            best_option = option;
        }
    }

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