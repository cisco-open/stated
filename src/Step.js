
export default class Step {
    constructor(stepJson) {
        this.stepJson = stepJson;
    }

    async run(workflowInvocation, args) {
        const start = {
            timestamp: new Date().getTime(),
            args
        };

        let {log, function:fn} = this.stepJson; //the stepJson log is a map keyed by workflowInvocation
        log = this.initLog(log);

        try {
            const invocationLog= {start};
            log[workflowInvocation] = invocationLog;
            const out = await fn.apply(this, [args, {workflowInvocation}]);
            const end = {
                timestamp: new Date().getTime(),
                out
            };
            invocationLog['end'] = end;
            return out;
        } catch (error) {
            return error;
        }
    }

    initLog(log) {
        if (log === undefined) {
            log = {};
            this.stepJson.log = log; //init to empty log, no workflowInvocations in it
        }
        return log;
    }
}