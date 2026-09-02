#!/usr/bin/env node
/**
 * Turns results.csv (see parse-logs.js) into the LaTeX tables and the derived
 * figures quoted in the report's validation section.
 *
 * The campaign is a PDDL-vs-baseline paired design, so every table compares
 * the two modes on identical runs. Maps are additionally grouped into classes
 * so the comparison can be read per kind of environment rather than as one
 * pooled average:
 *
 *   - planning-problem size    walkable tiles of the map  -> solver cost
 *   - parcel lifetime          PARCEL_REWARD_AVG x PARCEL_DECADING_INTERVAL,
 *                              i.e. how many seconds a fresh parcel stays
 *                              worth anything                -> plan validity
 *   - challenge                c1 (single agents) vs c2 (teams), which on our
 *                              shared-server line-up also means 6 vs 8 bodies
 *                              competing for the same parcels
 *
 * Map metadata is read from the Deliveroo.js repo (level file + map file), so
 * the taxonomy stays in sync with the levels actually played.
 *
 * Usage:
 *   node benchmark/report-tables.js [--in <logs dir>] [--out <file.tex>]
 *                                   [--deliveroo <path to Deliveroo.js>]
 *   With no --out the LaTeX goes to stdout; the derived prose figures always
 *   go to stderr so they can be read while piping.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// run-benchmark.js hardcodes ../../../Deliveroo.js; here we walk the parents
// instead, so the tables regenerate from any checkout depth.
const findDeliveroo = () => {
    for (let up = 1; up <= 4; up++) {
        const candidate = path.resolve(PROJECT_ROOT, ...Array(up).fill('..'), 'Deliveroo.js');
        if (fs.existsSync(path.join(candidate, 'backend', 'levels'))) return candidate;
    }
    return path.resolve(PROJECT_ROOT, '..', '..', '..', 'Deliveroo.js');
};

const opts = {
    in: path.join(PROJECT_ROOT, 'benchmark', 'logs'),
    out: null,
    deliveroo: process.env.DELIVEROO_DIR ?? findDeliveroo(),
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const [flag, inlineVal] = argv[i].split('=');
    const val = inlineVal ?? argv[++i];
    switch (flag) {
        case '--in': opts.in = path.resolve(val); break;
        case '--out': opts.out = path.resolve(val); break;
        case '--deliveroo': opts.deliveroo = path.resolve(val); break;
        default:
            console.error(`Unknown option: ${flag}`);
            process.exit(1);
    }
}

/* ------------------------------------------------------------------ *
 *  Inputs
 * ------------------------------------------------------------------ */

function readCsv(file) {
    const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
    const cols = head.split(',');
    return lines.filter(Boolean).map(line => {
        // No quoted commas are produced by parse-logs.js, so a plain split is safe.
        const cells = line.split(',');
        return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    });
}

// What the backend uses when a map has no level file of its own — the runner
// falls back to MAP_FILE with these settings, so the taxonomy must too.
const BACKEND_DEFAULTS = {
    PARCELS_GENERATION_INTERVAL: '2s', PARCELS_MAX: 5,
    PARCEL_REWARD_AVG: 30, PARCEL_REWARD_VARIANCE: 10,
    PARCEL_DECADING_INTERVAL: '1s', MOVEMENT_DURATION: 50,
};

