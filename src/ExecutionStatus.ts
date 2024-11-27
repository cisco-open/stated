import {MetaInfo} from "./MetaInfoProducer.js";
import TemplateProcessor, {Fork, MetaInfoMap, PlanStep} from "./TemplateProcessor.js";
import {NOOP_PLACEHOLDER, stringifyTemplateJSON, UNDEFINED_PLACEHOLDER} from './utils/stringify.js';
import {ExecutionPlan} from "./Planner.js";
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

    public toJsonObject():object{

        const snapshot = {
            template: this.tp.input,
            output: this.tp.output,
            options: this.tp.options,
            mvcc:Array.from(this.getForkMap().values()),
            metaInfoByJsonPointer: this.metaInfosToJSON(this.metaInfoByJsonPointer),
            plans: Array.from(this.statuses).map(this.mutationPlanToJSON)
        };
        return JSON.parse(stringifyTemplateJSON(snapshot));
    }

    private planStepToJSON = (planStep:PlanStep):object => {
        const {forkId,forkStack,jsonPtr, op, data, output} = planStep;
        return {
            forkId,
            forkStack: forkStack.map(fork=>forkId),
            jsonPtr,
            data,
            op
        };
    }

    private metaInfosToJSON = (metaInfoByJsonPointer: MetaInfoMap): object => {
        const json: any = {};
        for (const jsonPtr in metaInfoByJsonPointer) {
            if (metaInfoByJsonPointer.hasOwnProperty(jsonPtr)) {
                json[jsonPtr] = metaInfoByJsonPointer[jsonPtr].map((metaInfo: MetaInfo) => {
                    return {
                        ...metaInfo,
                        tags__: Array.from(metaInfo.tags__)
                    };
                });
            }
        }
        return json;
    }
    private mutationPlanToJSON = (mutationPlan:SerialPlan):object => {
        let {forkId,forkStack,sortedJsonPtrs, lastCompletedStep, op, data, output} = mutationPlan;
        const json = {
            forkId,
            forkStack: forkStack.map(fork=>fork.forkId),
            sortedJsonPtrs,
            op,
            data
        };
        if (json.data === TemplateProcessor.NOOP) {
            json.data = NOOP_PLACEHOLDER;
        }
        if(lastCompletedStep){
            (json as any)['lastCompletedStep'] = lastCompletedStep.jsonPtr; //all we need to record is jsonpointer of last completed step
        }
        return json;
    }

    /**
     * Restores ExecutionStatuses, initialize plans and executes all plans in-flight
     * @param tp TemplateProcessor
     */
    /*
    public async restore(tp:TemplateProcessor): Promise<void> {
        // if we don't have any plans in flight, we need to reevaluate all functions/timeouts. We create a NOOP plan
        // and create initialization plan from it.
        let hasRootPlan = false;
        this.statuses.forEach((plan:ExecutionPlan) => {
            if(plan.forkId === "Root") {
                hasRootPlan = true;
            }});
        if (this.statuses?.size === 0 || !hasRootPlan) {
            // we need to add new root plan to the beginning of the set, so the functions/timers are reevaluated and can be used
            this.statuses = new Set([{
                sortedJsonPtrs: [],
                restoreJsonPtrs: [],
                data: TemplateProcessor.NOOP,
                output: tp.output,
                forkStack: [],
                forkId: "ROOT",
                didUpdate: []
            }, ...this.statuses]);
        }
        // restart all plans.
        for (const mutationPlan of this.statuses) {
            // we initialize all functions/timeouts for each plan
            await tp.createRestorePlan(mutationPlan);
            //we don't await here. In fact, it is critical NOT to await here because the presence of multiple mutationPlan
            //means that there was concurrent ($forked) execution and we don't want to serialize what was intended to
            //run concurrently
            tp.executePlan(mutationPlan).catch(error => {
                console.error(`Error executing plan for mutation: ${this.mutationPlanToJSON(mutationPlan)}`, error);
            }); // restart the restored plan asynchronously

        }
    }

     */

    /**
     * Reconstructs execution status and template processor internal states form an execution status snapshot
     * @param tp TemplateProcess
     * @param json
     */
    public static createExecutionStatusFromJson(tp:TemplateProcessor, obj: any): ExecutionStatus {

        const metaInfoByJsonPointer = ExecutionStatus.jsonToMetaInfos(obj.metaInfoByJsonPointer);
        tp.metaInfoByJsonPointer = metaInfoByJsonPointer;
        const executionStatus = new ExecutionStatus(tp);
        tp.executionStatus = executionStatus;
        tp.input = obj.template;
        tp.output = obj.output;

        // Reconstruct Forks
        const forks = new Map<string, Fork>();
        obj.mvcc?.forEach((forkData: any) => {
            forks.set(forkData.forkId, forkData);
        });

        // Reconstruct Plans
        obj.plans?.forEach((planData: any) => {
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
        tp.output = obj.output;
        return executionStatus;
    }

    private static jsonToMetaInfos(json: any): MetaInfoMap {
        const metaInfoMap: MetaInfoMap = {};
        for (const jsonPtr in json) {
            if (json.hasOwnProperty(jsonPtr)) {
                metaInfoMap[jsonPtr] = json[jsonPtr].map((metaInfo: any) => {
                    return {
                        ...metaInfo,
                        tags__: new Set(metaInfo.tags__)
                    };
                });
            }
        }
        return metaInfoMap;
    }
}

