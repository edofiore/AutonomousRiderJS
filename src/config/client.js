import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import {default as config} from "./config.js"

/**
 * API
 */

// DeliverooApi's constructor overrides console.log to mirror EVERY logged
// line back to the server over the socket (emitLog). The server discards
// them (BROADCAST_LOGS=false) and our agents log thousands of lines per
// minute, so that's a pure socket-write tax on the hot path. Capture the
// original before construction and restore it right after.
const originalConsoleLog = console.log;

const client = new DeliverooApi(
    config.host,
    config.token
)

console.log = originalConsoleLog;

export {client};