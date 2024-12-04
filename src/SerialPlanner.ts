import {ExecutionPlan, Planner, SerializableExecutionPlan} from "./Planner.js";
import TemplateProcessor, {Op, PlanStep} from "./TemplateProcessor.js";
import {JsonPointerString, MetaInfo} from "./MetaInfoProducer.js";
import {JsonPointer as jp} from "./index.js";
import {ExecutionStatus} from "./ExecutionStatus.js";
import * as jsonata from "jsonata";
import {NOOP_PLACEHOLDER} from "./utils/stringify.js";


export interface SerialPlan extends ExecutionPlan{
    sortedJsonPtrs:JsonPointerString[],
    restoreJsonPtrs:JsonPointerString[], //this is dependencies (functions and intervals/timeouts) we need to initialize on restore from a snapshot before we can evaluate the plan
    didUpdate: boolean[] //peers with sortedJsonPointers, tells us which of those locations in output actually updated
}
/**
 export type Plan = {
 sortedJsonPtrs:JsonPointerString[],
 restoreJsonPtrs:JsonPointerString[], //this is dependencies (functions and intervals/timeouts) we need to initialize on restore from a snapshot before we can evaluate the plan
 didUpdate: boolean[] //peers with sortedJsonPointers, tells us which of those locations in output actually updated
 data?:any,
 op?:Op, //if present and op="set", the data is applied to first json pointer
 output:object,
 forkId:string,
 forkStack:Fork[] //allows us to have nested execution contexts that cen restored by popping this stack onto output
 lastCompletedStep?:PlanStep,
 };
 */

export class SerialPlanner implements Planner{
    private tp: TemplateProcessor;

    constructor(tp:TemplateProcessor) {
        this.tp = tp;
    }

    getInitializationPlan(jsonPointer:JsonPointerString): ExecutionPlan {
        const metaInfos = this.tp.metaInfoByJsonPointer[jsonPointer];
        return {
            op: "initialize",
            data: TemplateProcessor.NOOP,
            sortedJsonPtrs: this.topologicalSort(metaInfos, true) as JsonPointerString[],//we want the execution plan to only be a list of nodes containing expressions (expr=true),
            restoreJsonPtrs: [],
            output: this.tp.output,
            forkStack: [],
            forkId: "ROOT",
            didUpdate: [],
        } as ExecutionPlan;
    }

    async execute(plan:ExecutionPlan): Promise<void> {
        let shouldRunDependentExpressions = true;
        const {data} = plan;
        if (data !== TemplateProcessor.NOOP) { //this plan begins with setting data
            shouldRunDependentExpressions = await this.applyMutationToFirstJsonPointerOfPlan(plan);
        }
        // if the plan caused an initial mutation, then continue with the plan's transitive dependencies
        shouldRunDependentExpressions && await this.executeDependentExpressions(plan as SerialPlan);
        await this.tp.executeDataChangeCallbacks(plan as SerialPlan);
    }

    public async executeDependentExpressions(plan: SerialPlan) {
        this.tp.executionStatus.begin(plan);
        try {
            let {output, forkStack, forkId, didUpdate:updatesArray,sortedJsonPtrs: dependencies} = plan;
            const {lastCompletedStep} = plan; //this will tell us if we can skip ahead because some of the plan is already completed, which happens when restoring a persisted plan
            const startIndex = lastCompletedStep?dependencies.indexOf(lastCompletedStep.jsonPtr)+1:0
            for (let i = startIndex; i < dependencies.length; i++) {
                const jsonPtr = dependencies[i];
                const planStep:PlanStep = {jsonPtr, output, forkStack, forkId, didUpdate:false}; //pick up the output and forkStack from the prior step
                planStep.didUpdate = await this.tp.evaluateNode(planStep);
                plan.lastCompletedStep = planStep;
                output = planStep.output; // forked/joined will change the output so we have to record it to pass to next step
                updatesArray[i] = planStep.didUpdate;
            }
        }finally {
            this.tp.executionStatus.end(plan);
        }
    }


