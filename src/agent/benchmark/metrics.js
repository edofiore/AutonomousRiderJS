/**
 * Benchmark / evaluation instrumentation.
 *
 * Emits machine-parsable metric records on stdout, one JSON object per line,
 * prefixed with "METRIC " so they can be filtered from standard agent logs:
 *
 *     METRIC {"t":1720000000000,"event":"pickup","n":1,...}
 *
 * Everything is collected by intercepting the DeliverooApi client (pickup,
 * putdown, move, messaging) and via small hooks in IntentionRevision /
 * Intention / PddlPlan, so no game logic changes.
 *
 * Environment flags (all optional — module is a cheap no-op set of counters
 * during normal play):
 *   BENCH=1               emit a "snapshot" record every BENCH_SNAPSHOT_MS
 *   BENCH_SNAPSHOT_MS     snapshot period, default 5000
 *   BENCH_DURATION_MS     if > 0, emit a final "run_end" record after this
 *                         many ms and exit the process (testbench runs)
 *
 * Events emitted:
 *   run_start        once at boot, with the agent configuration
 *   ready            first integer position received (agent is in the game)
 *   pickup           successful emitPickup (>=1 parcel actually picked)
 *   delivery         putdown on a delivery tile (points banked)
 *   handoff_drop     putdown on a non-delivery tile (parcel donation)
 *   intention_failed a top-level intention failed (excludes queue swaps)
 *   plan_failed      a plan threw a genuine error (excludes preemptions)
 *   pddl_solve       one online-solver round trip (ok/failed, latency, steps)
 *   pddl_circuit_breaker  solver disabled for the rest of the session
 *   snapshot         periodic cumulative summary (BENCH=1 only)
 *   run_end          final cumulative summary (BENCH_DURATION_MS only)
 */

import { client } from "../../config/client.js";
import config from "../../config/config.js";
import { beliefs, constantBeliefs } from "../beliefs/beliefs.js";

const BENCH = process.env.BENCH === '1';
const BENCH_DURATION_MS = parseInt(process.env.BENCH_DURATION_MS ?? '0', 10);
const SNAPSHOT_MS = parseInt(process.env.BENCH_SNAPSHOT_MS ?? '5000', 10);

const startedAt = Date.now();
let readyAt = null;
let lastScore = 0;

// Write directly to stdout: DeliverooApi overrides console.log to mirror
// every line to the server socket, and metric records must stay on one line.
const metric = (event, data = {}) => {
    process.stdout.write(`METRIC ${JSON.stringify({ t: Date.now(), event, ...data })}\n`);
};

/* ------------------------------------------------------------------ *
 *  Cumulative state
 * ------------------------------------------------------------------ */

const counters = {
    pickup_events: 0,       // successful emitPickup calls
    parcels_picked: 0,      // parcels actually grabbed
    deliveries: 0,          // putdowns on a delivery tile
    parcels_delivered: 0,
    reward_delivered: 0,    // sum of parcel rewards at putdown time
    handoff_drops: 0,       // putdowns on non-delivery tiles (team donations)
    parcels_handed_off: 0,
    moves_ok: 0,
    moves_failed: 0,
    intentions_completed: 0,
    intentions_failed: 0,   // genuine failures only (no queue-swap preemptions)
    plans_succeeded: 0,
    plans_failed: 0,        // genuine failures only
    plans_stopped: 0,       // preempted by intention revision (not failures)
    pddl_attempts: 0,
    pddl_solved: 0,         // solver returned a non-empty plan
    pddl_empty_plans: 0,    // solver answered but found no plan
    pddl_solver_errors: 0,  // transport errors / timeouts
    pddl_solve_ms: 0,       // total latency of successful solves
    pddl_plan_steps: 0,     // total steps across successful solves
    msgs_sent: 0,
};

const intentionsByAction = {};        // action -> { ok, fail }
const intentionFailuresByCode = {};   // error code -> count
const planResults = {};               // plan class name -> { ok, fail, stopped }
const msgsByType = {};                // team message type -> count

const carryStart = new Map();         // parcelId -> pickup timestamp
const carryTimes = [];                // ms carried, per delivered parcel

// Exploration: tiles physically visited, and tiles that entered the sensing
// radius (server senses at Manhattan distance < PARCELS_OBSERVATION_DISTANCE).
const visited = new Set();
const observed = new Set();

const observeFrom = (x, y) => {
    const pod = Number.isFinite(constantBeliefs.config.POD) ? constantBeliefs.config.POD : 5;
    constantBeliefs.map.mapGraph.forEachNode((node, attrs) => {
        if (Math.abs(attrs.x - x) + Math.abs(attrs.y - y) < pod) observed.add(node);
    });
};

