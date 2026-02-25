import { beliefs } from "./index.js"

/**
 * Update the main info about the agent.
 * @param {{ id, name, x, y, score }} agent
 */
const updateInfoAgent = ({ id, name, x, y, score }) => {
    if (x % 1 != 0 || y % 1 != 0) // skip intermediate positions (0.4 or 0.6)
        return;

    beliefs.me.id = id;
    beliefs.me.name = name;
    beliefs.me.x = x;
    beliefs.me.y = y;
    beliefs.me.score = score;
}

export { updateInfoAgent };
