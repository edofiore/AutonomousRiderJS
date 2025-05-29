import { Plan } from "./index.js";
import { client } from "../../config/index.js";
import { GO_DELIVER } from "../utils.js";
import { beliefs } from "../index.js";

export class GoDeliver extends Plan {
    static isApplicableTo (go_deliver, x, y, id) {
            return go_deliver == GO_DELIVER;
    }
    
    async execute (go_deliver, x, y) {
        if (this.stopped) throw ['stopped']; // if stopped then quit
        if (!beliefs.me?.parcelsImCarrying > 0) {
            throw ['Nothing to deliver'];
        }
        if (this.stopped) throw ['stopped']; // if stopped then quit
        await this.subIntention( ['go_to', parseInt(x), parseInt(y)] );
        if (this.stopped) throw ['stopped']; // if stopped then quit
        console.log("DELIVERYING AT: ", x, y, "(INTENTION)");
        if(beliefs.me.x == x && beliefs.me.y == y){
            await client.emitPutdown();
        }
        if (this.stopped) throw ['stopped']; // if stopped then quit
        return true;    
    } 

    // async execute (go_deliver, x, y) {
    //     let nearest = Number.MAX_VALUE;
    //     let best_spot = [];
    //     for (const deliverySpot of deliverySpots) {
    //         let current_d = distance( {x:parseInt(deliverySpot[0]), y:parseInt(deliverySpot[1])}, me )
    //         if ( current_d < nearest ) {
    //             best_spot = deliverySpot;
    //             nearest = current_d
    //         }
    //     }
    //     if (this.stopped) throw ['stopped']; // if stopped then quit
    //     await this.subIntention( ['go_to', parseInt(best_spot[0]), parseInt(best_spot[1])] );
    //     if (this.stopped) throw ['stopped']; // if stopped then quit
    //     console.log("DELIVERYING AT: ", best_spot[0], best_spot[1], "(INTENTION)");
    //     if(me.x == best_spot[0] && me.y == best_spot[1]){
    //         await client.emitPutdown();
    //     }
    //     if (this.stopped) throw ['stopped']; // if stopped then quit
    //     return true;    
    // } 
}