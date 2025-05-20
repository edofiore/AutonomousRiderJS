import { Beliefs } from "./index.js"

/**
 * @type { Map< string, {id: string, carriedBy?: string, x:number, y:number, reward:number} > }
 */
// const storedParcels = new Map();

const updateParcelsPerceived = async ( perceivedParcels ) => {
    
    console.log("Updating perceived parcels...")
    console.log("PERCEIVED PARCELS", perceivedParcels)
    // Adds new uncarried perceived parcels
    for (const p of perceivedParcels) {
        if(!p.carriedBy && !Beliefs.storedParcels.has(p.id)){
            console.log("Storing parcel...")
            Beliefs.storedParcels.set( p.id, p)
            console.log("Updated stored parcels...", Beliefs.storedParcels)
        // Removes parcels that are now being carried
        } else if(p.carriedBy && Beliefs.storedParcels.has(p.id)) {
            console.log("DELETING PARCEL", p.id)
            Beliefs.storedParcels.delete( p.id );
        }
    }
    
    // Remove parcels that are nomore perceived
    for ( const p of Beliefs.storedParcels.values() ) {
        if ( perceivedParcels.map( p => p.id ).find( id => id == p.id ) == undefined ) {
            Beliefs.storedParcels.delete( p.id );
        }
    }
}

export { updateParcelsPerceived };