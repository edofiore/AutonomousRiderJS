import { default as argsParser } from "args-parser";

/**
 * Agent Runtime Configuration.
 *
 * Configuration is resolved hierarchically:
 * 1. Command-line arguments (e.g., `node src/autonomousRider.js -name=A1 -team=1 -pddl=0`)
 * 2. Environment variables (defined in process.env or loaded via .env)
 * 3. Default fallback values
 *
 * Command-line flags provide a cross-platform alternative to environment variables
 * on systems like Windows PowerShell/CMD.
 */
const args = argsParser(process.argv);

const config = {
    // Deliveroo server endpoint.
    // Common targets:
    // - Local server: "http://localhost:4001"
    // - Course server: "http://rtibdi.disi.unitn:8080"
    // - Cloud instances: "https://deliveroojs.onrender.com" or "https://deliveroojs25.azurewebsites.net/"
    host: process.env.DELIVEROO_HOST ?? "http://localhost:4001",

    // Identity resolution:
    // 1. DELIVEROO_TOKEN env variable — explicit JWT token takes precedence.
    //    The sentinel value 'NEW' forces a token-less connection (allowing the server
    //    to assign an identity, useful on Windows where empty env vars cannot easily be set).
    // 2. -name=<x> CLI argument — forces a token-less connection so the server mints
    //    a new identity named <x> (preventing multiple agents from reusing the same token).
    // 3. Default: empty string (server mints a fresh identity automatically).
    token: process.env.DELIVEROO_TOKEN === 'NEW' || (args.name && process.env.DELIVEROO_TOKEN === undefined)
        ? ''
        : process.env.DELIVEROO_TOKEN ?? '',

    // Multi-agent team coordination settings.
    team: {
        // Coordination is active only when enabled AND a teammate is discovered.
        // When disabled, the agent operates in autonomous single-agent mode.
        enabled: String(args.team ?? process.env.TEAM ?? '0') !== '0',

        // Shared secret used by teammates to authenticate each other over the
        // broadcast Deliveroo message bus. Both agents must share the same secret.
        secret: process.env.TEAM_SECRET ?? 'edoleo-team-secret',
    },

    // Online PDDL Planner configuration.
    pddl: {
        // Whether PDDL planning is enabled for multi-step parcel/delivery tasks.
        enabled: String(args.pddl ?? process.env.PDDL ?? '0') !== '0',

        // Maximum round-trip duration (in ms) allowed for online solver responses.
        timeoutMs: parseInt(process.env.PDDL_TIMEOUT_MS ?? '5000', 10),

        // Maximum consecutive solver transport or timeout failures before disabling
        // PDDL planning for the remainder of the session (falling back to Dijkstra).
        maxConsecutiveFailures: parseInt(process.env.PDDL_MAX_FAILURES ?? '3', 10),
    }
};

export default config;