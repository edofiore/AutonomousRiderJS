import { beliefs, constantBeliefs } from "../beliefs/beliefs.js";
import { getSpawnerDistances } from "../planning/spawnerDistances.js";

/**
 * Evolutionary map partitioning (Part 2 team strategy).
 *
 * A genetic algorithm that runs LIVE on the leader agent and evolves how the
 * parcel-spawner tiles are split between the two teammates. Each individual
 * is a bitstring with one gene per spawner tile (0 → zone A, 1 → zone B).
 *
 * Fitness (cost, minimized) combines:
 *  - balance: the two zones should cover equal expected reward. Spawners all
 *    have the same spawn probability (uniform), but their EFFECTIVE weight is
 *    discounted by observed opponent presence nearby (an opponent camping a
 *    region takes those parcels first) and boosted by parcels currently
 *    sitting there uncollected. These weights are the live, non-precomputable
 *    part that justifies evolving during the match.
 *  - boundary: fraction of neighboring spawner pairs with different labels.
 *    Penalizes scattered/checkerboard zones, rewards compact ones.
 *  - switching cost: distance of each agent from its assigned zone, so the
 *    best partition doesn't swap the agents across the map on a whim.
 *
 * The label→agent mapping is chosen per-evaluation to minimize switching
 * cost, so genomes are symmetric (01100 = 10011).
 *
 * All distances are graph distances, BFS-precomputed once per spawner at
 * first use (the map is static).
 */

// GA parameters
const POP_SIZE = 40;
const GENS_PER_TICK = 15;
const ELITE = 2;
const TOURNAMENT = 3;
const CROSSOVER_P = 0.9;

// Fitness weights
const W_BALANCE = 1.0;
const W_BOUNDARY = 0.8;
const W_SWITCH = 0.4;
const EMPTY_ZONE_PENALTY = 10;

// Hysteresis: a newly evolved partition replaces the active one only when it
// beats it by this relative margin, with both costed under the CURRENT
// weights. Without it, weight noise (parcels spawning/being collected) makes
// the boundary drift a little on almost every tick.
const BROADCAST_MARGIN = 0.10;

// Dynamic-weight parameters
const KNN = 4;                  // neighbor pairs per spawner for the boundary term
const PRESSURE_DECAY = 0.9;     // opponent-pressure decay per tick
const PRESSURE_RADIUS = 5;      // spawners within this graph distance of an opponent get pressured
const OPPONENT_FRESHNESS = 10000; // ignore opponent sightings older than this (ms)
const PARCEL_BONUS = 0.5;       // MAX extra weight for a spawner with an uncollected parcel on it (scaled by the parcel's value, see computeWeights)

// Static, populated once from the shared spawner-distance cache
let spawnerIds = null;      // ["x-y", ...]
let spawnerIndex = null;    // Map<"x-y", i>
let distFrom = null;        // Map<"x-y", Map<nodeId, dist>> BFS from each spawner
let neighborPairs = null;   // [[i, j], ...] k-nearest spawner pairs
let maxDist = 1;            // normalization for the switch term

// Evolving state
let population = null;      // Uint8Array[]
let pressures = null;       // Float64Array, opponent pressure per spawner
let version = 0;
let activeGenome = null;    // currently adopted & broadcast partition
let activeMyLabel = 0;      // which label of activeGenome is my zone (frozen at adoption)

const randomGenome = (size) => {
    const g = new Uint8Array(size);
    for (let i = 0; i < size; i++) g[i] = Math.random() < 0.5 ? 1 : 0;
    return g;
};

/** Seeded genome: split spawners along the median of one coordinate axis. */
const medianSplitGenome = (axis) => {
    const coords = spawnerIds.map(id => Number(id.split('-')[axis]));
    const sorted = [...coords].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const g = new Uint8Array(spawnerIds.length);
    for (let i = 0; i < spawnerIds.length; i++) g[i] = coords[i] < median ? 0 : 1;
    return g;
};

/**
 * One-time setup: BFS from every spawner, k-nearest neighbor pairs, seeds.
 * @returns {boolean} false when the map has fewer than 2 spawners (no
 * meaningful partition exists).
 */
