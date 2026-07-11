import { default as argsParser } from "args-parser";

// CLI args are a cross-platform alternative to env vars (the `TEAM=1 node ...`
// prefix is Bash-only; PowerShell/cmd need different syntax). CLI wins over
// env: e.g. `node src/autonomousRider.js -name=A1 -team=1 -pddl=0`.
const args = argsParser(process.argv);

const config = {
    host: process.env.DELIVEROO_HOST ?? "http://localhost:4001",
    // host: "https://deliveroojs.onrender.com",
    // host: "http://rtibdi.disi.unitn:8080",
    // host: "https://deliveroojs25.azurewebsites.net/?name=edo",
    // host: "https://deliveroojs25.azurewebsites.net/",
    // host: "https://deliveroojs.azurewebsites.net/",

    // Identity resolution:
    //   1. DELIVEROO_TOKEN env/.env — explicit token wins. The sentinel 'NEW'
    //      forces a token-less connection (empty env vars are unreliable on
    //      Windows, hence a sentinel instead of '').
    //   2. -name=<x> CLI arg — token-less connection; the server mints a fresh
    //      identity named <x>. Without this rule the hardcoded fallback below
    //      would silently override -name (a non-empty token takes precedence
    //      in DeliverooApi) and every agent would join as the SAME identity.
    //   3. fallback: hardcoded token (agent1), for a bare `npm start`.
    token: process.env.DELIVEROO_TOKEN === 'NEW' || (args.name && process.env.DELIVEROO_TOKEN === undefined)
        ? ''
        : process.env.DELIVEROO_TOKEN ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjE2NjYyYSIsIm5hbWUiOiJhZ2VudDEiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4MzU4ODkwMX0.s3pshToHp7lWRKDflzpJhZtsQDflSPDmmz5ezb18q5E',

    // agent 2
    // token: process.env.DELIVEROO_TOKEN ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImQyZWNkZiIsIm5hbWUiOiJhZ2VudDIiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4MzU4ODkxOH0.SmmEIeYR87sXzAqFzwVJqAoEHxuV0-e2pG4DGGlcdAA',

    // Multi-agent (Part 2) team coordination.
    team: {
        // Coordination is active only when enabled AND a teammate is discovered.
        // When disabled the agent behaves exactly as the single-agent (Part 1).
        enabled: String(args.team ?? process.env.TEAM ?? '0') !== '0',
        // Shared secret both teammates use to recognise each other over the
        // (globally broadcast) Deliveroo message bus. Both agents must share it.
        secret: process.env.TEAM_SECRET ?? 'edoleo-team-secret',
    },
    // PDDL Planner configuration (Part 3)
    pddl: {
        enabled: String(args.pddl ?? process.env.PDDL ?? '0') !== '0',
        // Client-side cap on the online-solver round trip. The backend allows
        // up to 30s per solve — far too long for an agent to stand still.
        timeoutMs: parseInt(process.env.PDDL_TIMEOUT_MS ?? '5000', 10),
        // After this many consecutive transport failures (solver unreachable
        // or timed out) PDDL is disabled for the rest of the session, so
        // offline play doesn't eat a network timeout on every intention.
        maxConsecutiveFailures: parseInt(process.env.PDDL_MAX_FAILURES ?? '3', 10),
    }
}

export default config;