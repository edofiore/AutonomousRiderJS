import { distance } from "../index.js";
import { beliefs, constantBeliefs } from "./index.js";

const start = Date.now();

/**
 * Update beliefs about perceived agents.
 * @param {Agent[]} agents
 */
const updateInfoOtherAgents = (agents) => {
    const timestamp = Date.now() - start;

    for (const a of agents) {
        if (a.x % 1 != 0 || a.y % 1 != 0) // skip intermediate positions
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

        const prev = beliefs.otherAgents.get(a.id);
        if (prev) {
            if (prev.x < a.x)      log.direction = 'right';
            else if (prev.x > a.x) log.direction = 'left';
            else if (prev.y < a.y) log.direction = 'up';
            else if (prev.y > a.y) log.direction = 'down';
        }

        beliefs.otherAgents.set(a.id, log);
    }
}

export { updateInfoOtherAgents };