const ensureInit = () => {
    if (spawnerIds) return spawnerIds.length >= 2;

    ({ spawnerIds, spawnerIndex, distFrom, maxDist } = getSpawnerDistances());
    if (spawnerIds.length < 2) return false;

    // k-nearest neighbor pairs among spawners (deduplicated)
    const pairKeys = new Set();
    neighborPairs = [];
    for (let i = 0; i < spawnerIds.length; i++) {
        const dist = distFrom.get(spawnerIds[i]);
        const others = [];
        for (let j = 0; j < spawnerIds.length; j++) {
            if (j === i) continue;
            const d = dist.get(spawnerIds[j]);
            if (d !== undefined) others.push([d, j]);
        }
        others.sort((a, b) => a[0] - b[0]);
        for (const [, j] of others.slice(0, KNN)) {
            const key = i < j ? `${i}|${j}` : `${j}|${i}`;
            if (!pairKeys.has(key)) {
                pairKeys.add(key);
                neighborPairs.push(i < j ? [i, j] : [j, i]);
            }
        }
    }

    pressures = new Float64Array(spawnerIds.length);

    population = [];
    for (let k = 0; k < POP_SIZE; k++) population.push(randomGenome(spawnerIds.length));
    population[0] = medianSplitGenome(0); // x-median split seed
    if (population.length > 1) population[1] = medianSplitGenome(1); // y-median split seed

    console.log(`[TEAM][EA] init: ${spawnerIds.length} spawners, ${neighborPairs.length} neighbor pairs, maxDist=${maxDist}`);
    return true;
};

/** Decay old opponent pressure and add pressure around fresh sightings. */
const updatePressures = () => {
    const now = Date.now();
    for (let i = 0; i < pressures.length; i++) pressures[i] *= PRESSURE_DECAY;

    for (const [id, agent] of beliefs.otherAgents.entries()) {
        if (id === beliefs.teammate.id) continue;
        if (now - agent.timestamp > OPPONENT_FRESHNESS) continue;
        const node = `${Math.floor(agent.x)}-${Math.floor(agent.y)}`;
        for (let i = 0; i < spawnerIds.length; i++) {
            const d = distFrom.get(spawnerIds[i]).get(node);
            if (d !== undefined && d <= PRESSURE_RADIUS) pressures[i] += 1;
        }
    }
};

/** Per-spawner effective weights from live observations. */
const computeWeights = () => {
    const w = new Float64Array(spawnerIds.length);
    for (let i = 0; i < w.length; i++) w[i] = 1 / (1 + pressures[i]);

    // A waiting parcel makes its spawner more valuable, but proportionally to
    // the parcel's reward: rewards spawn uniformly in [PRA-PRV, PRA+PRV]
    // (both known from config), so we normalize against the best possible
    // fresh parcel (PRA+PRV). A top-value parcel adds the full PARCEL_BONUS,
    // a low or decayed leftover adds correspondingly less — otherwise a
    // near-worthless parcel would tug the zone boundary as hard as a great
    // one. Number() because level files sometimes provide these as strings.
    const pra = Number(constantBeliefs.config.PRA) || 0;
    const prv = Number(constantBeliefs.config.PRV) || 0;
    const bestPossibleReward = pra + prv;

    for (const { parcel } of beliefs.storedParcels.values()) {
        if (parcel.carriedBy || !(parcel.reward > 0)) continue;
        const idx = spawnerIndex.get(`${parcel.x}-${parcel.y}`);
        if (idx === undefined) continue;
        const valueFactor = bestPossibleReward > 0
            ? Math.min(parcel.reward / bestPossibleReward, 1)
            : 1;
        w[idx] += PARCEL_BONUS * valueFactor;
    }
    return w;
};

/** Graph distance from a position to the nearest spawner with this label. */
const nearestZoneDist = (genome, label, pos) => {
    if (!pos || pos.x == null) return 0; // unknown position: term degrades to neutral
    const node = `${Math.floor(pos.x)}-${Math.floor(pos.y)}`;
    let best = maxDist;
    for (let i = 0; i < genome.length; i++) {
        if (genome[i] !== label) continue;
        const d = distFrom.get(spawnerIds[i]).get(node);
        if (d !== undefined && d < best) best = d;
    }
    return best;
};

/**
 * Cost of a partition (lower is better).
 * @param {number|null} fixedMapping - when given, cost the partition with
 * this label→agent mapping instead of picking the cheaper one. Used to
 * re-evaluate the ACTIVE partition under current weights without letting a
 * mapping flip silently swap the two agents' zones.
 * @returns {{cost: number, mapping: number}} mapping=0 → I take label 0,
 * mapping=1 → I take label 1.
 */
