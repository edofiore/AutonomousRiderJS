import { client } from "../../config/index.js";

/**
 * @type { {id:string, name:string, x:number, y:number, score:number} }
 */
const me = {id: null, name: null, x: null, y: null, score: null, parcelsImCarrying: null};

function updateInfoAgent({id, name, x, y, score}) {

    console.log("Updating info about me (\%s)...", name)

    me.id = id
    me.name = name
    me.x = x
    me.y = y
    me.score = score

    console.log("ME", me)
    console.log("Info updated")
}

/**
 * 
 * @param {*} perceivedParcels 
 */
async function updateCarryingParcels(perceivedParcels) {

    let count = 0;
    perceivedParcels.map(parcel => {
        if(parcel.carriedBy == me.id)
            count += 1
    })

    if (count != me.parcelsImCarrying)
        me.parcelsImCarrying = count
}

// client.onYou( ( {id, name, x, y, score} ) => {
//     me.id = id
//     me.name = name
//     me.x = x
//     me.y = y
//     me.score = score
// } )

export {me, updateInfoAgent, updateCarryingParcels};