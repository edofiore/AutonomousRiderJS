import { Plan } from "./index.js";
import { client } from "../../config/index.js";
import { GO_PICK_UP } from "../utils.js";
import { beliefs } from "../beliefs/beliefs.js";

export class GoPickUp extends Plan {
    static isApplicableTo (go_pick_up, x, y, id) {
        return go_pick_up == GO_PICK_UP;
    }

    async execute (go_pick_up, x, y, id) {
        console.log("Executing go_pick_up...")
        let parcel = beliefs?.storedParcels.get(id);
        if (!parcel || parcel.carriedBy) {
            throw ['Parcel is no longer available', id];
        }        
        if (this.stopped) throw ['stopped']; // if stopped then quit
        await this.subIntention( ['go_to', x, y]);
        if (this.stopped) throw ['stopped']; // if stopped then quit
        parcel = beliefs.storedParcels.get(id);
        if (!parcel || parcel.carriedBy) {
            throw ['Parcel is no longer available', id];
        }        
        await client.emitPickup();
        if (this.stopped) throw ['stopped']; // if stopped then quit
        return true;    
    }
}