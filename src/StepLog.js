
export class StepLog{
    constructor(stepJson){
        this.step = stepJson;
        const {log} = this.step;
        if(log === undefined){
            this.step.log = {};
        }
    }

    getInvocations(){
        const {log} = this.step;
        return Object.keys(log);
    }

    getCourseOfAction(invocationId){
        const {log} = this.step;
        const invocationLog = log[invocationId];
        if(invocationLog===undefined){
            return {"instruction":"START"};
        }
        const {start, end} = invocationLog;

        if(start !== undefined && end !== undefined){
            return {"instruction":"SKIP", event: end};
        }
        if(start !== undefined && end === undefined){
            return {"instruction":"RESTART", event: start};
        }
        if(start === undefined && end !== undefined){
            const {workflowInvocation, stepName} = this.step;
            throw new Error(`Invalid log ('end' present without 'start') for workflowInvocation=${workflowInvocation}, stepName=${stepName}.`);
        }

    }

}
