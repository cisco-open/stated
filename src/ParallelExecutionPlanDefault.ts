import { Op, Fork } from "./index.js";
import { JsonPointerString } from "./MetaInfoProducer.js";
import { ParallelExecutionPlan } from "./ParallelExecutionPlan.js";
import { SerializableExecutionPlan } from "./Planner.js";
import TemplateProcessor from "./TemplateProcessor.js";


export class ParallelExecutionPlanDefault implements ParallelExecutionPlan {
    data: any;
    op: Op = "initialize";
    output: any;
    forkId: string = "ROOT";
    forkStack: Fork[] = [];
    parallel: ParallelExecutionPlan[];
    completed: boolean = false;
    jsonPtr: JsonPointerString = "/";
    didUpdate: boolean = false;
    restore?: boolean = false;
    circular?:boolean;

    constructor(tp: TemplateProcessor, parallelSteps: ParallelExecutionPlan[] = [], vals?: Partial<ParallelExecutionPlan> | null) {
        this.output = tp.output;
        this.parallel = parallelSteps;
        // Copy properties from `vals` into `this`, while preserving existing defaults
        if (vals) {
            Object.assign(this, vals);
        }
    }

    private static _toJSON(p: ParallelExecutionPlanDefault): SerializableExecutionPlan {
        const json = {
            op: p.op,
            parallel: p.parallel.map(p => ParallelExecutionPlanDefault._toJSON(p as any)),
            completed: p.completed,
            jsonPtr: p.jsonPtr,
            forkStack: p.forkStack.map(fork => fork.forkId),
            forkId: p.forkId,
            didUpdate: p.didUpdate,
        };
        if (p.data) {
            (json as any).data = p.data;
        }
        if(p.circular){
            (json as any).circular = p.circular
        }
        return json;
    }

    toJSON(): SerializableExecutionPlan {
        return ParallelExecutionPlanDefault._toJSON(this);
    }

    cleanCopy(tp: TemplateProcessor, source: ParallelExecutionPlanDefault = this): ParallelExecutionPlanDefault {
        const fields:any = {
            op: source.op,
            parallel: source.parallel.map(p => source.cleanCopy(tp, p as any)),
            completed: false,
            jsonPtr: source.jsonPtr,
            forkStack: [],
            forkId: "ROOT",
            didUpdate: false,
            data: source.data
        };
        if(source.circular){
            fields.circular = source.circular;
        }
        return new ParallelExecutionPlanDefault(tp, [], fields);
    }

    getNodeList(all: boolean = false): JsonPointerString[] {
        const nodeSet: Set<JsonPointerString> = new Set();

        // Generic tree-walking function
        const walkTree = (node: ParallelExecutionPlan) => {
            const { jsonPtr, didUpdate } = node;
            if (jsonPtr !== "/") {
                if (all) {
                    nodeSet.add(jsonPtr); // Use Set to ensure uniqueness
                } else {
                    didUpdate && nodeSet.add(jsonPtr); // Use Set to ensure uniqueness
                }
            }
            // Traverse child nodes in the parallel array
            node.parallel.forEach(child => walkTree(child as ParallelExecutionPlanDefault));
        };

        // Start walking from the current instance
        walkTree(this);

        // Convert Set to array before returning
        return Array.from(nodeSet);
    }

    /**
     * make a shell of an ExecutionPlan that exist just to carry the jsonPtr, with op set to "noop"
     */
    getPointer(tp: TemplateProcessor): ParallelExecutionPlan {
        const ptrNode = new ParallelExecutionPlanDefault(tp, [], {
            ...this,
            op: "noop",
            completed: true, //since we never execute noop, we can always treat them as completed
            parallel: [] //pointer nodes are always pointers to nodes that have been, or are being processed, therefore a pointer node can behave as if it has no dependencies
        });
        //delete or null out as many fields as possible
        delete (ptrNode.data);
        delete (ptrNode.output);
        ptrNode.output = null;
        return ptrNode;
    }

}
export type MutationParamsType = {
    mutationPlan: ParallelExecutionPlan;
    mutationTarget: string;
    op: Op;
    data?: any;
};
type NodeTraversalOptions = { preOrPost: "preorder" | "postorder"; };

export function isMutation(op: Op) {
    return ["set", "forceSetInternal", "delete"].includes(op);
}
