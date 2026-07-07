import { beliefs, constantBeliefs } from "./index.js"

/**
 * @type { Parcel } perceivedParcels
 */

const updatePerceivedParcels = async ( perceivedParcels ) => {
    
    let current_carried_parcels = 0;
    let current_carried_reward = 0;

    const now = Date.now();

    // Adds new uncarried perceived parcels
    for (const p of perceivedParcels) {

        // Malformed-sensing guard: the server reads parcel.xy?.x, so a rare
        // race (e.g. mid-putdown on a delivery tile) can deliver a parcel
        // with undefined coordinates or reward. Storing one poisons the
        // scoring pipeline (every calculateScore throws BAD_COORDINATES and
        // optionsGeneration aborts on every tick) — reject it here, at the
        // single point where sensed parcels enter beliefs.
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.reward)) continue;

        // Adds parcels that are perceived and not being carried by any agent
        if( !p.carriedBy ){
            beliefs.storedParcels.set( p.id, { parcel: p, timestamp: now, visible: true} );
        } 
        // Updates parcels that are now being carried
        else {
            // Removes parcels that are now being carried
            beliefs.storedParcels.delete(p.id);

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
    for ( const parcel_data of beliefs.storedParcels.values() ) {

        if ( perceivedParcels.map( p => p.id ).find( id => id == parcel_data.parcel.id ) == undefined ) {
            const decay = ((now - parcel_data.timestamp) / 1000) / constantBeliefs.config.PDI;
            const parcel_current_reward = parcel_data.parcel.reward - decay;

            // NaN-safe: !(x > 0) also catches NaN rewards, which must be
            // deleted too or the entry becomes immortal (NaN <= 0 is false).
            if (!(parcel_current_reward > 0)) {
                beliefs.storedParcels.delete(parcel_data.parcel.id);
            } else {
                beliefs.storedParcels.set(parcel_data.parcel.id, { ...parcel_data, parcel: { ...parcel_data.parcel, reward: parcel_current_reward }, timestamp: now, visible: false });
            }

        } else {
            // Update visibility status for perceived parcels
            beliefs.storedParcels.set(parcel_data.parcel.id, { ...parcel_data, visible: true });
        }
    }
}

const updateStoredParcels = async () => {
    for (const parcel_data of beliefs.storedParcels.values()) {
        if (parcel_data.parcel.carriedBy ) {
            beliefs.storedParcels.delete(parcel_data.parcel.id);
        } else {
            const now = Date.now();
            const decay = ((now - parcel_data.timestamp) / 1000) / constantBeliefs.config.PDI;
            const parcel_current_reward = parcel_data.parcel.reward - decay;

            // NaN-safe: !(x > 0) also catches NaN rewards, which must be
            // deleted too or the entry becomes immortal (NaN <= 0 is false).
            if (!(parcel_current_reward > 0)) {
                beliefs.storedParcels.delete(parcel_data.parcel.id);
            } else {
                beliefs.storedParcels.set(parcel_data.parcel.id, { ...parcel_data, parcel: { ...parcel_data.parcel, reward: parcel_current_reward }, timestamp: now });
            }
        }
    }
}

export { updatePerceivedParcels, updateStoredParcels };