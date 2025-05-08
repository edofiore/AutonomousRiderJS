/**
 * @type { Map< string, {id: string, carriedBy?: string, x:number, y:number, reward:number} > }
 */
const storedParcels = new Map();

// client.onParcelsSensing( async ( perceivedParcels ) => {} );
const updateParcelsPerceived = async ( perceivedParcels ) => {
    
    console.log("Updating perceived parcels...")
    console.log("PERCEIVED PARCELS", perceivedParcels)
    // Adds new uncarried perceived parcels
    for (const p of perceivedParcels) {
        if(!p.carriedBy && !storedParcels.has(p.id)){
            console.log("Storing parcel...")
            storedParcels.set( p.id, p)
            console.log("Updated stored parcels...", storedParcels)
        // Removes parcels that are now being carried
        } else if(p.carriedBy && storedParcels.has(p.id)) {
            console.log("DELETING PARCEL", p.id)
            storedParcels.delete( p.id );
        }
    }
    
    // Remove parcels that are nomore perceived
    for ( const p of storedParcels.values() ) {
        if ( perceivedParcels.map( p => p.id ).find( id => id == p.id ) == undefined ) {
            storedParcels.delete( p.id );
        }
    }
}

export {storedParcels, updateParcelsPerceived};