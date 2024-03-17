import { JsonPointerString } from "./MetaInfoProducer.js";
import TemplateProcessor, {MutationPlan, Op, PlanStep, Fork} from "./TemplateProcessor.js";
import StatedREPL from "./StatedREPL.js";

type StoredOp = {forkId:string, jsonPtr:JsonPointerString, data:any, op:string};
export class ExecutionStatus {
    private statuses: Set<MutationPlan>;
    constructor() {
        this.statuses = new Set();
    }
    public begin(mutationPlan:MutationPlan) {
        this.statuses.add(mutationPlan)
    }

    public end(mutationPlan: MutationPlan) {
        this.statuses.delete(mutationPlan);
    }

    public clear() {
        this.statuses.clear();
    }

    public toJsonString():string{
        return StatedREPL.stringify(this.toJsonObject());
    }

    public toJsonObject():object{
        const outputsByForkId =new  Map<string, Fork>();
        Array.from(this.statuses).forEach((mutationPlan:MutationPlan)=>{
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
        return JSON.parse(StatedREPL.stringify(snapshot));
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

    private mutationPlanToJSON = (mutationPlan:MutationPlan):object => {
        const {forkId,forkStack,sortedJsonPtrs, lastCompletedStep, op, data, output} = mutationPlan;
        const json = {
            forkId,
            forkStack: forkStack.map(fork=>fork.forkId),
            sortedJsonPtrs,
            op,
            data

        };
        if(lastCompletedStep){
            json['lastCompletedStep'] = lastCompletedStep.jsonPtr; //all we need to record is jsonpointer of last completed step
        }
        return json;
    }


    public restore(tp:TemplateProcessor){
        this.statuses.forEach(mutationPlan=>{
           // (tp as InternalMethods).executePlan(mutationPlan);
        });
    }
}
