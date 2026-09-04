import { Plan } from "./index.js";
import { client } from "../../config/index.js";
import { GO_DELIVER } from "../utils.js";
import { beliefs, ERROR_CODES } from "../index.js";

class GoDeliver extends Plan {
    static isApplicableTo (go_deliver, x, y, id) {
            return go_deliver == GO_DELIVER;
    }
    
    async execute (go_deliver, x, y) {
        if (this.stopped) throw [ERROR_CODES.STOPPED]; // if stopped then quit
        if (!(beliefs.me?.carried_parcels_count > 0)) {
            throw [ERROR_CODES.NOTHING_TO_DELIVER];
        }
        if (this.stopped) throw [ERROR_CODES.STOPPED]; // if stopped then quit

        const tx = parseInt(x), ty = parseInt(y);
        await this.subIntention( ['go_to', tx, ty] );
        if (this.stopped) throw [ERROR_CODES.STOPPED]; // if stopped then quit

        if (beliefs.me.x !== tx || beliefs.me.y !== ty) {
            throw [ERROR_CODES.DELIVERY_FAILED, 'not on the delivery tile',
                   { x: beliefs.me.x, y: beliefs.me.y }, { x: tx, y: ty }];
        }

        console.log("DELIVERYING AT: ", tx, ty, "(INTENTION)");
        const delivered = await client.emitPutdown();

        if (!Array.isArray(delivered) || delivered.length === 0) {
            throw [ERROR_CODES.DELIVERY_FAILED, 'putdown returned no parcels', tx, ty];
        }
        console.log(`Delivered ${delivered.length} parcels at (${tx},${ty})`);
        return true;    
    } 
}

export { GoDeliver };