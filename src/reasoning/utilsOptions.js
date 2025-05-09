import {storedParcels, me, distance, deliverySpots } from "../agent/index.js"
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
        }
    }

    /**
     * Find the nearest delivery zone
     */
    let nearestDeliver = Number.MAX_VALUE;
    let best_spot = [];
    for (const deliverySpot of deliverySpots) {
        let current_d = distance( {x:parseInt(deliverySpot[0]), y:parseInt(deliverySpot[1])}, me )
        if ( current_d < nearestDeliver ) {
            best_spot = deliverySpot;
            nearestDeliver = current_d
        }
    }

    // if(best_option && me.parcelsImCarrying > 0){
    if(options.length == 0 && me.parcelsImCarrying > 0){
        // if(distance({x:best_spot[0],y:best_spot[1]}, me) <= 3){
        best_option = ['go_deliver', best_spot[0], best_spot[1]];
        // }
    }

    /**
     * Best option is selected
     */
    if (best_option) {
        console.log("BEST OPTION",best_option)
        newAgent.push(best_option);
    }
}