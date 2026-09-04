import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import {default as config} from "./config.js"

/**
 * Deliveroo API Client Initialization
 */

// DeliverooApi's constructor overrides console.log to mirror logged lines
// back to the server over the socket (emitLog). To eliminate unnecessary
// socket write overhead on the execution path, capture the original console.log
// before construction and restore it immediately afterward.
const originalConsoleLog = console.log;

const client = new DeliverooApi(
    config.host,
    config.token
)

console.log = originalConsoleLog;

export {client};