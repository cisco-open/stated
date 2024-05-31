import {JsonPointerString, MetaInfo} from "./MetaInfoProducer.js";
import TemplateProcessor, {Plan, Op, PlanStep, Fork, MetaInfoMap} from "./TemplateProcessor.js";
import {NOOP_PLACEHOLDER, stringifyTemplateJSON, UNDEFINED_PLACEHOLDER} from './utils/stringify.js';
import StatedREPL from "./StatedREPL.js";

type StoredOp = {forkId:string, jsonPtr:JsonPointerString, data:any, op:string};
export class ExecutionStatus {
    public statuses: Set<Plan>;
    public metaInfoByJsonPointer: MetaInfoMap;

    constructor(metaInfoByJsonPointer: MetaInfoMap) {
        this.statuses = new Set();
        this.metaInfoByJsonPointer = metaInfoByJsonPointer;
    }
    public begin(mutationPlan:Plan) {
        this.statuses.add(mutationPlan)
    }

    public end(mutationPlan: Plan) {
        this.statuses.delete(mutationPlan);
    }

    public clear() {
        this.statuses.clear();
    }

    public toJsonString():string{
        return stringifyTemplateJSON(this.toJsonObject());
    }

    public toJsonObject():object{
        const outputsByForkId = new  Map<string, Fork>();
        Array.from(this.statuses).forEach((mutationPlan:Plan)=>{
            const {forkId, output, forkStack}= mutationPlan;
            outputsByForkId.set(forkId, {forkId, output} as Fork);
            forkStack.forEach((fork:Fork)=>{
                outputsByForkId.set(fork.forkId, fork);
            });

        });
        const snapshot = {
            mvcc:Array.from(outputsByForkId.values()),
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
    private mutationPlanToJSON = (mutationPlan:Plan):object => {
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


    public restore(tp:TemplateProcessor){
        this.statuses.forEach(mutationPlan=>{
            // run async
            tp.executePlan(mutationPlan);
        });
    }

    public static createExecutionStatusFromJson(json: string): ExecutionStatus {
        const obj = JSON.parse(json);

        const metaInfoByJsonPointer = ExecutionStatus.jsonToMetaInfos(obj.metaInfoByJsonPointer);

        const executionStatus = new ExecutionStatus(metaInfoByJsonPointer);

        // Reconstruct Forks
        const forks = new Map<string, Fork>();
        obj.mvcc.forEach((forkData: any) => {
            forks.set(forkData.forkId, forkData);
        });

        // Reconstruct Plans
        obj.plans.forEach((planData: any) => {
            const forkStack = planData.forkStack.map((forkId: string) => forks.get(forkId));
            if (planData.data === NOOP_PLACEHOLDER) {
                planData.data = TemplateProcessor.NOOP;
            } else if (planData.data === UNDEFINED_PLACEHOLDER) {
                planData.data = undefined;
            }
            const mutationPlan: Plan = {
                didUpdate: [],
                forkId: planData.forkId,
                forkStack,
                sortedJsonPtrs: planData.sortedJsonPtrs,
                op: planData.op,
                data: planData.data,
                output: forks.get(planData.forkId)?.output || {}, // Assuming output needs to be set
                lastCompletedStep: planData.lastCompletedStep ? { jsonPtr: planData.lastCompletedStep } as PlanStep : undefined
            };
            executionStatus.begin(mutationPlan);
        });

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