/** Level parameters + walkable-tile count for one map, from the Deliveroo repo. */
function readMapMeta(map) {
    const levelFile = path.join(opts.deliveroo, 'backend', 'levels', `${map}.js`);
    const mapFile = path.join(opts.deliveroo, 'backend', 'levels', 'maps', `${map}.js`);
    if (!fs.existsSync(mapFile)) return null;
    const hasLevel = fs.existsSync(levelFile);
    const lvl = hasLevel ? require(levelFile) : BACKEND_DEFAULTS;
    const grid = require(mapFile);

    let walkable = 0, spawners = 0, delivery = 0;
    for (const row of grid) for (const t of row) {
        if (String(t) === '0') continue;
        walkable++;
        if (String(t) === '1') spawners++;
        if (String(t) === '2') delivery++;
    }
    // A parcel loses 1 reward point per decay interval, so a fresh parcel is
    // worth something for about PRA x PDI seconds. That is the clock the
    // planner's round trip is spent against.
    const pdi = String(lvl.PARCEL_DECADING_INTERVAL ?? 'infinite');
    const decaySeconds = pdi === 'infinite' ? null : parseFloat(pdi);
    const pra = Number(lvl.PARCEL_REWARD_AVG ?? 0);
    return {
        defaults: !hasLevel,
        walkable, spawners, delivery,
        width: grid[0].length, height: grid.length,
        pra, prv: Number(lvl.PARCEL_REWARD_VARIANCE ?? 0),
        pgi: String(lvl.PARCELS_GENERATION_INTERVAL ?? '2s'),
        pmax: String(lvl.PARCELS_MAX ?? 'infinite'),
        pdi,
        lifetime: decaySeconds === null ? null : pra * decaySeconds,
        movement: Number(lvl.MOVEMENT_DURATION ?? 500),
        pod: lvl.PARCELS_OBSERVATION_DISTANCE,
    };
}

/* ------------------------------------------------------------------ *
 *  Statistics
 * ------------------------------------------------------------------ */

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const std = (xs) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const sum = (rows, k) => rows.reduce((a, r) => a + num(r[k]), 0);
const avg = (rows, k) => mean(rows.map(r => num(r[k])));
/** Deliveries per minute, computed per run so short/aborted runs stay comparable. */
const perMin = (rows, k) => mean(rows.map(r => num(r[k]) / (num(r.active_s) / 60)));
/** Solver latency, averaged over the runs that actually called the solver. */
const solveMs = (rows) => mean(rows.map(r => num(r.pddl_avg_solve_ms)).filter(v => v > 0));

/** Everything the tables need about one set of rows, split by mode. */
function compare(rows) {
    const base = rows.filter(r => r.mode === 'base');
    const pddl = rows.filter(r => r.mode === 'pddl');
    const attempts = sum(pddl, 'pddl_attempts');
    const basePpm = mean(base.map(r => num(r.points_per_min)));
    const pddlPpm = mean(pddl.map(r => num(r.points_per_min)));
    const baseDm = perMin(base, 'parcels_delivered');
    const pddlDm = perMin(pddl, 'parcels_delivered');
    return {
        runs: base.length, basePpm, pddlPpm,
        basePpmStd: std(base.map(r => num(r.points_per_min))),
        pddlPpmStd: std(pddl.map(r => num(r.points_per_min))),
        retention: basePpm ? 100 * pddlPpm / basePpm : 0,
        baseDm, pddlDm,
        // Extra seconds the planner adds to one delivery cycle: the difference
        // between the two modes' mean cycle times.
        deadSeconds: (pddlDm ? 60 / pddlDm : 0) - (baseDm ? 60 / baseDm : 0),
        solveMs: solveMs(pddl),
        planSteps: mean(pddl.map(r => num(r.pddl_avg_plan_steps)).filter(v => v > 0)),
        solvedPct: attempts ? 100 * sum(pddl, 'pddl_solved') / attempts : 0,
        emptyPct: attempts ? 100 * sum(pddl, 'pddl_empty_plans') / attempts : 0,
        errorPct: attempts ? 100 * sum(pddl, 'pddl_solver_errors') / attempts : 0,
        attemptsPerDelivery: avg(pddl, 'parcels_delivered') ? avg(pddl, 'pddl_attempts') / avg(pddl, 'parcels_delivered') : 0,
        breakerRuns: pddl.filter(r => num(r.pddl_circuit_breaker) > 0).length,
        baseCarry: avg(base, 'avg_carry_s'), pddlCarry: avg(pddl, 'avg_carry_s'),
        baseMoveFail: avg(base, 'move_fail_pct'), pddlMoveFail: avg(pddl, 'move_fail_pct'),
        baseObserved: avg(base, 'explored_observed_pct'), pddlObserved: avg(pddl, 'explored_observed_pct'),
        baseVisited: avg(base, 'explored_visited_pct'), pddlVisited: avg(pddl, 'explored_visited_pct'),
    };
}

