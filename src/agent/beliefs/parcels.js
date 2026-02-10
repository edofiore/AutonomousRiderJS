import { beliefs } from "./index.js"

/**
 * @type { Parcel } perceivedParcels
 */

const updatePerceivedParcels = async ( perceivedParcels ) => {
    
    let current_carried_parcels = 0;
    let current_carried_reward = 0;

    // Adds new uncarried perceived parcels
    for (const p of perceivedParcels) {

        // Adds parcels that are perceived and not being carried by any agent
        if( !p.carriedBy && !beliefs.storedParcels.has(p.id) ){
            beliefs.storedParcels.set( p.id, p);
        } 
        
        // Updates parcels that are now being carried
        else if( p.carriedBy ) {
            
            // Removes parcels that are now being carried
            if ( beliefs.storedParcels.has(p.id) ) {
                beliefs.storedParcels.delete( p.id );
            }

            // Update info about the parcels I'm carrying
            if ( p.carriedBy == beliefs.me.id ) {
                current_carried_parcels += 1;
                current_carried_reward += p.reward;
            }
        }
    }

    beliefs.me.carried_parcels_count = current_carried_parcels;
    beliefs.me.total_carried_reward = current_carried_reward;
    
    // Remove parcels that are no more perceived
    for ( const p of beliefs.storedParcels.values() ) {
        if ( perceivedParcels.map( p => p.id ).find( id => id == p.id ) == undefined ) {
            beliefs.storedParcels.delete( p.id );
        }
    }
}

export { updatePerceivedParcels };