    topologicalSort(metaInfos:MetaInfo[], exprsOnly = true, fanout=true, extraOpts:{isFollowDependencies:boolean}={isFollowDependencies:true}):JsonPointerString[] {
        const visited = new Set();
        const recursionStack:Set<JsonPointerString> = new Set(); //for circular dependency detection
        const orderedJsonPointers:Set<string> = new Set();
        const templateMeta = this.tp.templateMeta;
        const {isFollowDependencies} = extraOpts;
        //--------------- utility sub-functions follow ----------------//

        const listDependencies = (metaInfo:MetaInfo) => {
            markAsVisited(metaInfo); //visited tells us 'globally' is a node has ever been visited
            //...however, we also need to track the traversal of dependencies that is 'local' to a single
            //originating node/expression. Circularity of references is limited to this "local" Scope. If we
            //detected circularity with the global 'visited' list, it would mean that circularity was somehow
            //a property of the entire template, which it is not. Circularity is a property of individual expression
            //fanouts, '.from' a given expression/node
            addToScope(metaInfo);

            isFollowDependencies && followDependencies(metaInfo);
            emit(metaInfo);
            followChildren(metaInfo);

            removeFromScope(metaInfo); //...and clear that 'local' scope now that we finished processing the node
        }

        const hasJsonPointer = (metaInfo:MetaInfo) => {
            return metaInfo.jsonPointer__ !== undefined;
        }

        const markAsVisited = (metaInfo:MetaInfo) => {
            visited.add(metaInfo.jsonPointer__);
        }

        const addToScope = (metaInfo:MetaInfo) => {
            recursionStack.add(metaInfo.jsonPointer__ as JsonPointerString);
        }

        const removeFromScope = (metaInfo:MetaInfo) => {
            recursionStack.delete(metaInfo.jsonPointer__ as JsonPointerString);
        }
        /**
         * Used to detect a condition where like "data:${data.foo}" which essentially declares a dependency on the
         * expression itself. This is inherently circular. You cannot say "use that thing in this expression, where
         * that thing is a product of evaluating this expression". You also cannot say "use that thing in this
         * expression where that thing is a direct ancestor of this expression" as that is also circular, implying that
         * the expression tries to reference an ancestor node, whose descendent includes this very node.
         * @param exprNode
         * @param dependency
         */
        const isCommonPrefix = (exprNode:JsonPointerString, dependency:JsonPointerString):boolean=>{
            return jp.isAncestor(dependency, exprNode);
        }

        //metaInfo gets arranged into a tree. The fields that end with "__" are part of the meta info about the
        //template. Fields that don't end in "__" are children of the given object in the template
        const followChildren = (metaInfoNode:any) => {
            for (const childKey in metaInfoNode) {
                if (!childKey.endsWith("__")) { //ignore metadata fields
                    const child = metaInfoNode[childKey];
                    if (!visited.has(child.jsonPointer__)) {
                        listDependencies(child);
                    }
                }
            }
        }

        const searchUpForExpression = (childNode:MetaInfo):MetaInfo|undefined=> {
            let pathParts = jp.parse(childNode.jsonPointer__ as JsonPointerString);
            /*
            const directParent = jp.compile(pathParts.slice(0, -1));
            //if a dependency of an expression is rooted in the expression itself, such as "data:${data.foo}" then this is a circular dependency
            if (visited.has(directParent) && (jp.get(this.templateMeta, directParent) as MetaInfo).expr__) {
                logCircularDependency(childNode.jsonPointer__ as JsonPointerString);
                return undefined;
            }

             */
            while (pathParts.length > 1) {
                pathParts = pathParts.slice(0, -1); //get the parent expression
                const jsonPtr = jp.compile(pathParts);
                const ancestorNode = jp.get(this.tp.templateMeta, jsonPtr) as MetaInfo;
                if (ancestorNode.materialized__ === true) {
                    return ancestorNode;
                }
            }
            return undefined;

        }

        const followDependencies = (metaInfo:MetaInfo) => {
            if (!metaInfo.absoluteDependencies__) return;

            for (const dependency of metaInfo.absoluteDependencies__) {

                if (recursionStack.has(dependency as JsonPointerString)
                    || isCommonPrefix(metaInfo.jsonPointer__ as JsonPointerString, dependency as JsonPointerString)) {
                    logCircularDependency(dependency as JsonPointerString);
                    continue; //do not follow circular dependencies
                }

                if (visited.has(dependency)) continue;
                const dependencyNode = jp.get(templateMeta, dependency) as MetaInfo;
                processUnmaterializedDependency(dependencyNode);
                listDependencies(dependencyNode);
            }
        }

        const logCircularDependency = (dependency:JsonPointerString) => {
            const e = '🔃 Circular dependency  ' + Array.from(recursionStack).join(' → ') + " → " + dependency;
            this.tp.warnings.push(e);
            this.tp.logger.log('warn', e);
        }

        const processUnmaterializedDependency = (dependencyNode:MetaInfo) => {
            if (!dependencyNode.materialized__) {
                const ancestor = searchUpForExpression(dependencyNode);
                if (ancestor) {
                    listDependencies(ancestor);
                }
            }
        }

        const emit = (metaInfo:MetaInfo) => {
            if (exprsOnly && !metaInfo.expr__) return;
            orderedJsonPointers.add(metaInfo.jsonPointer__ as JsonPointerString);
        }

        const removeExtraneous = (orderedJsonPointers:Set<string>):JsonPointerString[]=>{
            const desiredToRetain:Set<JsonPointerString> = new Set();
            metaInfos.forEach(m=>{
                desiredToRetain.add(m.jsonPointer__ as JsonPointerString);
            });
            return [...orderedJsonPointers].reduce((acc:JsonPointerString[], jsonPtr)=>{
                if(desiredToRetain.has(jsonPtr)){
                    acc.push(jsonPtr as JsonPointerString);
                }
                return acc;
            }, []);
        }
        //-------- end utility sub functions -------------//

        if (!(metaInfos instanceof Set || Array.isArray(metaInfos))) {
            metaInfos = [metaInfos];
        }
        // Perform topological sort
        metaInfos.forEach(node => {
            if (!visited.has(node.jsonPointer__)) {
                listDependencies(node);
            }
        });
        if(!fanout) {
            //when the input metaInfos has come via ".from()" then we are just trying to ensure that any
            //dependencies *within* that set of metaInfos gets topologically sorted. We don't want to fan
            //out to any other dependencies
            return removeExtraneous(orderedJsonPointers);
        }else{
            return [...orderedJsonPointers];
        }
    }

