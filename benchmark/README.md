# Benchmark testbench

Evaluates the agent on the `25c*_*` validation maps and produces the CSV
tables used in the report.

## How it works

- Every agent process emits machine-parsable `METRIC {json}` lines on stdout
  (instrumentation lives in `src/agent/benchmark/metrics.js`, enabled hooks in
  `IntentionRevision`, `Intention`, `PddlPlan`). With `BENCH=1` the agent also
  emits a cumulative `snapshot` every 5 s and, when `BENCH_DURATION_MS` is set,
  a final `run_end` record before exiting on its own.
- `run-benchmark.js` runs the campaign: for every map it starts a fresh local
  Deliveroo server on the corresponding level file and connects the agents:
  - `25c1_*` — 6 independent single agents (`--singles` to change): 3 with
    PDDL (`pddl_1..3`), 3 without (`base_1..3`). Both modes play
    **simultaneously on the same server**, so they face identical parcel
    spawns and congestion (paired design). Six is deliberate: the smallest
    maps have only ~160 walkable tiles and 2 delivery tiles — more bodies
    would measure traffic-jam tolerance instead of planning quality.
  - `25c2_*` — 4 teams of 2: `pddlA`, `pddlB` with PDDL, `baseA`, `baseB`
    without, all on the same server (paired design). Each team gets its own
    `TEAM_SECRET`, so teams never cross-link over the broadcast message bus.
  - `25c2_hallway` (special case, scheduled **last**) — **one team of 2 per
    run**, alternating mode: PDDL on odd runs (`pddlT_1/2`), baseline on
    even runs (`baseT_1/2`). This map is a single-file corridor where agents
    cannot pass each other, so a second team would gridlock the run rather
    than compete. Comparing across runs is sound here: the level has zero
    reward variance and a fixed 1 s spawn interval. Use an even `--runs` so
    both modes get the same number of games (consider `--runs 20` on this
    map to keep 10 samples per mode).
- `parse-logs.js` reads all logs and writes the CSVs.
- `report-tables.js` turns `results.csv` into the LaTeX tables used in the
  report's validation section. It groups the maps into classes (planning-
  problem size, parcel lifetime `PRA x PDI`, single-agent vs team
  contention) read from the Deliveroo.js level files, so the PDDL/baseline
  comparison is reported per kind of environment rather than pooled. The
  derived figures quoted in the prose (correlations, dead time per
  delivery, solver call counts) go to stderr.

## Usage

```bash
# full campaign: 10 maps x 10 runs x 3 min  (~5.5 h; resumable, completed
# runs are skipped on re-launch)
npm run bench

# quick smoke test
npm run bench -- --maps 25c1_1 --runs 1 --duration 60

# then produce the CSVs
npm run bench:parse

# and the report's LaTeX tables (stdout, or --out file.tex)
npm run bench:tables
```

Options for `run-benchmark.js`: `--deliveroo <path to Deliveroo.js repo>`
(default `../../../Deliveroo.js`), `--maps a,b,...`, `--runs n` (10),
`--singles n` (6), `--duration s` (180), `--out dir` (`benchmark/logs`),
`--port n` (4310), `--solver <url>`.

Logs land in `benchmark/logs/<map>/run_XX/` (`server.log`, one `.log` per
agent, `manifest.json` on completion).

Both scripts are plain Node (no shell tricks) and run identically on
**Windows and Linux**. For manually launched agents, env-var prefixes like
`TEAM=1 node ...` are Bash-only, so the agent also accepts cross-platform CLI
args: `node src/autonomousRider.js -name=A1 -team=1 -pddl=0`.

## PDDL solver

The runner picks the solver in this order:

1. `--solver <url>` or `PAAS_HOST` env — aborts if unreachable (better than
   burning hours tripping circuit breakers);
2. a local [planning-as-a-service](https://github.com/AI-Planning/planning-as-a-service)
   probed at `http://localhost:5001` (start it with `docker compose up` in its
   `server/` folder — works on Docker Desktop for Windows and on Linux);
3. the public `solver.planning.domains:5001` as fallback — expect 3–5 s per
   solve and shared-load noise, which heavily penalizes the PDDL agents.

Up to 4 PDDL agents solve concurrently (the c2 4-team runs), so set
`WORKER_NUMBERS=4` in the planning-as-a-service `server/.env` (default 1),
otherwise their solves queue behind each other and the wait counts toward the
agent's 5 s solver timeout.

## Outputs (in `benchmark/logs/`)

- `results.csv` — one row per agent per run, all metrics.
- `summary.csv` — mean ± std grouped by challenge (`c1`/`c2`) and mode
  (`pddl`/`base`), plus an `all` row per mode. This is the headline
  PDDL-vs-baseline table.
- `summary_by_map.csv` — same aggregation per map.
- `timeseries.csv` — score every 5 s, for score-progression plots.

## Metrics collected

| Metric | Meaning |
| --- | --- |
| `score`, `points_per_min` | final server-side score; normalized by active play time |
| `parcels_picked`, `parcels_delivered`, `reward_delivered` | pickup/delivery counts and banked reward |
| `deliveries`, `avg_carry_s` | delivery trips; mean time a parcel is carried before delivery |
| `handoff_drops`, `parcels_handed_off` | team-only: parcels donated to the teammate |
| `intentions_completed`, `intentions_failed` | top-level BDI intentions (failures exclude queue-swap preemptions) |
| `plans_failed`, `plans_stopped` | plan executions that threw genuine errors vs. preempted ones |
| `pddl_attempts/solved/empty_plans/solver_errors` | online-solver round trips and outcomes |
| `pddl_avg_solve_ms`, `pddl_avg_plan_steps`, `pddl_circuit_breaker` | solver latency, plan length, whether PDDL got disabled mid-run |
| `moves_ok`, `moves_failed`, `move_fail_pct` | movement actions and collision/block rate |
| `explored_visited_pct` | % of walkable tiles the agent physically stepped on |
| `explored_observed_pct` | % of walkable tiles that entered the sensing radius |
| `msgs_sent` | team messages sent (by type in the raw METRIC records) |