const fitness = (genome, weights, myPos, matePos, fixedMapping = null) => {
    let w0 = 0, w1 = 0, c0 = 0, c1 = 0;
    for (let i = 0; i < genome.length; i++) {
        if (genome[i] === 0) { w0 += weights[i]; c0++; }
        else { w1 += weights[i]; c1++; }
    }

    let cost = 0;
    if (c0 === 0 || c1 === 0) cost += EMPTY_ZONE_PENALTY;
    cost += W_BALANCE * Math.abs(w0 - w1) / ((w0 + w1) || 1);

    let differing = 0;
    for (const [i, j] of neighborPairs) if (genome[i] !== genome[j]) differing++;
    cost += W_BOUNDARY * differing / (neighborPairs.length || 1);

    const dMe0 = nearestZoneDist(genome, 0, myPos);
    const dMe1 = nearestZoneDist(genome, 1, myPos);
    const dMate0 = nearestZoneDist(genome, 0, matePos);
    const dMate1 = nearestZoneDist(genome, 1, matePos);
    const asLabel0 = dMe0 + dMate1; // I take zone 0, teammate zone 1
    const asLabel1 = dMe1 + dMate0;
    const mapping = fixedMapping ?? (asLabel0 <= asLabel1 ? 0 : 1);
    cost += W_SWITCH * (mapping === 0 ? asLabel0 : asLabel1) / (2 * maxDist);

    return { cost, mapping };
};

const tournamentPick = (scored) => {
    let best = null;
    for (let k = 0; k < TOURNAMENT; k++) {
        const cand = scored[Math.floor(Math.random() * scored.length)];
        if (!best || cand.cost < best.cost) best = cand;
    }
    return best.genome;
};

const crossover = (p1, p2) => {
    const child = new Uint8Array(p1.length);
    if (Math.random() < CROSSOVER_P) {
        for (let i = 0; i < child.length; i++) child[i] = Math.random() < 0.5 ? p1[i] : p2[i];
    } else {
        child.set(p1);
    }
    return child;
};

const mutate = (genome) => {
    const rate = Math.max(1 / genome.length, 0.02);
    let flipped = false;
    for (let i = 0; i < genome.length; i++) {
        if (Math.random() < rate) {
            genome[i] ^= 1;
            flipped = true;
        }
    }
    if (!flipped) genome[Math.floor(Math.random() * genome.length)] ^= 1;
};

/**
 * Run one evolution tick (a few generations) and return the current best
 * partition as a per-agent assignment, or null when no partition applies
 * (fewer than 2 spawners, or identities unknown).
 *
 * Called only on the leader agent. Population persists across ticks; fitness
 * is re-evaluated every tick because the live weights drift.
 */
const partitionTick = () => {
    if (!ensureInit()) return null;
    if (!beliefs.me.id || !beliefs.teammate.id) return null;

    updatePressures();
    const weights = computeWeights();
    const myPos = { x: beliefs.me.x, y: beliefs.me.y };
    const mate = beliefs.otherAgents.get(beliefs.teammate.id);
    const matePos = mate ? { x: mate.x, y: mate.y } : null;

    // Keep the active partition in the gene pool so the search can refine
    // around the committed solution as weights drift.
    if (activeGenome) population[population.length - 1] = Uint8Array.from(activeGenome);

    const evaluate = (genomes) => genomes
        .map(genome => ({ genome, ...fitness(genome, weights, myPos, matePos) }))
        .sort((a, b) => a.cost - b.cost);

    let scored = evaluate(population);
    for (let gen = 0; gen < GENS_PER_TICK; gen++) {
        const next = scored.slice(0, ELITE).map(s => s.genome);
        while (next.length < POP_SIZE) {
            const child = crossover(tournamentPick(scored), tournamentPick(scored));
            mutate(child);
            next.push(child);
        }
        population = next;
        scored = evaluate(population);
    }

    const best = scored[0];

    // Hysteresis: replace the active partition only when the new best beats
    // it by BROADCAST_MARGIN, with the active one re-costed under CURRENT
    // weights and its committed label mapping. The (unchanged) active
    // partition is still returned every tick so a late-joining teammate
    // eventually receives it.
    if (!activeGenome) {
        activeGenome = Uint8Array.from(best.genome);
        activeMyLabel = best.mapping;
        version++;
        console.log(`[TEAM][EA] tick: best=${best.cost.toFixed(3)} → adopted v${version} (first partition)`);
    } else {
        const activeCost = fitness(activeGenome, weights, myPos, matePos, activeMyLabel).cost;
        if (best.cost < activeCost * (1 - BROADCAST_MARGIN)) {
            activeGenome = Uint8Array.from(best.genome);
            activeMyLabel = best.mapping;
            version++;
            console.log(`[TEAM][EA] tick: best=${best.cost.toFixed(3)} beats active=${activeCost.toFixed(3)} -> adopted v${version}`);
        } else {
            console.log(`[TEAM][EA] tick: best=${best.cost.toFixed(3)} vs active=${activeCost.toFixed(3)} -> kept v${version}`);
        }
    }

    const mine = [], theirs = [];
    for (let i = 0; i < activeGenome.length; i++) {
        (activeGenome[i] === activeMyLabel ? mine : theirs).push(spawnerIds[i]);
    }

    return {
        version,
        assignment: {
            [beliefs.me.id]: mine,
            [beliefs.teammate.id]: theirs,
        },
    };
};

export { partitionTick };