/** Pearson correlation, used for the claims made in the prose. */
function corr(xs, ys) {
    const mx = mean(xs), my = mean(ys);
    const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
    const dx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
    const dy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
    return dx && dy ? cov / (dx * dy) : 0;
}

/* ------------------------------------------------------------------ *
 *  Load
 * ------------------------------------------------------------------ */

const resultsFile = path.join(opts.in, 'results.csv');
if (!fs.existsSync(resultsFile)) {
    console.error(`No results.csv in ${opts.in} — run "npm run bench:parse" first.`);
    process.exit(1);
}
const allRows = readCsv(resultsFile);
const maps = [...new Set(allRows.map(r => r.map))].sort();

/* The online solver became unreachable partway through the campaign: from
 * that point on every PDDL call timed out, the circuit breaker tripped after
 * 3 attempts and the agents ran on the classical plans for the rest of the
 * run. Those runs say nothing about planning, so the PDDL comparison uses
 * only runs in which the solver actually answered at least once — and drops
 * the paired baseline rows with them, to keep the design paired. The excluded
 * runs are reported separately as an unplanned solver-outage test. */
const runKey = (r) => `${r.map}|${r.run}`;
const solverLive = new Set(
    allRows.filter(r => r.mode === 'pddl' && num(r.pddl_solved) > 0).map(runKey));
const rows = allRows.filter(r => solverLive.has(runKey(r)));
const outageRows = allRows.filter(r => !solverLive.has(runKey(r)));

const meta = {};
for (const m of maps) {
    meta[m] = readMapMeta(m) ?? { walkable: num(rows.find(r => r.map === m).map_tiles) };
    if (!meta[m].pra) console.error(`[warn] no level file for ${m} in ${opts.deliveroo}; taxonomy columns will be blank`);
}

const perMap = {};
const perMapAll = {};
const liveRuns = {};
for (const m of maps) {
    perMap[m] = compare(rows.filter(r => r.map === m));
    perMapAll[m] = compare(allRows.filter(r => r.map === m));
    liveRuns[m] = new Set(allRows.filter(r => r.map === m).map(runKey).filter(k => solverLive.has(k))).size;
}
const mapsWithPddl = maps.filter(m => liveRuns[m] > 0);

/* ------------------------------------------------------------------ *
 *  Classes
 * ------------------------------------------------------------------ */

const SIZE_CLASSES = [
    ['Small ($<$300)', m => meta[m].walkable < 300],
    ['Medium (300--500)', m => meta[m].walkable >= 300 && meta[m].walkable <= 500],
    ['Large ($>$500)', m => meta[m].walkable > 500],
];
const LIFE_CLASSES = [
    ['Perishable ($\\leq$40 s)', m => meta[m].lifetime != null && meta[m].lifetime <= 40],
    ['Durable ($\\geq$50 s)', m => meta[m].lifetime != null && meta[m].lifetime >= 50],
    ['No decay', m => meta[m].lifetime == null],
];
const CHALLENGE_CLASSES = [
    ['Single agent (6 bodies)', m => m.startsWith('25c1')],
    ['Teams (8 bodies)', m => m.startsWith('25c2')],
];

const classRow = (label, pick) => {
    const ms = mapsWithPddl.filter(pick);
    if (!ms.length) return null;
    return { label, maps: ms, ...compare(rows.filter(r => ms.includes(r.map))) };
};

/* ------------------------------------------------------------------ *
 *  LaTeX output
 * ------------------------------------------------------------------ */

const tex = [];
const esc = (s) => String(s).replace(/_/g, '\\_');
const f1 = (v) => v.toFixed(1);
const f0 = (v) => v.toFixed(0);

tex.push('% Generated by benchmark/report-tables.js — do not edit by hand.');
tex.push(`% ${rows.length} agent-runs over ${maps.length} maps.`);
tex.push('');

