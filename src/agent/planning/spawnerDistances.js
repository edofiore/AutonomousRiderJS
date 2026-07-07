import { constantBeliefs } from "../beliefs/beliefs.js";

/**
 * Shared spawner-distance cache, used by both evolutionary components
 * (coordination/partitionEA.js and reasoning/tourEA.js). Built lazily once —
 * the map is static — and reused for every fitness evaluation.
 */

/**
 * Breadth-first search from `start`, returning Map<nodeId, steps> with the
 * shortest-path length (in agent moves) to every reachable tile.
 *
 * Map edges connect orthogonally adjacent walkable tiles, so every edge
 * costs exactly 1 move — which is why BFS suffices instead of Dijkstra:
 * nodes are dequeued ring by ring in non-decreasing distance order, so the
 * FIRST time a node is discovered is via a shortest path. Its distance is
 * the parent's `d + 1` (one more move), recorded once and never updated
 * (hence the `!dist.has(nb)` guard).
 *
 * `qi` is a manual dequeue pointer: `queue[qi++]` is O(1), whereas
 * `queue.shift()` would re-index the whole array on every dequeue.
 *
 * The graph is undirected, so dist(spawner → tile) == dist(tile → spawner);
 * callers exploit this to look up agent→spawner distances in the spawner's
 * own table without ever running a BFS from the agent's position.
 */
const bfsFrom = (graph, start) => {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    let qi = 0;
    while (qi < queue.length) {
        const node = queue[qi++];
        const d = dist.get(node);
        for (const nb of graph.neighbors(node)) {
            if (!dist.has(nb)) {
                dist.set(nb, d + 1);
                queue.push(nb);
            }
        }
    }
    return dist;
};

let spawnerIds = null;      // ["x-y", ...] in parcelSpawners order (never reordered)
let spawnerIndex = null;    // Map<"x-y", i>
let distFrom = null;        // Map<"x-y", Map<nodeId, dist>> BFS from each spawner
let maxDist = 1;            // largest observed distance (normalization / penalty value)

// General-purpose lazy distance tables, one BFS table per queried TARGET
// tile, kept forever (the map is static). Query targets — parcels, delivery
// spots, agent positions — repeat constantly, so this converges to a handful
// of tables in practice and is bounded by the number of walkable tiles in the
// worst case (~900 tables × ~900 entries ≈ tens of MB, acceptable). This is
// what makes `distance()` a 0.2 µs lookup instead of a 0.2 ms Dijkstra run.
const lazyTables = new Map(); // Map<tileId, Map<nodeId, dist>>

/**
 * BFS table for `tileId` (shortest steps from tileId to every reachable
 * node; undirected graph, so it also answers node→tileId). Returns null when
 * the tile isn't a walkable node.
 */
const getDistanceTable = (tileId) => {
    if (distFrom?.has(tileId)) return distFrom.get(tileId); // reuse spawner tables
    let table = lazyTables.get(tileId);
    if (!table) {
        const graph = constantBeliefs.map.mapGraph;
        if (!graph.hasNode(tileId)) return null;
        table = bfsFrom(graph, tileId);
        lazyTables.set(tileId, table);
    }
    return table;
};

/**
 * Lazy getter for the cache. Callers must not reorder or mutate the returned
 * structures: genomes in both EAs are positionally coupled to `spawnerIds`.
 */
const getSpawnerDistances = () => {
    if (!spawnerIds) {
        const graph = constantBeliefs.map.mapGraph;
        spawnerIds = constantBeliefs.map.parcelSpawners.map(([x, y]) => `${x}-${y}`);
        spawnerIndex = new Map(spawnerIds.map((id, i) => [id, i]));
        distFrom = new Map();
        for (const id of spawnerIds) {
            const dist = bfsFrom(graph, id);
            distFrom.set(id, dist);
            for (const d of dist.values()) if (d > maxDist) maxDist = d;
        }
        console.log(`[MAP] spawner distance cache: ${spawnerIds.length} spawners, maxDist=${maxDist}`);
    }
    return { spawnerIds, spawnerIndex, distFrom, maxDist };
};

export { getSpawnerDistances, getDistanceTable, bfsFrom };
