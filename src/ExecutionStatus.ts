import TemplateProcessor, {Fork, MetaInfoMap, PlanStep, Snapshot} from "./TemplateProcessor.js";
import {NOOP_PLACEHOLDER, stringifyTemplateJSON, UNDEFINED_PLACEHOLDER} from './utils/stringify.js';
import {ExecutionPlan, SerializableExecutionPlan} from "./Planner.js";
import {SerialPlan} from "./SerialPlanner.js";
import {JsonPointerString, MetaInfo} from "./MetaInfoProducer.js";
import * as jsonata from "jsonata";
import {JsonPointer as jp} from "./index.js";

export class ExecutionStatus {
    public plans: Set<ExecutionPlan>;
    public metaInfoByJsonPointer: MetaInfoMap;
    public tp:TemplateProcessor;

    constructor(tp:TemplateProcessor) {
        this.plans = new Set<ExecutionPlan>();
        this.tp = tp;
        this.metaInfoByJsonPointer = tp.metaInfoByJsonPointer;
    }
    public begin(mutationPlan:ExecutionPlan) {
        this.plans.add(mutationPlan) //todo fixme - this whole class needs to be refactored to work with ExecutionPlan - it will only work now with Plan
    }

    public end(mutationPlan: ExecutionPlan) {
        this.plans.delete(mutationPlan);
    }

    public clear() {
        this.plans.clear();
    }

    public toJsonString():string{
        return stringifyTemplateJSON(this.toJsonObject());
    }

    public getForkMap():Map<string,Fork>{
        const outputsByForkId = new  Map<string, Fork>();
        Array.from(this.plans).forEach((mutationPlan)=>{
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
            plans: Array.from(this.plans).map(this.tp.planner.toJSON)
        };
        return JSON.parse(stringifyTemplateJSON(snapshot));
    }


    /**
     * Reconstructs execution status and template processor internal states form an execution status snapshot
     * @param tp TemplateProcess
     * @param snapshot Snapshot
     */
    public static getExecutionPlansFromSnapshot(tp:TemplateProcessor, snapshot: Snapshot): ExecutionPlan[] {
        const plans = [];
        //ExecutionStatus.jsonToMetaInfos(obj.metaInfoByJsonPointer);
        //tp.metaInfoByJsonPointer = snapshot.metaInfoByJsonPointer;
        //const executionStatus = new ExecutionStatus(tp);
        //tp.executionStatus = executionStatus; //fixme todo i don't like having these side effects inside this function

        /*
        tp.input = snapshot.template;
        tp.output = snapshot.output;
        */
        // Reconstruct Forks
        const forks = new Map<string, Fork>();
        snapshot.mvcc?.forEach((forkData: any) => {
            forks.set(forkData.forkId, forkData);
        });

        // Reconstruct Plans...this is mostly restoring the in-memory forkStack of individual ExecutionPlan from the normalized Snapshot
        return snapshot.plans?.map((planData: SerializableExecutionPlan) => {
            if (planData.data === NOOP_PLACEHOLDER) {
                planData.data = TemplateProcessor.NOOP;
            } else if (planData.data === UNDEFINED_PLACEHOLDER) {
                planData.data = undefined;
            }
            return tp.planner.fromJSON(planData, snapshot, forks);
            //executionStatus.begin(mutationPlan); //just adds teh mutationPlan to the 'plans' array inside the ExecutionStatus object
        });

        //todo HEY --- is this 'restore output' needed?

        // restore the output from root plan in-flight, or set it to the stored obj.output otherwise
        //tp.output = snapshot.output; //fixme todo - redundant with the first set
        ///return executionStatus;
    }

}

