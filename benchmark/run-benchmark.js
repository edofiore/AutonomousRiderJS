#!/usr/bin/env node
/**
 * Testbench runner: evaluates the agent on the validation challenge maps.
 * Pure Node — runs identically on Windows and Linux.
 *
 * For every map matching 25c*_* in <Deliveroo.js>/backend/levels/maps it
 * plays RUNS games of DURATION seconds each, on a freshly started local
 * Deliveroo server:
 *
 *   25c1_* (single-agent challenges): 6 independent agents on the same
 *          server — 3 with PDDL planning enabled, 3 without (--singles to
 *          change). Both modes face identical parcel spawns and congestion,
 *          a paired comparison rather than two separate conditions.
 *   25c2_* (multi-agent challenges):  4 teams of 2 agents — 2 teams with
 *          PDDL, 2 without, each with its own TEAM_SECRET so teams never
 *          cross-link over the broadcast message bus.
 *   25c2_hallway (special-cased, runs LAST): a single-file corridor where
 *          agents cannot pass each other — more than one team would simply
 *          gridlock. ONE team of 2 per run, alternating PDDL (odd runs) and
 *          non-PDDL (even runs); the across-run comparison is sound because
 *          the level has zero reward variance and a fixed spawn interval.
 *          Use an even --runs so both modes get the same number of games.
 *
 * Every agent runs with BENCH=1 and BENCH_DURATION_MS set: it emits
 * "METRIC {json}" lines (see src/agent/benchmark/metrics.js) and exits by
 * itself when the time is up. All output is captured under:
 *
 *   benchmark/logs/<map>/run_XX/{server.log, <agent>.log, manifest.json}
 *
 * manifest.json is written only when the run completes, so re-launching the
 * script resumes an interrupted campaign (completed runs are skipped).
 *
 * Usage:
 *   node benchmark/run-benchmark.js [options]
 *     --deliveroo <path>   Deliveroo.js repo root   (default: ../../../Deliveroo.js)
 *     --maps <a,b,...>     only these maps          (default: all 25c*_*)
 *     --runs <n>           runs per map             (default: 10)
 *     --singles <n>        agents on 25c1 maps, half PDDL (default: 6, even)
 *     --duration <s>       seconds per run          (default: 180)
 *     --out <dir>          output directory         (default: benchmark/logs)
 *     --port <n>           first server port        (default: 4310)
 *     --solver <url>       PDDL solver base URL (planning-as-a-service).
 *                          Default: PAAS_HOST env if set; otherwise a local
 *                          solver is probed at http://localhost:5001 and the
 *                          public solver.planning.domains is the fallback.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load the project .env (PAAS_HOST etc.) so it drives the runner's defaults
// below no matter where the script is launched from. Real env vars win:
// dotenv never overrides variables that are already set.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

/* ------------------------------------------------------------------ *
 *  CLI options
 * ------------------------------------------------------------------ */

const opts = {
    deliveroo: process.env.DELIVEROO_DIR ?? path.resolve(PROJECT_ROOT, '..', '..', '..', 'Deliveroo.js'),
    maps: null,
    runs: 10,
    singles: 6,
    duration: 180,
    out: path.join(PROJECT_ROOT, 'benchmark', 'logs'),
    port: 4310,
    solver: process.env.PAAS_HOST ?? null,
};

const LOCAL_SOLVER = 'http://localhost:5001';
const PUBLIC_SOLVER = 'https://solver.planning.domains:5001';

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const [flag, inlineVal] = argv[i].split('=');
    const val = inlineVal ?? argv[++i];
    switch (flag) {
        case '--deliveroo': opts.deliveroo = path.resolve(val); break;
        case '--maps': opts.maps = val.split(',').map(s => s.trim().replace(/\.js$/, '')); break;
        case '--runs': opts.runs = parseInt(val, 10); break;
        case '--singles': opts.singles = parseInt(val, 10); break;
        case '--duration': opts.duration = parseInt(val, 10); break;
        case '--out': opts.out = path.resolve(val); break;
        case '--port': opts.port = parseInt(val, 10); break;
        case '--solver': opts.solver = val; break;
        default:
            console.error(`Unknown option: ${flag}`);
            process.exit(1);
    }
}

