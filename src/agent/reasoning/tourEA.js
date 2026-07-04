import { beliefs } from "../beliefs/beliefs.js";
import { getSpawnerDistances } from "../planning/spawnerDistances.js";

/**
 * Evolutionary patrol tour (Phase B of the evolved game strategy).
 *
 * When the agent has nothing better to do it wanders looking for parcels.
 * Instead of the old "go to the farthest spawner" heuristic, each agent
 * evolves a PATROL TOUR: a cyclic visiting order over its patrol set —
 * its evolved zone's spawners when the team partition is active (see
 * coordination/partitionEA.js), or all spawner tiles when playing solo.
 * Following a short cycle minimizes the revisit interval of every spawner
 * (spawns are uniform, so cycle time IS the coverage objective), where the
 * farthest-first heuristic zig-zags and re-crosses the map.
 *
 * EA details:
 *  - genome: a permutation of the patrol set (visiting order of the cycle);
 *  - fitness: total cycle length in graph distance (a reward-aware TSP
 *    reduces to plain TSP here because spawn chances are uniform);
 *  - operators: order crossover (OX) + segment reversal (a 2-opt move),
 *    tournament selection, elitism; seeded with a greedy nearest-neighbor
 *    tour so the EA starts from a decent solution and polishes it;
 *  - anytime & online: a bounded burst of generations runs (at most every
 *    EVOLVE_INTERVAL ms) whenever a wander target is requested, so the tour
 *    keeps improving during the match, and the population is re-seeded live
 *    whenever the evolved zone changes under it.
 *
 * Runtime concerns (claims by the teammate, temporarily invalid targets,
 * what is already queued) are NOT part of the fitness: the caller filters
 * the returned tour order against those, so a skipped stop is simply
 * revisited on the next lap.
 */

const POP_SIZE = 30;
const GENS_PER_BURST = 10;
const ELITE = 2;
const TOURNAMENT = 3;
const EVOLVE_INTERVAL = 500; // ms between evolution bursts

let patrolIds = null;   // spawner ids of the current patrol set
let patrolKey = '';     // change-detection key for the patrol set
let population = null;  // [{ tour: number[], len: number }] sorted by len
let cursorId = null;    // last stop we handed out as a wander target
let lastBurst = 0;

// distFrom.get(aId).get(bId) = distance from spawner a to spawner b.
// The ?? fallback is defensive only: currentPatrolIds restricts the patrol
// set to the agent's own connected component, so disconnected pairs should
// never reach fitness. If one ever does, a heavy penalty (NOT zero — zero
// would make impossible legs free and evolution would happily interleave
// regions) makes the EA group same-region stops together.
const legDist = (distFrom, maxDist, aId, bId) =>
    distFrom.get(aId).get(bId) ?? maxDist * 2;

const cycleLength = (tour, distFrom, maxDist) => {
    let len = 0;
    for (let k = 0; k < tour.length; k++) {
        const a = patrolIds[tour[k]];
        const b = patrolIds[tour[(k + 1) % tour.length]];
        len += legDist(distFrom, maxDist, a, b);
    }
    return len;
};

/** Greedy nearest-neighbor tour over the patrol set, starting at index 0. */
const nearestNeighborTour = (distFrom, maxDist) => {
    const n = patrolIds.length;
    const unvisited = new Set(Array.from({ length: n }, (_, i) => i));
    const tour = [0];
    unvisited.delete(0);
    while (unvisited.size > 0) {
        const cur = patrolIds[tour[tour.length - 1]];
        let best = null, bestD = Infinity;
        for (const k of unvisited) {
            const d = legDist(distFrom, maxDist, cur, patrolIds[k]);
            if (d < bestD) { bestD = d; best = k; }
        }
        tour.push(best);
        unvisited.delete(best);
    }
    return tour;
};

const shuffledTour = (n) => {
    const t = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [t[i], t[j]] = [t[j], t[i]];
    }
    return t;
};

/** Order crossover (OX): keep a slice of p1, fill the rest in p2's order. */
const orderCrossover = (p1, p2) => {
    const n = p1.length;
    let i = Math.floor(Math.random() * n);
    let j = Math.floor(Math.random() * n);
    if (i > j) [i, j] = [j, i];

    const child = new Array(n).fill(-1);
    const used = new Set();
    for (let k = i; k <= j; k++) {
        child[k] = p1[k];
        used.add(p1[k]);
    }
    let w = (j + 1) % n;
    for (let r = 0; r < n; r++) {
        const gene = p2[(j + 1 + r) % n];
        if (!used.has(gene)) {
            child[w] = gene;
            w = (w + 1) % n;
        }
    }
    return child;
};

/** Segment reversal — the classic 2-opt move for cycle improvement. */
const mutate = (tour) => {
    const n = tour.length;
    let i = Math.floor(Math.random() * n);
    let j = Math.floor(Math.random() * n);
    if (i > j) [i, j] = [j, i];
    while (i < j) {
        [tour[i], tour[j]] = [tour[j], tour[i]];
        i++; j--;
    }
};

