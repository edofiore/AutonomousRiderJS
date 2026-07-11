#!/usr/bin/env node
/**
 * Benchmark log parser: turns the METRIC lines produced by the testbench
 * (see run-benchmark.js and src/agent/benchmark/metrics.js) into CSV tables
 * ready for the report.
 *
 * Reads every <out>/<map>/run_XX/manifest.json written by the runner and the
 * agent logs it references, then writes next to the logs:
 *
 *   results.csv         one row per agent per run (all metrics)
 *   summary.csv         mean +/- std grouped by challenge (c1/c2) and mode
 *                       (pddl vs base), plus an "all" row per mode
 *   summary_by_map.csv  same aggregation, grouped per map and mode
 *   timeseries.csv      score over time (one row per 5s snapshot) for
 *                       score-progression plots
 *
 * Usage:
 *   node benchmark/parse-logs.js [--in <logs dir>] [--out <csv dir>]
 *   (defaults: benchmark/logs for both)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const opts = {
    in: path.join(PROJECT_ROOT, 'benchmark', 'logs'),
    out: null, // defaults to opts.in
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const [flag, inlineVal] = argv[i].split('=');
    const val = inlineVal ?? argv[++i];
    switch (flag) {
        case '--in': opts.in = path.resolve(val); break;
        case '--out': opts.out = path.resolve(val); break;
        default:
            console.error(`Unknown option: ${flag}`);
            process.exit(1);
    }
}
opts.out ??= opts.in;

/* ------------------------------------------------------------------ *
 *  Log reading
 * ------------------------------------------------------------------ */

/** Extract all METRIC records from an agent log. */
function readMetrics(logPath) {
    if (!fs.existsSync(logPath)) return [];
    const records = [];
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
        const idx = line.indexOf('METRIC ');
        if (idx === -1) continue;
        try {
            records.push(JSON.parse(line.slice(idx + 'METRIC '.length)));
        } catch { /* clipped/interleaved line, skip */ }
    }
    return records;
}

const round = (v, d = 2) => Number.isFinite(v) ? Number(v.toFixed(d)) : 0;

/** Build the per-agent-per-run result row. */
function buildRow(manifest, agentSpec, records) {
    const runEnd = records.filter(r => r.event === 'run_end').at(-1);
    const lastSnapshot = records.filter(r => r.event === 'snapshot').at(-1);
    const final = runEnd ?? lastSnapshot ?? {};
    const circuitBreaker = records.some(r => r.event === 'pddl_circuit_breaker');

    const activeS = (final.active_ms ?? 0) / 1000;
    const movesTotal = (final.moves_ok ?? 0) + (final.moves_failed ?? 0);

    return {
        map: manifest.map,
        challenge: manifest.challenge,
        run: manifest.run,
        agent: agentSpec.name,
        mode: agentSpec.pddl ? 'pddl' : 'base',
        team: agentSpec.team ?? '',
        completed: runEnd ? 1 : 0,
        active_s: round(activeS, 1),
        score: final.score ?? 0,
        points_per_min: final.points_per_min ?? 0,
        parcels_picked: final.parcels_picked ?? 0,
        parcels_delivered: final.parcels_delivered ?? 0,
        deliveries: final.deliveries ?? 0,
        reward_delivered: round(final.reward_delivered ?? 0),
        handoff_drops: final.handoff_drops ?? 0,
        parcels_handed_off: final.parcels_handed_off ?? 0,
        intentions_completed: final.intentions_completed ?? 0,
        intentions_failed: final.intentions_failed ?? 0,
        plans_succeeded: final.plans_succeeded ?? 0,
        plans_failed: final.plans_failed ?? 0,
        plans_stopped: final.plans_stopped ?? 0,
        pddl_attempts: final.pddl_attempts ?? 0,
        pddl_solved: final.pddl_solved ?? 0,
        pddl_empty_plans: final.pddl_empty_plans ?? 0,
        pddl_solver_errors: final.pddl_solver_errors ?? 0,
        pddl_avg_solve_ms: final.pddl_avg_solve_ms ?? 0,
        pddl_avg_plan_steps: final.pddl_avg_plan_steps ?? 0,
        pddl_circuit_breaker: circuitBreaker ? 1 : 0,
        moves_ok: final.moves_ok ?? 0,
        moves_failed: final.moves_failed ?? 0,
        move_fail_pct: movesTotal ? round(100 * (final.moves_failed ?? 0) / movesTotal) : 0,
        avg_carry_s: round((final.avg_carry_ms ?? 0) / 1000),
        tiles_visited: final.tiles_visited ?? 0,
        tiles_observed: final.tiles_observed ?? 0,
        map_tiles: final.map_tiles ?? 0,
        explored_visited_pct: final.explored_visited_pct ?? 0,
        explored_observed_pct: final.explored_observed_pct ?? 0,
        msgs_sent: final.msgs_sent ?? 0,
    };
}

/* ------------------------------------------------------------------ *
 *  Aggregation
 * ------------------------------------------------------------------ */