const BACKEND_DIR = path.join(opts.deliveroo, 'backend');
const MAPS_DIR = path.join(BACKEND_DIR, 'levels', 'maps');
const DURATION_MS = opts.duration * 1000;
const AGENT_EXIT_GRACE_MS = 45000;   // extra time for agents to self-exit
const AGENT_SPAWN_STAGGER_MS = 300;

if (!fs.existsSync(MAPS_DIR)) {
    console.error(`Deliveroo maps folder not found: ${MAPS_DIR}\nPass the repo root with --deliveroo <path>.`);
    process.exit(1);
}

if (!Number.isInteger(opts.singles) || opts.singles < 2 || opts.singles % 2 !== 0) {
    console.error(`--singles must be an even number >= 2 (got ${opts.singles}), half run with PDDL and half without.`);
    process.exit(1);
}

/* ------------------------------------------------------------------ *
 *  Map discovery
 * ------------------------------------------------------------------ */

let maps = fs.readdirSync(MAPS_DIR)
    .filter(f => /^25c\d+_.+\.js$/.test(f))
    .map(f => f.replace(/\.js$/, ''))
    .sort();

if (opts.maps) {
    const missing = opts.maps.filter(m => !maps.includes(m));
    if (missing.length) {
        console.error(`Unknown map(s): ${missing.join(', ')}\nAvailable: ${maps.join(', ')}`);
        process.exit(1);
    }
    maps = opts.maps;
}

if (maps.length === 0) {
    console.error('No 25c*_* maps found.');
    process.exit(1);
}

// Single-file corridor maps: only one team fits at a time (see line-ups
// below). They run last; the stable sort preserves the rest of the order.
const SOLO_TEAM_MAPS = new Set(['25c2_hallway']);
maps.sort((a, b) => Number(SOLO_TEAM_MAPS.has(a)) - Number(SOLO_TEAM_MAPS.has(b)));

/* ------------------------------------------------------------------ *
 *  Agent line-ups
 * ------------------------------------------------------------------ */

/**
 * @param {string} map
 * @param {number} run 1-based run index (drives the c2 mode alternation)
 * @returns {{name:string, pddl:boolean, team:string|null}[]} spawn-ordered
 *          agent specs, interleaved so neither mode systematically joins first
 */
function buildAgentSpecs(map, run) {
    const specs = [];
    if (/^25c1_/.test(map)) {
        // Single agents, half PDDL half baseline, all on the same server
        // (paired conditions). Kept moderate: the smallest 25c1 maps have
        // ~160 walkable tiles, more bodies would measure congestion instead
        // of planning.
        for (let i = 1; i <= Math.floor(opts.singles / 2); i++) {
            specs.push({ name: `pddl_${i}`, pddl: true, team: null });
            specs.push({ name: `base_${i}`, pddl: false, team: null });
        }
    } else if (SOLO_TEAM_MAPS.has(map)) {
        // ONE team of 2 per run, mode alternating with the run index
        // (odd = PDDL, even = baseline). These maps are single-file
        // corridors where agents cannot pass each other: a second team
        // would not compete, it would gridlock the run for everyone.
        const pddl = run % 2 === 1;
        const tag = pddl ? 'pddlT' : 'baseT';
        specs.push({ name: `${tag}_1`, pddl, team: tag });
        specs.push({ name: `${tag}_2`, pddl, team: tag });
    } else {
        // 4 teams of 2 on the same server: 2 PDDL teams, 2 baseline teams
        // (paired conditions). Each team gets its own TEAM_SECRET (below),
        // so teams never cross-link over the broadcast message bus.
        const teams = [
            { tag: 'pddlA', pddl: true }, { tag: 'baseA', pddl: false },
            { tag: 'pddlB', pddl: true }, { tag: 'baseB', pddl: false },
        ];
        for (const member of [1, 2])
            for (const t of teams)
                specs.push({ name: `${t.tag}_${member}`, pddl: t.pddl, team: t.tag });
    }
    return specs;
}

