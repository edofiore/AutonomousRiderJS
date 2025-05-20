import { beliefs } from "./index.js"

/**
 * @type { Map< string, {id: string, carriedBy?: string, x:number, y:number, reward:number} > }
 */
// const storedParcels = new Map();

const updateParcelsPerceived = async ( perceivedParcels ) => {
    
    console.log("Updating perceived parcels...")
    console.log("PERCEIVED PARCELS", perceivedParcels)
    // Adds new uncarried perceived parcels
    for (const p of perceivedParcels) {
        if(!p.carriedBy && !beliefs.storedParcels.has(p.id)){
            console.log("Storing parcel...")
            beliefs.storedParcels.set( p.id, p)
            console.log("Updated stored parcels...", beliefs.storedParcels)
        // Removes parcels that are now being carried
        } else if(p.carriedBy && beliefs.storedParcels.has(p.id)) {
            console.log("DELETING PARCEL", p.id)
            beliefs.storedParcels.delete( p.id );
        }
    }
    
    // Remove parcels that are nomore perceived
    for ( const p of beliefs.storedParcels.values() ) {
        if ( perceivedParcels.map( p => p.id ).find( id => id == p.id ) == undefined ) {
            beliefs.storedParcels.delete( p.id );
        }
    }
}

export { updateParcelsPerceived };