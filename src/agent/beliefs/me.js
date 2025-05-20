import { beliefs } from "./index.js"

/**
 * @type { {id:string, name:string, x:number, y:number, score:number, parcelsImCarrying:number, carriedReward:number} }
 */
// const me = {
//     id: null, 
//     name: null, 
//     x: null, 
//     y: null, 
//     score: null,    // Total score of the agent
//     parcelsImCarrying: null,    // Number of parcels the agent is carrying
//     carriedReward: null     // Total reward the agent is carrying
// };

/**
 * Update the main info about the agent 
 * @param {{string, string, number, number, number}} - {id, name, x, y, score}
 */
const updateInfoAgent = ({id, name, x, y, score}) => {

    console.log("Updating info about me (\%s)...", name)

    beliefs.me.id = id
    beliefs.me.name = name
    beliefs.me.x = x
    beliefs.me.y = y
    beliefs.me.score = score

    console.log("ME", beliefs.me)
    console.log("Info updated")
}

/**
 * Update info about parcels the agent is carrying
 * @param {*} perceivedParcels 
 */
const updateCarryingParcels = async (perceivedParcels) => {

    let count = 0;
    let total_reward = 0;
    perceivedParcels.map(parcel => {
        if(parcel.carriedBy == beliefs.me.id) {
            count += 1;
            total_reward += parcel.reward;
        }
    })

    if (count != beliefs.me.parcelsImCarrying)
        beliefs.me.parcelsImCarrying = count;

    if (total_reward != beliefs.me.carriedReward)
        beliefs.me.carriedReward = total_reward;
}

export { updateInfoAgent, updateCarryingParcels };