/* ------------------------------------------------------------------ *
 *  Summary payload (used by snapshot and run_end)
 * ------------------------------------------------------------------ */

const round = (v, d = 2) => Number.isFinite(v) ? Number(v.toFixed(d)) : 0;

const summary = () => {
    const now = Date.now();
    const activeMs = readyAt ? now - readyAt : 0;
    const mapTiles = constantBeliefs.map.mapGraph.order;
    const avgCarryMs = carryTimes.length
        ? carryTimes.reduce((a, b) => a + b, 0) / carryTimes.length : 0;
    return {
        agent: { id: beliefs.me.id, name: beliefs.me.name },
        pddl: config.pddl.enabled,
        team: config.team.enabled,
        score: lastScore,
        elapsed_ms: now - startedAt,
        active_ms: activeMs,
        points_per_min: activeMs > 0 ? round(lastScore / (activeMs / 60000)) : 0,
        ...counters,
        pddl_avg_solve_ms: counters.pddl_solved ? round(counters.pddl_solve_ms / counters.pddl_solved) : 0,
        pddl_avg_plan_steps: counters.pddl_solved ? round(counters.pddl_plan_steps / counters.pddl_solved) : 0,
        avg_carry_ms: round(avgCarryMs),
        map_tiles: mapTiles,
        tiles_visited: visited.size,
        tiles_observed: observed.size,
        explored_visited_pct: mapTiles ? round(100 * visited.size / mapTiles) : 0,
        explored_observed_pct: mapTiles ? round(100 * observed.size / mapTiles) : 0,
        intentions_by_action: intentionsByAction,
        intention_failures_by_code: intentionFailuresByCode,
        plan_results: planResults,
        msgs_by_type: msgsByType,
    };
};

/* ------------------------------------------------------------------ *
 *  Hooks called from the agent code
 * ------------------------------------------------------------------ */

/** A top-level intention completed successfully (IntentionRevision.loop). */
export const metricIntentionCompleted = (action) => {
    counters.intentions_completed++;
    (intentionsByAction[action] ??= { ok: 0, fail: 0 }).ok++;
};

/** A top-level intention genuinely failed (IntentionRevision.recordIntentionFailure). */
export const metricIntentionFailure = (intentionKey, error) => {
    counters.intentions_failed++;
    const action = intentionKey.split('-')[0];
    (intentionsByAction[action] ??= { ok: 0, fail: 0 }).fail++;
    const code = Array.isArray(error) ? String(error[0])
        : String(error?.message ?? error).slice(0, 120);
    intentionFailuresByCode[code] = (intentionFailuresByCode[code] || 0) + 1;
    metric('intention_failed', { key: intentionKey, code });
};

/** One plan execution finished (Intention.achieve). */
export const metricPlanResult = (planName, action, ok, error = null) => {
    const entry = (planResults[planName] ??= { ok: 0, fail: 0, stopped: 0 });
    if (ok) {
        entry.ok++;
        counters.plans_succeeded++;
        return;
    }
    const code = Array.isArray(error) ? String(error[0])
        : String(error?.message ?? error).slice(0, 120);
    // Preemptions (queue swap stopping the running plan) are not failures.
    if (code === 'stopped' || code === 'stopped intention') {
        entry.stopped++;
        counters.plans_stopped++;
        return;
    }
    entry.fail++;
    counters.plans_failed++;
    metric('plan_failed', { plan: planName, action, code });
};

/** One online-solver round trip (PddlPlan.execute). */
export const metricPddlSolve = ({ ok, ms, steps = 0, error = null }) => {
    counters.pddl_attempts++;
    if (!ok) {
        counters.pddl_solver_errors++;
        metric('pddl_solve', { ok: false, ms, reason: String(error?.message ?? error).slice(0, 200) });
    } else if (steps === 0) {
        counters.pddl_empty_plans++;
        metric('pddl_solve', { ok: true, ms, steps: 0 });
    } else {
        counters.pddl_solved++;
        counters.pddl_solve_ms += ms;
        counters.pddl_plan_steps += steps;
        metric('pddl_solve', { ok: true, ms, steps });
    }
};

/** The PDDL circuit breaker tripped: solver disabled for the session. */
export const metricPddlCircuitBreaker = () => {
    metric('pddl_circuit_breaker', {});
};

/* ------------------------------------------------------------------ *
 *  Client instrumentation (transparent wrappers)
 * ------------------------------------------------------------------ */

