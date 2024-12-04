import {Fork, ForkId, Op, PlanStep} from "./TemplateProcessor.js";
import {JsonPointerString, MetaInfo} from "./MetaInfoProducer.js";
import { ExecutionStatus } from "./ExecutionStatus.js";
import {SerialPlan} from "./SerialPlanner.js";

/**
 * Interface representing a Planner responsible for generating and executing
 * initialization and mutation plans for templates in a TemplateProcessor.
 */
export interface Planner {
    /**
     * Generates an initialization plan for the specified JSON pointer.
     *
     * This method is typically queued by the TemplateProcessor during initialization.
     * While the `jsonPointer` is often `/` (the root), it may point to a specific
     * location in the template when `$import` is called to initialize an imported template.
     *
     * @param jsonPointer - The JSON pointer indicating the location for initialization.
     * @returns The generated ExecutionPlan for initialization.
     */
    getInitializationPlan(jsonPointer: JsonPointerString): ExecutionPlan;

    /**
     * Generates a mutation plan for the specified JSON pointer and operation.
     *
     * This method creates a plan responsible for performing mutations on the
     * template. Supported operations include `initialize`, `set`, `delete`,
     * and `forceSetInternal`.
     *
     * @param jsonPtr
     * @param data
     * @param op - The operation to perform. Supported values: `"initialize"`, `"set"`,
     * `"delete"`, `"forceSetInternal"`.
     * @returns [ExecutionPlan, JsonPointerString[]] The generated ExecutionPlan for the mutation and an array telling
     * which expressions must be transitively re-evaluated as a result of the mutation.
     * @see Op
     */
    getMutationPlan(jsonPtr:JsonPointerString, data:any, op:Op): [ExecutionPlan, JsonPointerString[]];

    /**
     * Executes the specified execution plan.
     *
     * This method runs any plan that the Planner has generated, applying its operations
     * to the template or its components.
     *
     * @param plan - The execution plan to execute.
     * @returns A promise that resolves once execution is complete.
     */
    execute(plan: ExecutionPlan): Promise<void>;

    /**
     * Restores a TemplateProcessor to the state recorded in an ExecutionStatus object
     * and resumes execution.
     *
     * This method allows for resuming interrupted or paused execution by restoring
     * the previous state from the `ExecutionStatus` object.
     *
     * @param executionStatus - The execution status containing the state to restore.
     * @returns A promise that resolves once restoration and resumption are complete.
     */
    restore(executionStatus: ExecutionStatus): Promise<void>;

    /**
     * Returns a 'total ordering' of the dependency graph. A single array of JSON pointers
     * is returned. From always uses the SerialPlanner therefore the returned array of json
     * pointers should only be literally interpreted as the execution plan order when you
     * are using a SerialPlanner. However, the point of from() is to give users of the command
     * line a concise report on which parts of the output the dag will propagate to. In other words,
     * the 'effects' that flow downstream from a mutation applied to jsonPtr
     * @param jsonPtr
     * @returns JsonPointerString[]
     */
    from(jsonPtr:JsonPointerString):JsonPointerString[];

    mutationPlanToJSON (mutationPlan:ExecutionPlan):SerializableExecutionPlan;

}

/**
 * Represents an execution plan that defines the steps and operations
 * for initializing, mutating, or restoring a template's state.
 */
export interface ExecutionPlan {
    /**
     * Plans can be serialized and stored therefor we need to know what type of ExecutionPlan
     * this is. Defaults to "serial" if not present. Allowed values "serial|parallel"
     */
    type?: "serial|parallel"
    /**
     * The operation to perform. If present and `op` is `"set"`, the data is applied
     * to the first JSON pointer.
     */
    op?: Op;

    /**
     * The data associated with the plan. May be undefined for initialization plans.
     */
    data?: any;

    /**
     * The output object associated with the execution plan.
     */
    output: object;

    /**
     * The identifier for the fork associated with this execution plan. Will be "ROOT" when the plan is not
     * executing a fork
     */
    forkId: ForkId;

    /**
     * The stack of forks involved in this execution plan. Forks will push and pop on top of the ROOT fork
     * corresponding to entering a $forked() and exiting a forked plan on $joined()
     */
    forkStack: Fork[];

    /**
     * The last completed step in the execution plan, if any.
     */
    lastCompletedStep?: PlanStep; //todo this should only be in the serial plan
}

/**
 * A variation of `ExecutionPlan` designed for serialization, where the `forkStack`
 * contains only `ForkId` values instead of full `Fork` objects, and the `output`
 * property is omitted entirely. This design minimizes redundancy and reduces
 * the size of Snapshot objects, making them more efficient to store and transmit.
 *
 * The reason for this is that `Fork` contains `{forkId, output}`, and we don't want
 * to repeat large output objects in a Snapshot when various `forkStack` arrays
 * can reference the same output object. The Snapshot uniques output objects in
 * its `mvcc` field, and `forkId` can be used as a key to retrieve the corresponding
 * output for the original `Fork`, thereby avoiding repeated output objects in the
 * `forkStack`.
 *
 * This type is derived from `ExecutionPlan` by omitting the `forkStack` and `output`
 * properties and replacing `forkStack` with a simplified version.
 *
 * @see ExecutionPlan
 */
export type SerializableExecutionPlan = Omit<ExecutionPlan, "forkStack" | "output"> & {
    /**
     * The stack of fork identifiers associated with this execution plan.
     * Simplified to contain only `ForkId` values instead of full `Fork` objects
     * to make Snapshot objects much smaller in some cases.
     */
    forkStack: ForkId[]; //redefines forkStack to be just a stack of ids
};



