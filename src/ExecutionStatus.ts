import TemplateProcessor, {Fork, MetaInfoMap, PlanStep, Snapshot} from "./TemplateProcessor.js";
import {NOOP_PLACEHOLDER, stringifyTemplateJSON, UNDEFINED_PLACEHOLDER} from './utils/stringify.js';
import {ExecutionPlan, SerializableExecutionPlan} from "./Planner.js";
import {SerialPlan} from "./SerialPlanner.js";

export class ExecutionStatus {
    public statuses: Set<SerialPlan>;
    public metaInfoByJsonPointer: MetaInfoMap;
    public tp:TemplateProcessor;

    constructor(tp:TemplateProcessor) {
        this.statuses = new Set();
        this.tp = tp;
        this.metaInfoByJsonPointer = tp.metaInfoByJsonPointer;
    }
    public begin(mutationPlan:ExecutionPlan) {
        this.statuses.add(mutationPlan as SerialPlan) //todo fixme - this whole class needs to be refactored to work with ExecutionPlan - it will only work now with Plan
    }

    public end(mutationPlan: SerialPlan) {
        this.statuses.delete(mutationPlan);
    }

    public clear() {
        this.statuses.clear();
    }

    public toJsonString():string{
        return stringifyTemplateJSON(this.toJsonObject());
    }

    public getForkMap():Map<string,Fork>{
        const outputsByForkId = new  Map<string, Fork>();
        Array.from(this.statuses).forEach((mutationPlan)=>{
            const {forkId, output, forkStack}= mutationPlan;
            outputsByForkId.set(forkId, {forkId, output} as Fork);
            forkStack.forEach((fork:Fork)=>{
                outputsByForkId.set(fork.forkId, fork);
            });

        });
        return outputsByForkId;
    }

    public toJsonObject():Snapshot{

        const snapshot:Snapshot = {
            template: this.tp.input,
            output: this.tp.output,
            options: this.tp.options,
            mvcc:Array.from(this.getForkMap().values()),
            metaInfoByJsonPointer: this.metaInfoByJsonPointer,//this.metaInfosToJSON(this.metaInfoByJsonPointer),
            plans: Array.from(this.statuses).map(this.tp.planner.toJSON)
        };
        return JSON.parse(stringifyTemplateJSON(snapshot));
    }


    /**
     * Reconstructs execution status and template processor internal states form an execution status snapshot
     * @param tp TemplateProcess
     * @param snapshot Snapshot
     */
    public static createExecutionStatusFromJson(tp:TemplateProcessor, snapshot: Snapshot): ExecutionStatus {

        //ExecutionStatus.jsonToMetaInfos(obj.metaInfoByJsonPointer);
        tp.metaInfoByJsonPointer = snapshot.metaInfoByJsonPointer;
        const executionStatus = new ExecutionStatus(tp);
        tp.executionStatus = executionStatus;
        tp.input = snapshot.template;
        tp.output = snapshot.output;

        // Reconstruct Forks
        const forks = new Map<string, Fork>();
        snapshot.mvcc?.forEach((forkData: any) => {
            forks.set(forkData.forkId, forkData);
        });

        // Reconstruct Plans
        snapshot.plans?.forEach((planData: any) => {
            const forkStack = planData.forkStack.map((forkId: string) => forks.get(forkId));
            if (planData.data === NOOP_PLACEHOLDER) {
                planData.data = TemplateProcessor.NOOP;
            } else if (planData.data === UNDEFINED_PLACEHOLDER) {
                planData.data = undefined;
            }
            const mutationPlan: SerialPlan = {
                didUpdate: [],
                forkId: planData.forkId,
                forkStack,
                sortedJsonPtrs: planData.sortedJsonPtrs,
                restoreJsonPtrs: [],
                op: planData.op,
                data: planData.data,
                output: forks.get(planData.forkId)?.output || {}, // Assuming output needs to be set
                lastCompletedStep: planData.lastCompletedStep ? { jsonPtr: planData.lastCompletedStep } as PlanStep : undefined
            };
            executionStatus.begin(mutationPlan);
        });

        // restore the output from root plan in-flight, or set it to the stored obj.output otherwise
        tp.output = snapshot.output;
        return executionStatus;
    }

}

