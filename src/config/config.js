const config = {
    host: process.env.DELIVEROO_HOST ?? "http://localhost:4001",
    // host: "https://deliveroojs.onrender.com",
    // host: "http://rtibdi.disi.unitn:8080",
    // host: "https://deliveroojs25.azurewebsites.net/?name=edo",
    // host: "https://deliveroojs25.azurewebsites.net/",
    // host: "https://deliveroojs.azurewebsites.net/",

    // agent 1
    token: process.env.DELIVEROO_TOKEN ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjE2NjYyYSIsIm5hbWUiOiJhZ2VudDEiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4MzU4ODkwMX0.s3pshToHp7lWRKDflzpJhZtsQDflSPDmmz5ezb18q5E',

    // agent 2
    // token: process.env.DELIVEROO_TOKEN ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImQyZWNkZiIsIm5hbWUiOiJhZ2VudDIiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4MzU4ODkxOH0.SmmEIeYR87sXzAqFzwVJqAoEHxuV0-e2pG4DGGlcdAA',

    // Multi-agent (Part 2) team coordination.
    team: {
        // Coordination is active only when enabled AND a teammate is discovered.
        // When disabled the agent behaves exactly as the single-agent (Part 1).
        enabled: (process.env.TEAM ?? '0') !== '0',
        // Shared secret both teammates use to recognise each other over the
        // (globally broadcast) Deliveroo message bus. Both agents must share it.
        secret: process.env.TEAM_SECRET ?? 'edoleo-team-secret',
    },
    // PDDL Planner configuration (Part 3)
    pddl: {
        enabled: (process.env.PDDL ?? '1') !== '0',
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