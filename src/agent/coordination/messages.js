import { default as config } from "../../config/config.js";

/**
 * Message types exchanged between the two teammate agents (Part 2).
 */
const MSG = Object.freeze({
    HELLO:     'hello',      // presence announcement, used for discovery (broadcast)
    HELLO_ACK: 'hello_ack',  // directed reply so both sides learn each other's id
    PARCELS:   'parcels',    // share sensed free parcels (belief sharing)
    AGENTS:    'agents',     // share sensed opponents (belief sharing)
    CLAIM:     'claim',      // "I am committing to pick up this parcel"
    RELEASE:   'release',    // "I am no longer pursuing this parcel"
    ZONES:     'zones',      // leader broadcasts the evolved map partition
});

/**
 * How long a teammate claim stays valid before it is considered stale (ms).
 * Prevents a crashed/disconnected teammate from locking parcels forever, while
 * comfortably covering a single pickup execution.
 */
const CLAIM_TTL = 30000;

/**
 * Wrap a payload into a team envelope carrying the shared secret, so the
 * receiver can tell a teammate message apart from an opponent's (shouts are
 * broadcast to everyone on the server).
 * @param {string} type - one of MSG.*
 * @param {Object} payload
 * @returns {Object} envelope
 */
const buildMessage = (type, payload = {}) => ({
    secret: config.team.secret,
    type,
    payload,
    ts: Date.now(),
});

/**
 * Validate that an incoming message is a well-formed teammate message.
 * @param {*} msg
 * @returns {boolean}
 */
const isTeamMessage = (msg) =>
    !!msg &&
    typeof msg === 'object' &&
    msg.secret === config.team.secret &&
    typeof msg.type === 'string';

export { MSG, CLAIM_TTL, buildMessage, isTeamMessage };