/* ------------------------------------------------------------------ *
 *  Process helpers
 * ------------------------------------------------------------------ */

/** Children still alive, killed on exit/Ctrl+C. */
const liveChildren = new Set();

function track(child) {
    liveChildren.add(child);
    child.once('exit', () => liveChildren.delete(child));
    return child;
}

function killAll() {
    for (const c of liveChildren) {
        try { c.kill(); } catch { /* already gone */ }
    }
}

process.on('SIGINT', () => { console.log('\nInterrupted — killing children...'); killAll(); process.exit(130); });
process.on('exit', killAll);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function onExit(child) {
    return new Promise(res => child.once('exit', (code) => res(code)));
}

/** Resolve when the promise settles or ms elapse (resolves 'timeout'). */
function withTimeout(promise, ms) {
    return Promise.race([promise, sleep(ms).then(() => 'timeout')]);
}

function startServer({ map, port, logPath }) {
    const levelRel = `levels/${map}.js`;
    const env = { ...process.env, PORT: String(port) };
    if (fs.existsSync(path.join(BACKEND_DIR, levelRel))) {
        env.LEVEL = levelRel;
    } else {
        // No level config for this map: run it with the backend defaults.
        console.warn(`  WARN: no level file ${levelRel}, using MAP_FILE=${map} with default settings`);
        delete env.LEVEL; // a stale LEVEL inherited from the shell would override MAP_FILE
        env.MAP_FILE = map;
    }
    const log = fs.createWriteStream(logPath);
    const child = spawn(process.execPath, ['index.js'], {
        cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    return track(child);
}

/** True if the URL answers HTTP at all (any status counts as alive). */
async function isReachable(url, timeoutMs = 3000) {
    try {
        await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return true;
    } catch {
        return false;
    }
}

/**
 * Pick the PDDL solver for the campaign: explicit --solver / PAAS_HOST (must
 * be reachable, or we abort rather than burn hours tripping circuit
 * breakers), else a local planning-as-a-service if one is running, else the
 * public solver.
 */
async function resolveSolver() {
    if (opts.solver) {
        if (!await isReachable(opts.solver)) {
            console.error(`PDDL solver not reachable at ${opts.solver}.`
                + ` Start it (planning-as-a-service: "docker compose up" in server/) or drop --solver.`);
            process.exit(1);
        }
        return opts.solver;
    }
    if (await isReachable(LOCAL_SOLVER)) {
        console.log(`Using local PDDL solver at ${LOCAL_SOLVER}`);
        return LOCAL_SOLVER;
    }
    console.warn(`No local PDDL solver on ${LOCAL_SOLVER} — falling back to the public one`
        + ` (${PUBLIC_SOLVER}, expect 3-5s per solve).`);
    return PUBLIC_SOLVER;
}

let solverHost; // resolved once before the campaign starts

async function waitForServer(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(`http://localhost:${port}/`);
            return; // any HTTP response means the server is listening
        } catch {
            await sleep(500);
        }
    }
    throw new Error(`server did not come up on port ${port} within ${timeoutMs} ms`);
}

