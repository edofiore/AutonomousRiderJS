# AutonomousRiderJS

A BDI (Belief–Desire–Intention) autonomous agent for the
[Deliveroo.js](https://github.com/unitn-ASA/Deliveroo.js) game — the
**Autonomous Software Agents** (ASA) course project, University of Trento.

*Authors: Edoardo Fiorentino, Leonardo Collizzolli*

The agent picks up parcels and delivers them to delivery zones to maximize
its score. The project covers the three course deliverables:

1. **Single agent (BDI)** — sensing, belief revision, utility-based option
   generation, intention revision with replanning, and a plan library.
2. **Multi-agent coordination** — two agents team up over the game's message
   bus: belief sharing, parcel claims, an evolved map partition, and
   opportunistic parcel handoffs.
3. **PDDL planning** — pickup/delivery intentions can be solved by a real
   PDDL planner (planning-as-a-service) instead of the hand-written plans.

---

## How it works

```
        sensing (socket.io events)
   onYou / onParcelsSensing / onAgentsSensing
                  │
                  ▼
   ┌─────────  Beliefs  ─────────────────────────────┐
   │ me, parcels, other agents, map graph, teammate  │
   └──────────────────┬──────────────────────────────┘
                      ▼
        Options generation (reasoning/)
   every option (pick up p / deliver / explore) gets a
   utility score: reward at destination after decay,
   distance (O(1) BFS tables), competition, failures
                      ▼
        Intention revision (intentionRevision/)
   priority queue of intentions; a new option preempts the
   current one only if it beats it by a 10% margin
   (hysteresis); failed intentions are retried or banned
                      ▼
        Plan library (planning/)
   PddlPlan → GoPickUp → BlindMove → GoDeliver
   plans are tried in order; if one throws, the next
   applicable one takes over (PDDL falls back to classical)
                      ▼
        actions: emitMove / emitPickup / emitPutdown
```

- **Pathfinding** — the map is a [graphology](https://graphology.github.io/)
  graph; distances come from lazily-built BFS tables keyed on the target tile
  (O(1) lookups on the scoring hot path). `BlindMove` replans around blocked
  tiles and gives way to the teammate on head-on deadlocks.
- **Team mode** — teammates discover each other by broadcasting a shared
  secret, then exchange beliefs (throttled), claim parcels so they never chase
  the same one, split the map with an evolutionary spawner partition, and hand
  parcels off when one of them is better placed to deliver.
- **PDDL mode** — `PddlPlan` builds a STRIPS problem from current beliefs
  (map connectivity is cached, blocked tiles from live sensing) and calls an
  online solver. A circuit breaker disables PDDL for the session after
  repeated solver failures, so the classical plans keep the agent alive.

## Requirements

- Node.js ≥ 18 (tested on 22) — Windows and Linux both supported
- A [Deliveroo.js](https://github.com/unitn-ASA/Deliveroo.js) server
- Optional, for PDDL: a local
  [planning-as-a-service](https://github.com/AI-Planning/planning-as-a-service)
  (`docker compose up` in its `server/` folder → `http://localhost:5001`).
  Without one, the public `solver.planning.domains` is used (3–5 s per solve).

## Setup

```bash
npm install
cp .env.example .env   # then adjust (solver URL, host, ...)
```

Start a Deliveroo server (in the Deliveroo.js repo):

```bash
cd Deliveroo.js/backend
PORT=4001 node index.js                          # default map
# or with a level file:  LEVEL=levels/25c1_1.js PORT=4001 node index.js
```

## Running the agent

```bash
# single agent (classical plans, default)
node src/autonomousRider.js -name=Rider

# single agent with PDDL planning
node src/autonomousRider.js -name=Rider -pddl=1

# a team of two (run in two terminals)
npm run agent1        # = node src/autonomousRider.js -name=A1 -team=1
npm run agent2        # = node src/autonomousRider.js -name=A2 -team=1
```

CLI args work identically in Bash, PowerShell and cmd. Configuration
precedence: **CLI args > environment variables > `.env` > defaults**.

| Setting | CLI | Env / `.env` | Default |
| --- | --- | --- | --- |
| Agent name (fresh identity) | `-name=X` | — | token identity |
| Auth token | — | `DELIVEROO_TOKEN` (`NEW` = force fresh identity) | built-in token |
| Server URL | — | `DELIVEROO_HOST` | `http://localhost:4001` |
| Team mode | `-team=1` | `TEAM` | off |
| Team secret | — | `TEAM_SECRET` | shared default |
| PDDL planning | `-pddl=1` | `PDDL` | off |
| PDDL solver | — | `PAAS_HOST`, `PAAS_PATH` | public solver |
| Solver timeout / breaker | — | `PDDL_TIMEOUT_MS`, `PDDL_MAX_FAILURES` | 5000 ms / 3 |
| Verbose logs | — | `DEBUG=1`, `DEBUG_MOVE=1` | off |

Note: passing `-name=X` (without an explicit `DELIVEROO_TOKEN`) connects
token-less and lets the server mint a fresh identity called `X` — so any
number of agents can be launched without token juggling.

## Evaluation / benchmark

The repo ships a full testbench (see [benchmark/README.md](benchmark/README.md)):
every agent emits machine-parsable `METRIC {json}` lines (score, pickups,
deliveries, failed intentions/plans, PDDL solver latency, map exploration, …),
a runner plays the `25c*_*` validation maps (PDDL and non-PDDL agents side by
side on the same server — 6 singles on c1 maps, 4 teams of 2 on c2 maps; the
single-file `25c2_hallway` corridor runs last with one alternating team per
run), and a parser turns the logs into CSV tables.

```bash
npm run bench          # full campaign: 10 maps x 10 runs x 3 min (resumable)
npm run bench:parse    # -> results.csv, summary.csv, summary_by_map.csv, timeseries.csv
```

## Project layout

```
src/
  autonomousRider.js        entry point: sensing loop + initialization
  config/                   host/token/team/PDDL configuration
  agent/
    beliefs/                me, parcels, other agents, map graph
    reasoning/              option generation + utility scoring, tour EA
    intention/              Intention: plan selection & execution
    intentionRevision/      queue, preemption with hysteresis, retries
    planning/               PddlPlan, GoPickUp, GoDeliver, BlindMove, paths
    coordination/           team discovery, belief sharing, claims, handoffs
    benchmark/metrics.js    METRIC instrumentation (see benchmark/)
benchmark/                  testbench runner + log parser + docs
```
