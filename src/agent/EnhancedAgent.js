import { IntentionRevisionQueue, IntentionRevisionReplace, IntentionRevisionRevise, IntentionRevisionReviseEnhanced } from "./index.js";

class EnhancedAgent {

    constructor() {
        // Use the enhanced intention revision system
        this.intentionRevision = new IntentionRevisionReviseEnhanced();
        
        // Track agent performance metrics
        this.performanceMetrics = {
            successfulIntentions: 0,
            failedIntentions: 0,
            totalReplans: 0,
            totalMovements: 0,
            startTime: Date.now()
        };
    }

    async start() {
        console.log("Creating enhanced agent with improved replanning...");
        this.intentionRevision.loop();  // Start intentions loop
    }

    async push(predicate) {
        try {
            await this.intentionRevision.push(predicate);
        } catch (error) {
            console.log("Error pushing intention:", error);
            this.performanceMetrics.failedIntentions++;
        }
    }

    /**
     * Force replanning for all current intentions
     * Useful when environment changes significantly
     */
    async forceReplan() {
        console.log("Forcing replanning of all current intentions...");
        
        // Clear temporary blocked tiles to allow fresh pathfinding
        const beliefs = require("./beliefs/beliefs.js").beliefs;
        beliefs.tmpBlockedTiles = [];
        
        // Stop current intentions to trigger replanning
        for (const intention of this.intentionRevision.intention_queue) {
            if (intention && !intention.stopped) {
                await intention.stop();
            }
        }
        
        this.performanceMetrics.totalReplans++;
        console.log("Forced replanning completed");
    }

    /**
     * Get current performance metrics
     */
    getPerformanceMetrics() {
        const uptime = Date.now() - this.performanceMetrics.startTime;
        const successRate = this.performanceMetrics.successfulIntentions / 
                           (this.performanceMetrics.successfulIntentions + this.performanceMetrics.failedIntentions);
        
        return {
            ...this.performanceMetrics,
            uptime: uptime,
            successRate: successRate || 0,
            intentionsPerMinute: (this.performanceMetrics.successfulIntentions + this.performanceMetrics.failedIntentions) / (uptime / 60000)
        };
    }

    /**
     * Adaptive planning strategy based on environment conditions
     */
    async adaptPlanningStrategy() {
        const beliefs = require("./beliefs/beliefs.js").beliefs;
        
        // Count nearby agents
        const nearbyAgents = [];
        for (const agentGroup of beliefs.otherAgents?.values() || []) {
            for (const agent of agentGroup) {
                const distance = Math.abs(agent.x - beliefs.me.x) + Math.abs(agent.y - beliefs.me.y);
                if (distance <= 5) {
                    nearbyAgents.push(agent);
                }
            }
        }

        // Adjust strategy based on environment
        if (nearbyAgents.length > 3) {
            console.log("High agent density detected, switching to conservative planning");
            // Could implement more conservative pathfinding here
        } else if (beliefs.tmpBlockedTiles.length > 10) {
            console.log("Many blocked tiles detected, clearing old blocks and replanning");
            // Clear old blocked tiles
            const { clearOldBlockedTiles } = require("./planning/utilsPlanning.js");
            clearOldBlockedTiles();
        }
    }

    /**
     * Emergency stop and replanning
     */
    async emergencyReplan() {
        console.log("EMERGENCY REPLAN: Stopping all intentions and clearing blocked tiles");
        
        // Clear all blocked tiles
        const beliefs = require("./beliefs/beliefs.js").beliefs;
        beliefs.tmpBlockedTiles = [];
        
        // Stop all current intentions
        for (const intention of this.intentionRevision.intention_queue) {
            if (intention) {
                await intention.stop();
            }
        }
        
        // Clear intention queue
        this.intentionRevision.intention_queue = [];
        
        console.log("Emergency replan completed - agent ready for new intentions");
    }

    /**
     * Check if agent is stuck and needs intervention
     */
    isAgentStuck() {
        const beliefs = require("./beliefs/beliefs.js").beliefs;
        
        // Simple stuck detection: many blocked tiles and no successful movements recently
        if (beliefs.tmpBlockedTiles.length > 15) {
            return true;
        }
        
        // Check if agent hasn't moved in a while (would need position tracking)
        // This is a simplified version
        return false;
    }

    /**
     * Periodic maintenance and optimization
     */
    async performMaintenance() {
        console.log("Performing agent maintenance...");
        
        // Clean up old blocked tiles
        const { clearOldBlockedTiles } = require("./planning/utilsPlanning.js");
        clearOldBlockedTiles();
        
        // Adapt planning strategy
        await this.adaptPlanningStrategy();
        
        // Check if emergency replanning is needed
        if (this.isAgentStuck()) {
            await this.emergencyReplan();
        }
        
        // Log performance metrics
        const metrics = this.getPerformanceMetrics();
        console.log("Performance metrics:", metrics);
    }

    /**
     * Start periodic maintenance
     */
    startMaintenance() {
        // Run maintenance every 30 seconds
        setInterval(() => {
            this.performMaintenance().catch(error => {
                console.log("Maintenance error:", error);
            });
        }, 30000);
    }
}

// Export both the enhanced agent and original for compatibility
class Agent {
    constructor() {
        // Keep original implementation for compatibility
        this.intentionRevision = new IntentionRevisionRevise();
    }

    async start() {
        console.log("Creating new agent...");
        this.intentionRevision.loop();
    }

    async push(predicate) {
        await this.intentionRevision.push(predicate);
    }
}

export { Agent, EnhancedAgent };