// Metrics that get mean/std columns in the summary tables.
const SUMMARY_METRICS = [
    'score', 'points_per_min',
    'parcels_picked', 'parcels_delivered', 'reward_delivered',
    'parcels_handed_off',
    'intentions_completed', 'intentions_failed',
    'plans_failed', 'plans_stopped',
    'pddl_attempts', 'pddl_solved', 'pddl_solver_errors', 'pddl_avg_solve_ms', 'pddl_avg_plan_steps',
    'move_fail_pct', 'avg_carry_s',
    'explored_visited_pct', 'explored_observed_pct',
];

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const std = (xs) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Aggregate rows into one summary row keyed by `groupCols` values. */
function summarize(rows, groupVals) {
    const out = { ...groupVals, n_agent_runs: rows.length };
    for (const metricName of SUMMARY_METRICS) {
        const values = rows.map(r => r[metricName]);
        out[`${metricName}_mean`] = round(mean(values), 3);
        out[`${metricName}_std`] = round(std(values), 3);
    }
    out.circuit_breaker_runs = rows.reduce((a, r) => a + r.pddl_circuit_breaker, 0);
    out.incomplete_runs = rows.reduce((a, r) => a + (r.completed ? 0 : 1), 0);
    return out;
}

function groupBy(rows, keyFn) {
    const groups = new Map();
    for (const row of rows) {
        const key = keyFn(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return groups;
}

/* ------------------------------------------------------------------ *
 *  CSV writing
 * ------------------------------------------------------------------ */

const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function writeCsv(filePath, rows) {
    if (rows.length === 0) return;
    const header = Object.keys(rows[0]);
    const lines = [header.join(',')];
    for (const row of rows) lines.push(header.map(h => csvEscape(row[h])).join(','));
    fs.writeFileSync(filePath, lines.join('\n') + '\n');
    console.log(`Wrote ${filePath} (${rows.length} rows)`);
}

/* ------------------------------------------------------------------ *
 *  Main
 * ------------------------------------------------------------------ */

if (!fs.existsSync(opts.in)) {
    console.error(`Logs directory not found: ${opts.in}`);
    process.exit(1);
}

const resultRows = [];
const timeseriesRows = [];

for (const map of fs.readdirSync(opts.in).sort()) {
    const mapDir = path.join(opts.in, map);
    if (!fs.statSync(mapDir).isDirectory()) continue;
    for (const runName of fs.readdirSync(mapDir).sort()) {
        const runDir = path.join(mapDir, runName);
        const manifestPath = path.join(runDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        for (const agentSpec of manifest.agents) {
            const records = readMetrics(path.join(runDir, agentSpec.log));
            if (records.length === 0) {
                console.warn(`WARN: no METRIC records in ${map}/${runName}/${agentSpec.log}`);
            }
            resultRows.push(buildRow(manifest, agentSpec, records));

            for (const snap of records.filter(r => r.event === 'snapshot' || r.event === 'run_end')) {
                timeseriesRows.push({
                    map: manifest.map,
                    challenge: manifest.challenge,
                    run: manifest.run,
                    agent: agentSpec.name,
                    mode: agentSpec.pddl ? 'pddl' : 'base',
                    team: agentSpec.team ?? '',
                    elapsed_s: round((snap.active_ms ?? 0) / 1000, 1),
                    score: snap.score ?? 0,
                });
            }
        }
    }
}

if (resultRows.length === 0) {
    console.error('No benchmark results found. Run the campaign first: npm run bench');
    process.exit(1);
}

// Per-agent-run detail table
writeCsv(path.join(opts.out, 'results.csv'), resultRows);

// Headline table: pddl vs base, per challenge type and overall
const summaryRows = [];
for (const [key, rows] of groupBy(resultRows, r => `${r.challenge}|${r.mode}`)) {
    const [challenge, mode] = key.split('|');
    summaryRows.push(summarize(rows, { challenge, mode }));
}
for (const [mode, rows] of groupBy(resultRows, r => r.mode)) {
    summaryRows.push(summarize(rows, { challenge: 'all', mode }));
}
summaryRows.sort((a, b) => a.challenge.localeCompare(b.challenge) || a.mode.localeCompare(b.mode));
writeCsv(path.join(opts.out, 'summary.csv'), summaryRows);

// Per-map breakdown
const byMapRows = [];
for (const [key, rows] of groupBy(resultRows, r => `${r.map}|${r.mode}`)) {
    const [map, mode] = key.split('|');
    byMapRows.push(summarize(rows, { map, mode }));
}
byMapRows.sort((a, b) => a.map.localeCompare(b.map) || a.mode.localeCompare(b.mode));
writeCsv(path.join(opts.out, 'summary_by_map.csv'), byMapRows);

// Score progression for plots
timeseriesRows.sort((a, b) =>
    a.map.localeCompare(b.map) || a.run - b.run || a.agent.localeCompare(b.agent) || a.elapsed_s - b.elapsed_s);
writeCsv(path.join(opts.out, 'timeseries.csv'), timeseriesRows);

// Console digest of the headline comparison
console.log('\nSummary (mean over agent-runs):');
for (const s of summaryRows) {
    console.log(`  ${s.challenge.padEnd(4)} ${s.mode.padEnd(5)} n=${String(s.n_agent_runs).padStart(3)}`
        + `  score=${s.score_mean} (±${s.score_std})`
        + `  ppm=${s.points_per_min_mean}`
        + `  delivered=${s.parcels_delivered_mean}`
        + `  int_failed=${s.intentions_failed_mean}`
        + `  explored=${s.explored_observed_pct_mean}%`);
}