    public getDependeesBFS(jsonPtr:JsonPointerString, options: { maxDepth: number }={maxDepth:Number.MAX_SAFE_INTEGER}) : MetaInfo[] {


        const dependents:MetaInfo[] = [];
        const queue:JsonPointerString[] = [jsonPtr];
        const visited:Set<JsonPointerString> = new Set();
        const origin = jsonPtr;

        //----------------- utility functions ----------------//

        const isInterval = (metaInf:MetaInfo): boolean =>{
            const {data__} = metaInf;
            return data__ && this.tp.timerManager.isInterval(data__);
        }

        const isFunction = (jsonPointer:JsonPointerString)=>{

            if(!jp.has(this.tp.templateMeta, jsonPointer)){
                return false;
            }
            const metaInf = jp.get(this.tp.templateMeta, jsonPointer) as MetaInfo;
            //treat intervals same as immutable functions. Changes should not propagate through an interval causing
            //interval re-evaluation
            if(isInterval(metaInf)){
                return true;
            }
            return !!metaInf.isFunction__;
        }

        const queueParent = (jsonPtr:JsonPointerString)=>{
            //search "up" from this currentPtr to find any dependees of the ancestors of currentPtr
            const parentPointer = jp.parent(jsonPtr) as JsonPointerString;
            if (parentPointer !== '' && !visited.has(parentPointer)) {
                !isFunction(parentPointer) && queue.push(parentPointer);
                visited.add(parentPointer);
            }
        }

        const queueDependees = (metaInf: MetaInfo)=>{
            if (metaInf.dependees__) {
                metaInf.dependees__.forEach(dependee => {
                    if (!visited.has(dependee as JsonPointerString)) {
                        !isFunction(dependee as JsonPointerString) && queue.push(dependee as JsonPointerString);
                        visited.add(dependee as JsonPointerString);
                    }
                });
            }
        }

        const queueDescendents = (metaInf:MetaInfo, currentPtr:JsonPointerString)=>{
            // Recursively traverse into children nodes.
            for (let key in metaInf) {
                // Skip fields that end in "__" and non-object children
                if (key.endsWith('__') || typeof (metaInf as any)[key] !== 'object') {
                    continue;
                }
                // Generate json pointer for child
                let childPtr = `${currentPtr}/${key}`;
                if (!visited.has(childPtr)) {
                    !isFunction(childPtr) && queue.push(childPtr);
                    visited.add(childPtr);
                }
            }
        }
        //----------------- end utility functions ------------------------//
        //----------------- BFS Dependee Search Algorithm ----------------//
        while (queue.length > 0) {
            const currentPtr = queue.shift();
            queueParent(currentPtr as JsonPointerString); //these are IMPLICIT dependees
            //calling queueParent before the templateMeta existence check allows us to find ancestors of
            //a jsonPointer like '/rxLog/-'. Which means "last element of rxLog". queueParent() allows us to
            //pickup the /rxLog array as being an implicit dependency of its array elements. So if an element
            //is added or removed, we will recognize anyone who depends on /rxLog as a dependent
            //@ts-ignore
            if (!jp.has(this.tp.templateMeta, currentPtr)){
                continue;
            }
            //@ts-ignore
            const metaInf = jp.get(this.tp.templateMeta, currentPtr) as MetaInfo;
            if(metaInf.isFunction__){
                continue; //function never gets re-evaluated
            }
            if(currentPtr !== origin && metaInf.expr__ !== undefined){
                dependents.push(metaInf);
            }
            //maxDepth only affects direct dependencies all other indirect dependencies need to be pursued
            //to their full extent - things like walking up and down parent and descendent hierarchies are
            //independent of maxDepth
            if(options.maxDepth-- > 0) {
                queueDependees(metaInf); //these are EXPLICIT dependees
            }
            queueDescendents(metaInf, currentPtr as JsonPointerString); //these are IMPLICIT dependees
        }

        return dependents;
    }


