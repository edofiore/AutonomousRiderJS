import { beliefs, constantBeliefs } from "./index.js"

/**
 * Update storedParcels from the current perception.
 * Adds new free parcels, removes picked-up ones, and updates carried reward counts.
 * @param {Parcel[]} perceivedParcels
 */
const updatePerceivedParcels = async (perceivedParcels) => {
    let current_carried_parcels = 0;
    let current_carried_reward = 0;
    const now = Date.now();

    for (const p of perceivedParcels) {
        if (!p.carriedBy) {
            beliefs.storedParcels.set(p.id, { parcel: p, timestamp: now, visible: true });
        } else {
            beliefs.storedParcels.delete(p.id);

            if (p.carriedBy == beliefs.me.id) {
                current_carried_parcels += 1;
                current_carried_reward += p.reward;
            }
        }
    }

    beliefs.me.carried_parcels_count = current_carried_parcels;
    beliefs.me.total_carried_reward = current_carried_reward;

    // Update or expire parcels no longer in perception
    for (const parcel_data of beliefs.storedParcels.values()) {
        const stillVisible = perceivedParcels.some(p => p.id == parcel_data.parcel.id);

        if (!stillVisible) {
            const elapsed_s = (now - parcel_data.timestamp) / 1000;
            const decayed_reward = parcel_data.parcel.reward - parseInt(elapsed_s / constantBeliefs.config.PDI);

            if (decayed_reward < 0) {
                beliefs.storedParcels.delete(parcel_data.parcel.id);
            } else {
                beliefs.storedParcels.set(parcel_data.parcel.id, {
                    ...parcel_data,
                    parcel: { ...parcel_data.parcel, reward: decayed_reward },
                    visible: false
                });
            }
        } else {
            beliefs.storedParcels.set(parcel_data.parcel.id, { ...parcel_data, visible: true });
        }
    }
}

/**
 * Decay rewards of stored parcels and remove expired ones.
 */
const updateStoredParcels = async () => {
    const now = Date.now();

    for (const parcel_data of beliefs.storedParcels.values()) {
        if (parcel_data.parcel.carriedBy) {
            beliefs.storedParcels.delete(parcel_data.parcel.id);
            continue;
        }

        const elapsed_s = (now - parcel_data.timestamp) / 1000;
        const decayed_reward = parcel_data.parcel.reward - parseInt(elapsed_s / constantBeliefs.config.PDI);

        if (decayed_reward < 0) {
            beliefs.storedParcels.delete(parcel_data.parcel.id);
        } else {
            beliefs.storedParcels.set(parcel_data.parcel.id, {
                ...parcel_data,
                parcel: { ...parcel_data.parcel, reward: decayed_reward }
            });
        }
    }
}

export { updatePerceivedParcels, updateStoredParcels };
