import { PlanStep } from "./index.js";
import { JsonPointerString } from "./MetaInfoProducer.js";
import { ExecutionPlan } from "./Planner.js";

/**
 * Represents a parallel execution plan that can be executed concurrently.
 * This interface extends both ExecutionPlan and PlanStep to provide functionality
 * for parallel processing of template operations.
 */

export interface ParallelExecutionPlan extends ExecutionPlan, PlanStep {
    /**
     * An array of child ParallelExecutionPlan nodes that can be executed in parallel.
     * This forms the root node of a directed acyclic graph (DAG) of ParallelPlanStep's.
     */
    parallel: ParallelExecutionPlan[];

    /**
     * Indicates whether the entire execution subtree rooted at this node has finished processing.
     * When true, all child nodes in the parallel array have also completed their execution.
     */
    completed: boolean;

    /**
     * A JSON Pointer string that identifies the location in the template being processed.
     * This pointer is used to track and reference specific nodes in the template structure.
     */
    jsonPtr: JsonPointerString;

    /**
     * Optional flag used to mark plans that are being used during a restore operation.
     * When true, indicates that this plan is part of restoring a previous template state.
     */
    restore?: boolean;
}