    /**
     * Create an initialization plan from the execution plan, that intializes outputs that cannot be serialized and
     * deserialized from the snapshot, such as timers, and functions.
     * @param plan
     */
    private async createRestorePlan(plan:SerialPlan) {

        try {
            let intervals: MetaInfo[] = this.tp.metaInfoByJsonPointer["/"]?.filter(metaInfo => metaInfo.data__ === '--interval/timeout--');
            const expressions: MetaInfo[] = this.tp.metaInfoByJsonPointer["/"]?.filter(metaInfo => metaInfo.expr__ !== undefined);
            const functions: MetaInfo[] = this.tp.metaInfoByJsonPointer["/"]
                ?.filter(metaInfo => metaInfo.expr__ !== undefined)
                .filter(metaInfo => metaInfo.isFunction__ === true);
            expressions.forEach(metaInfo => {
                metaInfo.compiledExpr__ = jsonata.default(metaInfo.expr__ as string);
            });

            for (const expression of functions) {
                const jsonPtrStr = Array.isArray(expression.jsonPointer__) ? expression.jsonPointer__[0] as JsonPointerString: expression.jsonPointer__ as JsonPointerString;

                if (!plan.restoreJsonPtrs.includes(jsonPtrStr)) {
                    plan.restoreJsonPtrs.push(jsonPtrStr);
                }
            }
            functions.forEach(metaInfo => {
                jp.set(plan.output, metaInfo.jsonPointer__, metaInfo.compiledExpr__);
            })
            for (const expression of intervals) {
                const jsonPtrStr = Array.isArray(expression.jsonPointer__) ? expression.jsonPointer__[0] as JsonPointerString: expression.jsonPointer__ as JsonPointerString;
                if (!plan.restoreJsonPtrs.includes(jsonPtrStr)) {
                    plan.restoreJsonPtrs.push(jsonPtrStr);
                }
            }
            await this.evaluateRestorePlan(plan);
        } catch (error) {
            this.tp.logger.error("plan functions evaluation failed");
            throw error;
        }
    }

