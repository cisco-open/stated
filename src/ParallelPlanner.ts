import TemplateProcessor, {Fork, Op, PlanStep} from "./TemplateProcessor.js";
import {JsonPointerString, MetaInfo} from "./MetaInfoProducer.js";
import JsonPointer from "./JsonPointer.js";
import {ExecutionPlan, Planner, SerializableExecutionPlan} from "./Planner.js";
import {ExecutionStatus} from "./ExecutionStatus.js";
import {SerialPlan, SerialPlanner} from "./SerialPlanner.js";
import {dependencies} from "webpack";
import {promises} from "readline";
import {child} from "winston";


export interface ParallelExecutionPlan extends ExecutionPlan, PlanStep {
    parallel:ParallelExecutionPlan[] //this is the root node of the graph of ParallelPlanStep's
    completed: boolean
}

export class ParallelExecutionPlanDefault implements ParallelExecutionPlan{
    data: any;
    op: Op = "initialize";
    output: any;
    forkId: string = "ROOT";
    forkStack: Fork[] = [];
    parallel: ParallelExecutionPlan[];
    completed: boolean = false;
    jsonPtr: JsonPointerString = "/";
    didUpdate: boolean = false;

    constructor(tp:TemplateProcessor, parallelSteps:ParallelExecutionPlan[]=[], vals?:Partial<ParallelExecutionPlan> | null) {
        this.output = tp.output
        this.parallel = parallelSteps;
        // Copy properties from `vals` into `this`, while preserving existing defaults
        if(vals){
            Object.assign(this, vals);
        }
    }

    toJSON(): object {
        const json = {
            op: this.op,
            parallel: this.parallel.map(p=>(p as ParallelExecutionPlanDefault).toJSON()),
            completed: this.completed,
            jsonPtr: this.jsonPtr
        };
        if(this.data){
            (json as any).data = this.data;
        }
        return json;
    }


}
/*
type ParallelPlanStep = PlanStep & {
    parallel: ParallelPlanStep[];
    completed: boolean;
};

export class ParallelPlanStepDefault implements ParallelPlanStep{
    parallel: ParallelPlanStep[] = [];
    didUpdate: boolean = false;
    forkId: string = "ROOT";
    forkStack: Fork[] = [];
    jsonPtr: JsonPointerString = "/";
    output: object;
    completed: boolean = false;

    constructor(tp:TemplateProcessor, vals?:Partial<ParallelPlanStep> | null) {
        this.output = tp.output
        // Copy properties from `vals` into `this`, while preserving existing defaults
        if(vals){
            Object.assign(this, vals);
        }
    }

    toJSON(): object {
        return {
            jsonPtr: this.jsonPtr,
            parallel: this.parallel.map((dep:any) => dep.toJSON ? dep.toJSON() : dep),
            completed: this.completed
        };
    }


}
*/

export class ParallelPlanner implements Planner{
    private tp: TemplateProcessor;
    private nodeCache: Map<JsonPointerString, ParallelExecutionPlanDefault> = new Map();

    constructor(tp:TemplateProcessor) {
        this.tp = tp;
        tp.planner = this as Planner;
    }

    //remember, initialization plan is not always for "/" because we can be initializing an imported template
    getInitializationPlan(jsonPointer:JsonPointerString): ExecutionPlan {
         return this.makeInitializationPlan(jsonPointer);
    }

    getMutationPlan(jsonPtr:JsonPointerString, data:any, op:Op): [ExecutionPlan, JsonPointerString[]]{
        return this.makeMutationPlan(jsonPtr, data, op);
    }

    private makeInitializationPlan(jsonPtr:JsonPointerString):ParallelExecutionPlan {
        this.nodeCache.clear();
        const leaves: MetaInfo[] = this.getInitializationPlanEntryPoints(jsonPtr); //todo actually we should not even have to start with roots, can literally just throw in all the nodes
        const parallelStepsRoot = new ParallelExecutionPlanDefault(this.tp);
        for(const metaInfo of leaves){
            parallelStepsRoot.parallel.push(this.getDependenciesNode(metaInfo));
        }
        return parallelStepsRoot
    }