function startAgent({ spec, map, run, port, logPath }) {
    const env = {
        ...process.env,
        DELIVEROO_HOST: `http://localhost:${port}`,
        DELIVEROO_TOKEN: 'NEW',                 // fresh identity from -name
        PAAS_HOST: solverHost,                  // PDDL solver (pddl-client)
        PDDL: spec.pddl ? '1' : '0',
        TEAM: spec.team ? '1' : '0',
        BENCH: '1',
        BENCH_DURATION_MS: String(DURATION_MS),
        DEBUG: '0',
        DEBUG_MOVE: '0',
    };
    if (spec.team) env.TEAM_SECRET = `bench-${map}-run${run}-${spec.team}`;
    const log = fs.createWriteStream(logPath);
    const child = spawn(process.execPath, ['src/autonomousRider.js', `-name=${spec.name}`], {
        cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    return track(child);
}

/* ------------------------------------------------------------------ *
 *  One run = fresh server + 8 agents for the configured duration
 * ------------------------------------------------------------------ */

async function executeRun({ map, run, port }) {
    const runDir = path.join(opts.out, map, `run_${String(run).padStart(2, '0')}`);
    const manifestPath = path.join(runDir, 'manifest.json');

    if (fs.existsSync(manifestPath)) {
        console.log(`  run ${run}: already completed, skipping (delete ${path.relative(PROJECT_ROOT, runDir)} to redo)`);
        return;
    }
    fs.mkdirSync(runDir, { recursive: true });

    const specs = buildAgentSpecs(map, run);
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    const server = startServer({ map, port, logPath: path.join(runDir, 'server.log') });
    try {
        await waitForServer(port);
        console.log(`  run ${run}: playing on http://localhost:${port} (${opts.duration}s) — open it in a browser to watch`);

        const agents = [];
        for (const spec of specs) {
            agents.push({
                spec,
                child: startAgent({ spec, map, run, port, logPath: path.join(runDir, `${spec.name}.log`) }),
            });
            await sleep(AGENT_SPAWN_STAGGER_MS);
        }

        // Agents self-exit after BENCH_DURATION_MS; give them a grace period,
        // then terminate stragglers.
        const result = await withTimeout(
            Promise.all(agents.map(a => onExit(a.child))),
            DURATION_MS + AGENT_EXIT_GRACE_MS
        );
        if (result === 'timeout') {
            console.warn('  WARN: some agents did not exit in time, killing them');
            for (const a of agents) { try { a.child.kill(); } catch { /* gone */ } }
            await sleep(2000);
        }

        fs.writeFileSync(manifestPath, JSON.stringify({
            map,
            challenge: /^25c(\d+)_/.exec(map)?.[1] ? `c${/^25c(\d+)_/.exec(map)[1]}` : 'unknown',
            run,
            port,
            durationMs: DURATION_MS,
            startedAt,
            finishedAt: new Date().toISOString(),
            server: 'server.log',
            agents: specs.map(s => ({ name: s.name, pddl: s.pddl, team: s.team, log: `${s.name}.log` })),
        }, null, 2));

        console.log(`  run ${run}: done in ${Math.round((Date.now() - t0) / 1000)}s`);
    } finally {
        try { server.kill(); } catch { /* gone */ }
        await sleep(1000); // let the port be released before the next run
    }
}

/* ------------------------------------------------------------------ *
 *  Campaign
 * ------------------------------------------------------------------ */

const totalRuns = maps.length * opts.runs;
console.log(`Benchmark campaign: ${maps.length} maps x ${opts.runs} runs x ${opts.duration}s`
    + ` (~${Math.round(totalRuns * (opts.duration + 25) / 60)} min if nothing is skipped)`);
console.log(`Maps: ${maps.join(', ')}`);
solverHost = await resolveSolver();
console.log(`PDDL solver: ${solverHost}`);
console.log(`Output: ${opts.out}\n`);

let runCounter = 0;
for (const map of maps) {
    console.log(`Map ${map} (${/^25c1_/.test(map)
        ? `${opts.singles} single agents (half PDDL)`
        : SOLO_TEAM_MAPS.has(map)
            ? '1 team of 2 per run, PDDL on odd runs / baseline on even runs'
            : '4 teams of 2 (2 PDDL + 2 baseline)'}):`);
    for (let run = 1; run <= opts.runs; run++) {
        const port = opts.port + (runCounter++ % 50); // rotate ports to dodge TIME_WAIT
        try {
            await executeRun({ map, run, port });
        } catch (err) {
            console.error(`  run ${run}: FAILED — ${err.message ?? err}`);
        }
    }
}

console.log('\nCampaign finished. Parse the logs with: npm run bench:parse');
