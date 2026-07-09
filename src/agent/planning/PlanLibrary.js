import { BlindMove, GoDeliver, GoPickUp, PddlPlan } from "./index.js";

/**
 * Plan Library
 */
export const planLibrary = [];

// plan classes are added to plan library
planLibrary.push( PddlPlan );
planLibrary.push( GoPickUp );
planLibrary.push( BlindMove );
planLibrary.push( GoDeliver );