    /**
     * This method is used to compile and evaluate function expressions and their dependencies.
     *
     * Based on the metadata, we should identify all functions, and their dependencies
     * @param plan
     */
    public async evaluateRestorePlan(plan:SerialPlan) {
        try {
            let {output, forkStack, forkId, didUpdate:updatesArray,restoreJsonPtrs: dependencies} = plan;
            const {lastCompletedStep} = plan; //this will tell us if we can skip ahead because some of the plan is already completed, which happens when restoring a persisted plan
            const startIndex = lastCompletedStep?dependencies.indexOf(lastCompletedStep.jsonPtr)+1:0
            for (let i = startIndex; i < dependencies.length; i++) {
                const jsonPtr = dependencies[i];
                const planStep:PlanStep = {jsonPtr, output, forkStack, forkId, didUpdate:false}; //pick up the output and forkStack from the prior step
                planStep.didUpdate = await this.tp.evaluateNode(planStep);
                output = planStep.output; // forked/joined will change the output so we have to record it to pass to next step
            }
        } catch (e) {
            this.tp.logger.error(`failed to initialize restore plan, error=${e}`);
            throw e;
        }
    }

    public async applyMutationToFirstJsonPointerOfPlan(plan:ExecutionPlan):Promise<boolean> {
        const _plan:SerialPlan = plan as SerialPlan;
        if(_plan.lastCompletedStep){
            return _plan.lastCompletedStep?_plan.sortedJsonPtrs.indexOf(_plan.lastCompletedStep.jsonPtr)< _plan.sortedJsonPtrs.length:false
        }
        this.tp.executionStatus.begin(_plan);
        let theStep:PlanStep|undefined;
        try {
            const {sortedJsonPtrs} = _plan;
            const jsonPtr = sortedJsonPtrs[0];
            theStep = {jsonPtr, ..._plan, didUpdate:false}
            const didUpdate =  await this.tp.mutate(theStep);
            _plan.didUpdate.push(didUpdate);
            return didUpdate;
        }finally {
            if(theStep){
                _plan.lastCompletedStep = theStep;
            } //completed self
            this.tp.executionStatus.end(_plan)
        }
    }

    /**
     * Restores ExecutionStatuses, initialize plans and executes all plans in-flight
     * @param executionStatus
     */
    public async restore(executionStatus:ExecutionStatus): Promise<void> {
        // if we don't have any plans in flight, we need to reevaluate all functions/timeouts. We create a NOOP plan
        // and create initialization plan from it.
        let hasRootPlan = false;
        executionStatus.statuses.forEach((plan:ExecutionPlan) => {
            if(plan.forkId === "Root") {
                hasRootPlan = true;
            }});
        if (executionStatus.statuses?.size === 0 || !hasRootPlan) {
            // we need to add new root plan to the beginning of the set, so the functions/timers are reevaluated and can be used
            executionStatus.statuses = new Set([{
                sortedJsonPtrs: [],
                restoreJsonPtrs: [],
                data: TemplateProcessor.NOOP,
                output: this.tp.output,
                forkStack: [],
                forkId: "ROOT",
                didUpdate: []
            }, ...executionStatus.statuses]);
        }
        // restart all plans.
        for (const mutationPlan of executionStatus.statuses) {
            // we initialize all functions/timeouts for each plan
            await this.createRestorePlan(mutationPlan);
            //we don't await here. In fact, it is critical NOT to await here because the presence of multiple mutationPlan
            //means that there was concurrent ($forked) execution and we don't want to serialize what was intended to
            //run concurrently
            this.tp.executePlan(mutationPlan); // restart the restored plan asynchronously

        }
    }

    getMutationPlan(jsonPtr:JsonPointerString, data:any, op:Op): [SerialPlan, JsonPointerString[]] {
        const transitiveDependees = [...this.tp.from(jsonPtr)]; //defensive copy ...go through tp to hit tp's cache of from plans
        const plan:SerialPlan = {
            sortedJsonPtrs: transitiveDependees,
            restoreJsonPtrs: [],
            data,
            op,
            output:this.tp.output,
            forkStack:[],
            forkId:"ROOT",
            didUpdate:[]
        };
        return [plan, transitiveDependees]
    }

    from(jsonPtr:JsonPointerString) {
        const affectedNodesSet:MetaInfo[] = this.getDependeesBFS(jsonPtr);
        const topoSortedPlan = this.topologicalSort(affectedNodesSet, true, false) as JsonPointerString[];
        return [jsonPtr, ...topoSortedPlan]
    }

    mutationPlanToJSON(mutationPlan: ExecutionPlan): SerializableExecutionPlan {
        let {forkId,forkStack,sortedJsonPtrs, lastCompletedStep, op, data, output} = mutationPlan as SerialPlan;
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

}