import { Plan } from "./index.js";
import dijkstra from 'graphology-shortest-path';
import { client } from "../../config/index.js";
import { beliefs, constantBeliefs, GO_TO } from "../index.js";


export let path = [];
export class BlindMove extends Plan {
    static isApplicableTo ( go_to, x, y ) {
        return go_to == GO_TO;
    }

    
    async execute (go_to, x, y) {
        console.log("Executing go_to...")

        // const me = beliefs.me;

        if ( beliefs.me.x != x || beliefs.me.y != y ) {

            if (this.stopped) throw ['stopped']; // if stopped then quit

            let myPos = Math.floor(beliefs.me.x) + "-" + Math.floor(beliefs.me.y);
            let dest = Math.floor(x) + "-" + Math.floor(y);

            // console.log("MYPOS", myPos)
            // console.log("DESTINATION", dest)
            
            path = dijkstra.bidirectional(constantBeliefs.map.mapGraph, myPos, dest);
            // console.log("PATH", path)

            path.shift();
            let nextCoordinates;

            if (this.stopped) throw ['stopped']; // if stopped then quit

            for(let nextDest of path){
                nextCoordinates = nextDest.split("-");
                
                // TODO deliver if on a delivery spot

                if( nextCoordinates[0] > beliefs.me.x){
                    await client.emitMove('right');
                }else if(nextCoordinates[0] < beliefs.me.x){
                    await client.emitMove('left');
                }else if( nextCoordinates[1] > beliefs.me.y){
                    await client.emitMove('up');
                }else if(nextCoordinates[1] < beliefs.me.y){
                    await client.emitMove('down');
                }

                if ( this.stopped ) throw ['stopped']; // if stopped then quit
            }
        }

        if ( this.stopped ) throw ['stopped']; // if stopped then quit

        return true;
    }

    // async execute ( go_to, x, y ) {

    //     while ( me.x != x || me.y != y ) {

    //         if ( this.stopped ) throw ['stopped']; // if stopped then quit

    //         let moved_horizontally;
    //         let moved_vertically;
            
    //         // this.log('me', me, 'xy', x, y);

    //         if ( x > me.x )
    //             moved_horizontally = await client.emitMove('right')
    //             // status_x = await this.subIntention( 'go_to', {x: me.x+1, y: me.y} );
    //         else if ( x < me.x )
    //             moved_horizontally = await client.emitMove('left')
    //             // status_x = await this.subIntention( 'go_to', {x: me.x-1, y: me.y} );

    //         if (moved_horizontally) {
    //             me.x = moved_horizontally.x;
    //             me.y = moved_horizontally.y;
    //         }

    //         if ( this.stopped ) throw ['stopped']; // if stopped then quit

    //         if ( y > me.y )
    //             moved_vertically = await client.emitMove('up')
    //             // status_x = await this.subIntention( 'go_to', {x: me.x, y: me.y+1} );
    //         else if ( y < me.y )
    //             moved_vertically = await client.emitMove('down')
    //             // status_x = await this.subIntention( 'go_to', {x: me.x, y: me.y-1} );

    //         if (moved_vertically) {
    //             me.x = moved_vertically.x;
    //             me.y = moved_vertically.y;
    //         }
            
    //         if ( ! moved_horizontally && ! moved_vertically) {
    //             this.log('stucked');
    //             throw 'stucked';
    //         } else if ( me.x == x && me.y == y ) {
    //             // this.log('target reached');
    //         }
            
    //     }

    //     return true;

    // }
}