// --- Table 1: taxonomy + per-map paired result (full width) ---
const totalRuns = (m) => new Set(allRows.filter(r => r.map === m).map(runKey)).size;
tex.push('\\begin{table*}[t]');
tex.push('\\centering');
tex.push('\\caption{Validation maps, their classification, and the paired PDDL/baseline result (mean over runs; pts/min per agent). The lower block lists the maps whose runs were played while the online solver was unreachable: there the PDDL configuration is a fallback-only agent, so no planning comparison is possible and only the baseline is reported.}');
tex.push('\\footnotesize');
tex.push('\\begin{tabular}{lrrrrrr rr r rr}');
tex.push('\\toprule');
tex.push(' & & \\multicolumn{5}{c}{Map} & \\multicolumn{2}{c}{Score (pts/min)} & & \\multicolumn{2}{c}{Solver} \\\\');
tex.push('\\cmidrule(lr){3-7}\\cmidrule(lr){8-9}\\cmidrule(lr){11-12}');
tex.push('Map & Runs & Tiles & Spawn. & Deliv. & Parcels & Life (s) & Baseline & PDDL & Ret. & ms & Empty \\\\');
tex.push('\\midrule');
const mapRow = (m, withPddl) => {
    const d = withPddl ? perMap[m] : compare(allRows.filter(r => r.map === m && r.mode === 'base'));
    const x = meta[m];
    const runs = withPddl ? liveRuns[m] : totalRuns(m);
    const pddlCells = withPddl
        ? `${f1(d.pddlPpm)} & ${f0(d.retention)}\\% & ${f0(d.solveMs)} & ${f0(d.emptyPct)}\\%`
        : '--- & --- & --- & ---';
    return `\\texttt{${esc(m)}} & ${runs} & ${x.walkable} & ${x.spawners ?? ''} & ${x.delivery ?? ''} & ${x.pmax ?? ''}${x.defaults ? '$^{\\dagger}$' : ''} & `
        + `${x.lifetime == null ? '$\\infty$' : f0(x.lifetime)} & ${f1(d.basePpm)} & ${pddlCells} \\\\`;
};
for (const m of mapsWithPddl) tex.push(mapRow(m, true));
const outageMaps = maps.filter(m => !liveRuns[m]);
if (outageMaps.length) {
    tex.push('\\midrule');
    tex.push(`\\multicolumn{12}{l}{\\textit{Solver unreachable --- baseline only}} \\\\`);
    for (const m of outageMaps) tex.push(mapRow(m, false));
}
tex.push('\\bottomrule');
tex.push('\\multicolumn{12}{l}{\\footnotesize $^{\\dagger}$ no level file: played with the backend default settings.} \\\\');
tex.push('\\end{tabular}');
tex.push('\\label{tab:maps}');
tex.push('\\end{table*}');
tex.push('');

// --- Table 2: class aggregates ---
const groups = [
    ['Problem size (walkable tiles)', SIZE_CLASSES],
    ['Parcel lifetime', LIFE_CLASSES],
    ['Contention', CHALLENGE_CLASSES],
];
tex.push('\\begin{table}[t]');
tex.push('\\centering');
tex.push('\\caption{PDDL vs.\\ baseline per class of map, over the runs in which the solver was reachable. Parcel lifetime is $PRA \\times PDI$, the seconds a fresh parcel stays worth anything; retention is the PDDL score as a fraction of the baseline score.}');
tex.push('\\footnotesize');
tex.push('\\setlength{\\tabcolsep}{3.5pt}');
tex.push('\\begin{tabular}{lrrrrrr}');
tex.push('\\toprule');
tex.push('Class & Maps & Base & PDDL & Ret. & Solve & Empty \\\\');
tex.push(' & & \\multicolumn{2}{c}{pts/min} & & ms & plans \\\\');
tex.push('\\midrule');
for (const [title, classes] of groups) {
    tex.push(`\\multicolumn{7}{l}{\\textit{${title}}} \\\\`);
    for (const [label, pick] of classes) {
        const c = classRow(label, pick);
        if (!c) continue;
        tex.push(`\\quad ${label} & ${c.maps.length} & ${f1(c.basePpm)} & ${f1(c.pddlPpm)} & ${f0(c.retention)}\\% & ${f0(c.solveMs)} & ${f0(c.emptyPct)}\\% \\\\`);
    }
}
tex.push('\\bottomrule');
tex.push('\\end{tabular}');
tex.push('\\label{tab:classes}');
tex.push('\\end{table}');
tex.push('');

