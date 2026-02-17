import { distance } from "../index.js";
import { beliefs, constantBeliefs } from "./index.js";

/**
 * Update the info about the other perceived agents
 * @param {MeAgent} agents 
 */

const start = Date.now();
const updateInfoOtherAgents = (agents) => {

    const timestamp = Date.now() - start;
    for(const a of agents) {
        if ( a.x % 1 != 0 || a.y % 1 != 0 ) // skip intermediate values (0.6 or 0.4)
            continue;

        const log = {
            name: a.name,
            x: a.x,
            y: a.y,
            score: a.score,
            penalty: a.penalty,
            timestamp: timestamp,
            direction: 'none'
        }

        if(beliefs.otherAgents.has( a.id )) {
            const previous_log = beliefs.otherAgents.get( a.id );
    
            if ( previous_log != undefined ) {
                if ( previous_log.x < a.x ) log.direction = 'right';
                else if ( previous_log.x > a.x ) log.direction = 'left';
                else if ( previous_log.y < a.y ) log.direction = 'up';
                else if ( previous_log.y > a.y ) log.direction = 'down';
            }
        }
        
        beliefs.otherAgents.set( a.id, log);

        // compute if within perceiving area
        let prettyPrint = Array.from(beliefs.otherAgents.values()).map( (log) => {
            const {timestamp,name,x,y,direction} = log;
            const distance_from_me = distance( beliefs.me, {x,y} );
            return `${name}(${direction},${ distance_from_me < constantBeliefs.config.AOD})@${timestamp}:${x},${y}`;
        }).join(' ');
        
        console.log("Other agents", prettyPrint);
    }
}

export { updateInfoOtherAgents };