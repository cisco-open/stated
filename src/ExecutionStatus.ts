import { JsonPointerString } from "./MetaInfoProducer.js";
import TemplateProcessor, {Plan, Op, PlanStep, Fork} from "./TemplateProcessor.js";
import { stringifyTemplateJSON } from './utils/stringify.js';

type StoredOp = {forkId:string, jsonPtr:JsonPointerString, data:any, op:string};
export class ExecutionStatus {
    private statuses: Set<Plan>;
    constructor() {
        this.statuses = new Set();
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
        const outputsByForkId =new  Map<string, Fork>();
        Array.from(this.statuses).forEach((mutationPlan:Plan)=>{
            const {forkId, output, forkStack}= mutationPlan;
            outputsByForkId.set(forkId, {forkId, output} as Fork);
            forkStack.forEach((fork:Fork)=>{
                outputsByForkId.set(fork.forkId, fork);
            });

        });
        const snapshot = {
            mvcc:Array.from(outputsByForkId.values()),
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

    private mutationPlanToJSON = (mutationPlan:Plan):object => {
        const {forkId,forkStack,sortedJsonPtrs, lastCompletedStep, op, data, output} = mutationPlan;
        const json = {
            forkId,
            forkStack: forkStack.map(fork=>fork.forkId),
            sortedJsonPtrs,
            op,
            data

        };
        if(lastCompletedStep){
            (json as any)['lastCompletedStep'] = lastCompletedStep.jsonPtr; //all we need to record is jsonpointer of last completed step
        }
        return json;
    }


    public restore(tp:TemplateProcessor){
        this.statuses.forEach(mutationPlan=>{
           // (tp as InternalMethods).executePlan(mutationPlan);
        });
    }
}