// --- Table 3: team-level view of the coordination maps ---
// Teams are the unit here, so the two agents of a team are summed. The
// baseline uses every run of the map (it is unaffected by the solver outage).
const teamStats = (mapName, mode, pool) => {
    const teams = new Map();
    for (const r of pool.filter(r => r.map === mapName && r.mode === mode && r.team)) {
        const key = `${r.run}|${r.team}`;
        if (!teams.has(key)) teams.set(key, []);
        teams.get(key).push(r);
    }
    const full = [...teams.values()].filter(t => t.length === 2);
    if (!full.length) return null;
    return {
        n: full.length,
        ppm: full.map(t => sum(t, 'points_per_min')),
        deliv: full.map(t => sum(t, 'parcels_delivered')),
        handoffs: full.map(t => sum(t, 'parcels_handed_off')),
        observed: full.map(t => mean(t.map(r => num(r.explored_observed_pct)))),
    };
};
const c2maps = maps.filter(m => allRows.some(r => r.map === m && r.team));
if (c2maps.length) {
    tex.push('\\begin{table}[t]');
    tex.push('\\centering');
    // Single-file corridors admit only one team per run (the runner alternates
    // configurations across runs there), so they contribute fewer team-runs.
    const teamCounts = c2maps.map(m => [m, teamStats(m, 'base', allRows)?.n ?? 0]);
    const maxTeams = Math.max(...teamCounts.map(([, n]) => n));
    const short = teamCounts.filter(([, n]) => n && n < maxTeams).map(([m]) => `\\texttt{${esc(m)}}`);
    const note = short.length
        ? ` Only one team fits on ${short.join(', ')}, where the runner alternates configurations across runs, so ${short.length > 1 ? 'those maps contribute' : 'that map contributes'} fewer team-runs.`
        : '';
    tex.push(`\\caption{Team-level results on the coordination maps: the two agents of a team summed, mean per team-run, baseline configuration over all runs.${note}}`);
    tex.push('\\footnotesize');
    tex.push('\\setlength{\\tabcolsep}{4pt}');
    tex.push('\\begin{tabular}{lrrrrr}');
    tex.push('\\toprule');
    tex.push('Map & Teams & pts/min & Deliv. & Handoffs & Observed \\\\');
    tex.push('\\midrule');
    for (const m of c2maps) {
        const t = teamStats(m, 'base', allRows);
        if (!t) continue;
        tex.push(`\\texttt{${esc(m)}} & ${t.n} & ${f1(mean(t.ppm))} $\\pm$ ${f0(std(t.ppm))} & ${f1(mean(t.deliv))} & ${mean(t.handoffs).toFixed(2)} & ${f0(mean(t.observed))}\\% \\\\`);
    }
    tex.push('\\bottomrule');
    tex.push('\\end{tabular}');
    tex.push('\\label{tab:team}');
    tex.push('\\end{table}');
}

const out = tex.join('\n') + '\n';
if (opts.out) { fs.writeFileSync(opts.out, out); console.error(`Wrote ${opts.out}`); }
else process.stdout.write(out);

/* ------------------------------------------------------------------ *
 *  Derived figures quoted in the prose (stderr)
 * ------------------------------------------------------------------ */

const all = compare(rows);
// The solver outage is an unplanned test of the fallback architecture: with
// the planner permanently unavailable, a PDDL-configured agent should lose
// only the timeouts it spends before the circuit breaker trips.
const outageMapList = maps.filter(m => !liveRuns[m]);
const outage = outageMapList.length ? compare(outageRows.filter(r => outageMapList.includes(r.map))) : null;
const withLife = mapsWithPddl.filter(m => meta[m].lifetime != null);
const log = (...a) => console.error(...a);
log('');
log(`campaign: ${allRows.length} agent-runs over ${maps.length} maps`);
log(`  usable for the PDDL comparison: ${rows.length} agent-runs over ${mapsWithPddl.length} maps `
    + `(${rows.filter(r => r.mode === 'base').length} baseline / ${rows.filter(r => r.mode === 'pddl').length} PDDL)`);
