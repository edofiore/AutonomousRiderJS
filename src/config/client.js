import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import {default as config} from "./config.js"

/**
 * API
 */

const client = new DeliverooApi(
    config.host,
    config.token
)

export {client};