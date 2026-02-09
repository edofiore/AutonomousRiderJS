import { beliefs } from "./index.js"

/**
 * @type { MeAgent }
 */

/**
 * Update the main info about the agent 
 * @param { Agent } - {id, name, x, y, score}
 */
const updateInfoAgent = ({id, name, x, y, score}) => {

    if ( x % 1 != 0 || y % 1 != 0 ) // skip intermediate values (0.6 or 0.4)
        return;

    console.log("Updating info about me (%s)...", name)

    beliefs.me.id = id
    beliefs.me.name = name
    beliefs.me.x = x
    beliefs.me.y = y
    beliefs.me.score = score

}

export { updateInfoAgent };