    private makeMutationPlan(jsonPtr:JsonPointerString, data:any, op:Op):[ParallelExecutionPlan, JsonPointerString[]] {
        if(this.tp.planner !== this){
            throw new Error(`Illegal attempt to accessed TemplateProcessor with uniqueId ${this.tp.uniqueId} from a Planner that wasn't the template processor's Planner` );
        }
        this.nodeCache.clear();
        const plan = this.getDependeesNode(this.tp.getMetaInfo(jsonPtr));
        plan.data = data;
        plan.op = op;
        const serializedFrom: JsonPointerString[] = this.tp.from(jsonPtr);
        return [plan,serializedFrom];
    }


    /**
     * Produces a list of expressions that have no dependencies and therefore is a root of the graph(s)
     * @private
     */
    private getInitializationPlanEntryPoints(jsonPtr:JsonPointerString):MetaInfo[]{
        const leaves: MetaInfo[] = [];
        const metaInfos = this.tp.metaInfoByJsonPointer[jsonPtr];
        metaInfos.forEach(metaInfo => {
            //collect entry points but skip the root which can be generated as an implicit parent dependency
            if(metaInfo.dependees__.length === 0 && metaInfo.expr__ !== undefined && !JsonPointer.rootish(metaInfo.jsonPointer__ as JsonPointerString) ){
                leaves.push(metaInfo); //has no dependencies, therefore is an entry point to the graph
            }
        })
        return leaves;
    }


    private getDependenciesNode(metaInfo: MetaInfo, options:{exprsOnly:boolean}={exprsOnly:true}):ParallelExecutionPlan {
        const {jsonPointer__:jsonPtr} = metaInfo;
        const {exprsOnly} = options;

        let visited = this.nodeCache.get(jsonPtr as JsonPointerString);
        if (visited){
            return visited;
        }
        const dependencies:JsonPointerString[] = this.immediateAndImplicitDependencies(metaInfo, {exprsOnly});

        const parallel = dependencies.map(ptr =>{
            return this.getDependenciesNode(this.tp.getMetaInfo(ptr), options)
        });

        visited = new ParallelExecutionPlanDefault(this.tp, parallel,{
            jsonPtr:jsonPtr as JsonPointerString,
            op:"initialize"
        })
        this.nodeCache.set(jsonPtr as JsonPointerString, visited)

        return visited;
    }

    private getDependeesNode(metaInfo:MetaInfo):ParallelExecutionPlan{
        const {jsonPointer__:jsonPtr} = metaInfo;
        let visited = this.nodeCache.get(jsonPtr as JsonPointerString);
        if(visited){
            return visited;
        }
        const serialPlanner = new SerialPlanner(this.tp);
        const dependees:MetaInfo[] = serialPlanner.getDependeesBFS(jsonPtr as JsonPointerString, {maxDepth:1});
        const parallel = dependees.map(m =>this.getDependeesNode(m));
        visited = new ParallelExecutionPlanDefault(this.tp, parallel,{
            jsonPtr:jsonPtr as JsonPointerString,
            op:"eval"
        })
        this.nodeCache.set(jsonPtr as JsonPointerString, visited)



        return visited;

    }


    async execute(plan: ExecutionPlan): Promise<void>{

        //we create a map of Promises. This is very important as two or more ParallelPlanSteps can have dependency
        //on the same node (by jsonPtr). These must await on the same Promise. For any jsonPtr, there must be only
        //one Promise that all the dependees wait on
        const promises =new Map<JsonPointerString, Promise<void>>();

        /**
         * define a local recursive function that has access to the map of promises and awaits the completion
         * of all its dependencies in parallel
         * @param step
         */
        const _execute = async (step:ParallelExecutionPlan, preOrPostOrder:"pre"|"post"): Promise<void>=> {
            const {jsonPtr} = step;
            let promise = promises.get(jsonPtr);

            if (promise) {
                return promise; // Return the existing promise
            }
            //if we got here then this is the one place where we execute this step
            // Execute all dependencies first, then resolve this node
            if(preOrPostOrder === "post") {
                await Promise.all(step.parallel.map((d) => _execute(d, preOrPostOrder)));
                await this.evaluateStep(step);
            }else{
                await this.evaluateStep(step);
                await Promise.all(step.parallel.map((d) => _execute(d, preOrPostOrder)));
            }
            step.completed = true;


        }
        const ordering = plan.op==="initialize"?"post":"pre";
        await _execute(plan as ParallelExecutionPlan, ordering);
        (plan as ParallelExecutionPlan).completed = true;

    }