const isDeliveryTile = (x, y) =>
    constantBeliefs.map.deliverySpots.some(([sx, sy]) => sx === x && sy === y);

{
    const origPickup = client.emitPickup.bind(client);
    client.emitPickup = async (...args) => {
        const res = await origPickup(...args);
        const picked = Array.isArray(res) ? res : [];
        if (picked.length > 0) {
            counters.pickup_events++;
            counters.parcels_picked += picked.length;
            const now = Date.now();
            for (const p of picked) carryStart.set(p.id, now);
            metric('pickup', {
                n: picked.length,
                ids: picked.map(p => p.id),
                reward: picked.reduce((s, p) => s + (p.reward ?? 0), 0),
            });
        }
        return res;
    };

    const origPutdown = client.emitPutdown.bind(client);
    client.emitPutdown = async (...args) => {
        const res = await origPutdown(...args);
        const dropped = Array.isArray(res) ? res : [];
        if (dropped.length > 0) {
            const x = Math.floor(beliefs.me.x), y = Math.floor(beliefs.me.y);
            const now = Date.now();
            const carryMs = dropped
                .filter(p => carryStart.has(p.id))
                .map(p => now - carryStart.get(p.id));
            for (const p of dropped) carryStart.delete(p.id);
            const reward = dropped.reduce((s, p) => s + (p.reward ?? 0), 0);
            if (isDeliveryTile(x, y)) {
                counters.deliveries++;
                counters.parcels_delivered += dropped.length;
                counters.reward_delivered += reward;
                carryTimes.push(...carryMs);
                metric('delivery', { n: dropped.length, reward: round(reward), ids: dropped.map(p => p.id), carry_ms: carryMs });
            } else {
                counters.handoff_drops++;
                counters.parcels_handed_off += dropped.length;
                metric('handoff_drop', { n: dropped.length, ids: dropped.map(p => p.id), x, y });
            }
        }
        return res;
    };

    const origMove = client.emitMove.bind(client);
    client.emitMove = async (...args) => {
        const res = await origMove(...args);
        if (res) counters.moves_ok++; else counters.moves_failed++;
        return res;
    };

    const countMsg = (msg) => {
        counters.msgs_sent++;
        const type = (msg && typeof msg === 'object' && typeof msg.type === 'string') ? msg.type : 'raw';
        msgsByType[type] = (msgsByType[type] || 0) + 1;
    };
    const origSay = client.emitSay.bind(client);
    client.emitSay = async (toId, msg) => { countMsg(msg); return origSay(toId, msg); };
    const origAsk = client.emitAsk.bind(client);
    client.emitAsk = async (toId, msg) => { countMsg(msg); return origAsk(toId, msg); };
    const origShout = client.emitShout.bind(client);
    client.emitShout = async (msg) => { countMsg(msg); return origShout(msg); };
}

// Score + exploration tracking. Registered in addition to the game handler
// in autonomousRider.js (socket.io supports multiple listeners per event).
client.onYou(({ x, y, score }) => {
    lastScore = score;
    if (x % 1 !== 0 || y % 1 !== 0) return; // skip mid-move positions
    if (readyAt === null) {
        readyAt = Date.now();
        metric('ready', { init_ms: readyAt - startedAt, x, y });
    }
    const tile = `${x}-${y}`;
    if (!visited.has(tile) && constantBeliefs.map.mapGraph.hasNode(tile)) {
        visited.add(tile);
        observeFrom(x, y);
    }
});

/* ------------------------------------------------------------------ *
 *  Boot record + bench-mode timers
 * ------------------------------------------------------------------ */

metric('run_start', {
    pddl: config.pddl.enabled,
    team: config.team.enabled,
    host: config.host,
    bench: BENCH,
    duration_ms: BENCH_DURATION_MS || null,
    pid: process.pid,
});

if (BENCH) {
    setInterval(() => metric('snapshot', summary()), SNAPSHOT_MS).unref();
}

const emitRunEndAndExit = (reason) => {
    const line = `METRIC ${JSON.stringify({ t: Date.now(), event: 'run_end', reason, ...summary() })}\n`;
    // Write with callback so the pipe is flushed before exiting; hard
    // fallback in case the callback never fires.
    process.stdout.write(line, () => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
};

if (BENCH_DURATION_MS > 0) {
    setTimeout(() => emitRunEndAndExit('duration_elapsed'), BENCH_DURATION_MS).unref();
}

// Best effort on manual interruption (Ctrl+C); snapshots cover hard kills.
process.once('SIGINT', () => emitRunEndAndExit('sigint'));
process.once('SIGTERM', () => emitRunEndAndExit('sigterm'));
