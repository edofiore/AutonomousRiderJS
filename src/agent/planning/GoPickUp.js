import { Plan } from "./index.js";
import { client } from "../../config/index.js";
import { GO_PICK_UP } from "../utils.js";

export class GoPickUp extends Plan {
    static isApplicableTo (go_pick_up, x, y, id) {
        return go_pick_up == GO_PICK_UP;
    }

    async execute (go_pick_up, x, y) {
        console.log("Executing go_pick_up...")
        if (this.stopped) throw ['stopped']; // if stopped then quit
        await this.subIntention( ['go_to', x, y]);
        if (this.stopped) throw ['stopped']; // if stopped then quit
        await client.emitPickup();
        if (this.stopped) throw ['stopped']; // if stopped then quit
        return true;    
    }
}