    private async evaluateStep(step:ParallelExecutionPlan): Promise<void> {
        await this.tp.evaluateNode(step);
    }


    immediateAndImplicitDependencies(metaInfo:MetaInfo, options:{exprsOnly:boolean}={exprsOnly:true}):JsonPointerString[] {
        const visited = new Set();
        const recursionStack:Set<JsonPointerString> = new Set(); //for circular dependency detection
        const orderedJsonPointers:Set<string> = new Set();
        const templateMeta = this.tp.templateMeta;
        const {exprsOnly} = options

        //--------------- utility sub-functions follow ----------------//

        const impliedDependencies = (metaInfo:MetaInfo) => {
            markAsVisited(metaInfo); //visited tells us 'globally' is a node has ever been visited
            //...however, we also need to track the traversal of dependencies that is 'local' to a single
            //originating node/expression. Circularity of references is limited to this "local" Scope. If we
            //detected circularity with the global 'visited' list, it would mean that circularity was somehow
            //a property of the entire template, which it is not. Circularity is a property of individual expression
            //fanouts, '.from' a given expression/node
            addToScope(metaInfo);
            processUnmaterializedDependency(metaInfo);
            emit(metaInfo);
            followChildren(metaInfo);

            removeFromScope(metaInfo); //...and clear that 'local' scope now that we finished processing the node
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
            return JsonPointer.isAncestor(dependency, exprNode);
        }

        //metaInfo gets arranged into a tree. The fields that end with "__" are part of the meta info about the
        //template. Fields that don't end in "__" are children of the given object in the template
        const followChildren = (metaInfoNode:any) => {
            for (const childKey in metaInfoNode) {
                if (!childKey.endsWith("__")) { //ignore metadata fields
                    const child = metaInfoNode[childKey];
                    if (!visited.has(child.jsonPointer__)) {
                        impliedDependencies(child);
                    }
                }
            }
        }

        const searchUpForExpression = (childNode:MetaInfo):MetaInfo|undefined=> {
            let pathParts = JsonPointer.parse(childNode.jsonPointer__ as JsonPointerString);
            /*
            const directParent = JsonPointer.compile(pathParts.slice(0, -1));
            //if a dependency of an expression is rooted in the expression itself, such as "data:${data.foo}" then this is a circular dependency
            if (visited.has(directParent) && (JsonPointer.get(this.templateMeta, directParent) as MetaInfo).expr__) {
                logCircularDependency(childNode.jsonPointer__ as JsonPointerString);
                return undefined;
            }

             */
            while (pathParts.length > 1) {
                pathParts = pathParts.slice(0, -1); //get the parent expression
                const jsonPtr = JsonPointer.compile(pathParts);
                const ancestorNode = JsonPointer.get(this.tp.templateMeta, jsonPtr) as MetaInfo;
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
                const dependencyNode = JsonPointer.get(templateMeta, dependency) as MetaInfo;
                processUnmaterializedDependency(dependencyNode);
                impliedDependencies(dependencyNode);
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
                    impliedDependencies(ancestor);
                }
            }
        }

        const emit = (metaInfo:MetaInfo) => {
            if (exprsOnly && !metaInfo.expr__) return;
            orderedJsonPointers.add(metaInfo.jsonPointer__ as JsonPointerString);
        }


        //-------- end utility sub functions -------------//


        for(const dependency of metaInfo.absoluteDependencies__) {
            const depMeta:MetaInfo = JsonPointer.get(this.tp.templateMeta, dependency) as MetaInfo;
            emit(depMeta);
            if (!visited.has(depMeta.jsonPointer__)) {
                impliedDependencies(depMeta);
            }
        }

        return [...orderedJsonPointers];

    }

    restore(executionStatus: ExecutionStatus): Promise<void> {
        throw new Error("ParallelPlanner doesn't implement restore yet");
    }


    from(jsonPtr: JsonPointerString): JsonPointerString[] {
        return new SerialPlanner(this.tp).from(jsonPtr); //from is not
    }

    mutationPlanToJSON(mutationPlan: ExecutionPlan): SerializableExecutionPlan {
        throw new Error("not implemented");
    }



}