log(`  excluded (solver unreachable): ${outageRows.length} agent-runs over ${new Set(outageRows.map(runKey)).size} runs`);
log(`overall     : base ${f1(all.basePpm)} vs pddl ${f1(all.pddlPpm)} pts/min (retention ${f0(all.retention)}%)`);
log(`throughput  : ${all.baseDm.toFixed(2)} -> ${all.pddlDm.toFixed(2)} deliveries/min, +${f1(all.deadSeconds)} s dead time per delivery`);
log(`solver      : ${f0(all.solveMs)} ms mean, ${f1(all.planSteps)} steps, ${f0(all.solvedPct)}% solved / ${f0(all.emptyPct)}% empty / ${all.errorPct.toFixed(1)}% transport errors`);
log(`             ${all.attemptsPerDelivery.toFixed(1)} solver calls per delivered parcel, breaker fired in ${all.breakerRuns} runs`);
log(`carry time  : ${f1(all.baseCarry)} s -> ${f1(all.pddlCarry)} s`);
if (outage) {
    const wasted = mean(outageRows.filter(r => r.mode === 'pddl').map(r => num(r.pddl_attempts)));
    log('');
    log(`solver outage: ${outageMapList.length} maps (${outageMapList.join(', ')}) played with the solver unreachable`);
    log(`             pddl-configured ${f1(outage.pddlPpm)} vs baseline ${f1(outage.basePpm)} pts/min -> ${f0(outage.retention)}% retained on fallback alone`);
    log(`             ${wasted.toFixed(1)} solver attempts per run before the breaker tripped`);
    log('');
}
log(`coverage    : observed ${f1(all.baseObserved)}% -> ${f1(all.pddlObserved)}%, visited ${f1(all.baseVisited)}% -> ${f1(all.pddlVisited)}%`);
log(`corr(tiles, solve ms)        = ${corr(mapsWithPddl.map(m => meta[m].walkable), mapsWithPddl.map(m => perMap[m].solveMs)).toFixed(2)}`);
log(`corr(empty plans, retention) = ${corr(mapsWithPddl.map(m => perMap[m].emptyPct), mapsWithPddl.map(m => perMap[m].retention)).toFixed(2)}`);
log(`corr(parcel life, retention) = ${corr(withLife.map(m => meta[m].lifetime), withLife.map(m => perMap[m].retention)).toFixed(2)}  (decaying maps only)`);
log(`corr(parcel life, empty)     = ${corr(withLife.map(m => meta[m].lifetime), withLife.map(m => perMap[m].emptyPct)).toFixed(2)}`);
log('');
for (const [title, classes] of groups) {
    log(title);
    for (const [label, pick] of classes) {
        const c = classRow(label, pick);
        if (!c) continue;
        log(`  ${label.replace(/\\[a-z]+|[${}]/g, '').padEnd(24)} n=${String(c.maps.length).padStart(2)} ret ${f0(c.retention).padStart(3)}%  solve ${f0(c.solveMs)}ms  empty ${f0(c.emptyPct).padStart(2)}%  dead ${f1(c.deadSeconds).padStart(5)}s  carry ${f1(c.baseCarry)}->${f1(c.pddlCarry)}s`);
    }
}

// Size and lifetime are partly confounded (which maps happen to be big), so
// cross-tabulate them before attributing a retention trend to either.
log('');
log('retention cross-tab (size x lifetime)');
for (const [lifeLabel, lifePick] of LIFE_CLASSES) {
    const cells = SIZE_CLASSES.map(([sizeLabel, sizePick]) => {
        const c = classRow('x', m => lifePick(m) && sizePick(m));
        return `${sizeLabel.split(' ')[0]} ${c ? f0(c.retention) + '% (' + c.maps.length + ')' : '--'}`;
    });
    log(`  ${lifeLabel.replace(/\\[a-z]+|[${}]/g, '').padEnd(20)} ${cells.join('  ')}`);
}
