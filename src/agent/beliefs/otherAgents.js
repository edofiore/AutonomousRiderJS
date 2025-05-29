import { distance } from "../index.js";
import { beliefs, constantBeliefs } from "./index.js";

/**
 * Update the info about the other perceived agents
 * @param {MeAgent} agents 
 */

const start = Date.now();
const updateInfoOtherAgents = (agents) => {
    console.log("AGENTS", agents.map((agent) => agent))

    const timestamp = Date.now() - start;
    for(const a of agents) {
        if ( a.x % 1 != 0 || a.y % 1 != 0 ) // skip intermediate values (0.6 or 0.4)
            continue;

        if ( ! beliefs.otherAgents.has( a.id ) )
            beliefs.otherAgents.set(a.id, [])

        const log = {
            id: a.id,
            name: a.name,
            x: a.x,
            y: a.y,
            score: a.score,
            penalty: a.penalty,
            timestamp: timestamp,
            direction: 'none'
        }

        const logs = beliefs.otherAgents.get( a.id );

        if ( logs.length > 0 ) {
            var previous = logs[logs.length-1];
            if ( previous.x < a.x ) log.direction = 'right';
            else if ( previous.x > a.x ) log.direction = 'left';
            else if ( previous.y < a.y ) log.direction = 'up';
            else if ( previous.y > a.y ) log.direction = 'down';
            else log.direction = 'none';
        }
        beliefs.otherAgents.get( a.id ).push( log );

        // compute if within perceiving area
        let prettyPrint = Array.from(beliefs.otherAgents.values()).map( (logs) => {
            const {timestamp,name,x,y,direction} = logs[logs.length-1]
            const d = distance( beliefs.me, {x,y} );
            return `${name}(${direction},${d<constantBeliefs.config.AOD})@${timestamp}:${x},${y}`;
        }).join(' ');
        console.log("Other agents", prettyPrint);
    }
}

export { updateInfoOtherAgents };