const tournamentPick = (pop) => {
    let best = null;
    for (let k = 0; k < TOURNAMENT; k++) {
        const cand = pop[Math.floor(Math.random() * pop.length)];
        if (!best || cand.len < best.len) best = cand;
    }
    return best.tour;
};

/**
 * The patrol set: own evolved zone when active, whole map otherwise —
 * restricted to stops actually REACHABLE from where the agent stands.
 * The map can have disconnected walkable regions and an agent can never
 * leave its own component, so unreachable spawners are not "far", they are
 * permanently un-visitable: keeping them would force physically impossible
 * legs into every tour and dead stops into the rotation. With this filter
 * a tour contains zero impossible transitions and legDist's
 * disconnected-pair penalty becomes purely defensive.
 */
const currentPatrolIds = (spawnerIds, distFrom) => {
    const reachableFrom = (ids) => {
        if (beliefs.me.x == null) return ids;
        const meNode = `${Math.floor(beliefs.me.x)}-${Math.floor(beliefs.me.y)}`;
        return ids.filter(id => distFrom.get(id).get(meNode) !== undefined);
    };

    if (beliefs.zones?.mine?.size > 0) {
        const zone = reachableFrom(spawnerIds.filter(id => beliefs.zones.mine.has(id)));
        if (zone.length > 0) return zone;
    }
    const all = reachableFrom(spawnerIds);
    return all.length > 0 ? all : spawnerIds;
};

/** (Re)build the population when the patrol set changes. */
const ensurePopulation = () => {
    const { spawnerIds, distFrom, maxDist } = getSpawnerDistances();
    const ids = currentPatrolIds(spawnerIds, distFrom);
    const key = ids.join('|');
    if (key !== patrolKey) {
        patrolIds = ids;
        patrolKey = key;
        cursorId = null;
        lastBurst = 0;

        population = [];
        if (patrolIds.length >= 2) {
            population.push({ tour: nearestNeighborTour(distFrom, maxDist), len: 0 });
            while (population.length < POP_SIZE) {
                population.push({ tour: shuffledTour(patrolIds.length), len: 0 });
            }
            for (const ind of population) ind.len = cycleLength(ind.tour, distFrom, maxDist);
            population.sort((a, b) => a.len - b.len);
        }
        console.log(`[TOUR] patrol set changed: ${patrolIds.length} stops, reseeded (best cycle=${population[0]?.len ?? 0})`);
    }
    return patrolIds.length > 0;
};

/** A bounded, rate-limited batch of GA generations (anytime improvement). */
const evolveBurst = () => {
    if (patrolIds.length < 4) return; // nothing meaningful to optimize
    const now = Date.now();
    if (now - lastBurst < EVOLVE_INTERVAL) return;
    lastBurst = now;

    const { distFrom, maxDist } = getSpawnerDistances();
    for (let gen = 0; gen < GENS_PER_BURST; gen++) {
        const next = population.slice(0, ELITE);
        while (next.length < POP_SIZE) {
            const child = orderCrossover(tournamentPick(population), tournamentPick(population));
            mutate(child);
            next.push({ tour: child, len: cycleLength(child, distFrom, maxDist) });
        }
        next.sort((a, b) => a.len - b.len);
        population = next;
    }
};

/**
 * Patrol stops in tour order, starting after the last handed-out stop (or at
 * the nearest stop when the tour was just [re]built). The caller iterates,
 * applies its own filters (claims, invalid options, queue), and confirms the
 * stop it actually chose via `advanceCursor`.
 * @returns {string[]} spawner tile ids, [] when no patrol is possible
 */
const nextPatrolStops = () => {
    if (!ensurePopulation()) return [];
    evolveBurst();

    if (patrolIds.length === 1) return [...patrolIds];

    const { distFrom } = getSpawnerDistances();
    const orderedIds = population[0].tour.map(i => patrolIds[i]);

    let start = 0;
    const ci = cursorId ? orderedIds.indexOf(cursorId) : -1;
    if (ci >= 0) {
        start = (ci + 1) % orderedIds.length;
    } else if (beliefs.me.x != null) {
        // Fresh tour: enter the cycle at the stop nearest to where we are.
        const meNode = `${Math.floor(beliefs.me.x)}-${Math.floor(beliefs.me.y)}`;
        let bestD = Infinity;
        orderedIds.forEach((id, k) => {
            const d = distFrom.get(id).get(meNode);
            if (d !== undefined && d < bestD) { bestD = d; start = k; }
        });
    }

    return [...orderedIds.slice(start), ...orderedIds.slice(0, start)];
};

/** Confirm which stop the caller actually committed to as wander target. */
const advanceCursor = (id) => {
    cursorId = id;
};

export { nextPatrolStops, advanceCursor };
