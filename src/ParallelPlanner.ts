import TemplateProcessor, {Fork, Op, PlanStep, Snapshot} from "./TemplateProcessor.js";
import {JsonPointerString, MetaInfo} from "./MetaInfoProducer.js";
import JsonPointer from "./JsonPointer.js";
import {ExecutionPlan, Planner, SerializableExecutionPlan} from "./Planner.js";
import {ExecutionStatus} from "./ExecutionStatus.js";
import {SerialPlanner} from "./SerialPlanner.js";
import {JsonPointer as jp, LifecycleState} from "./index.js";

;

export interface ParallelExecutionPlan extends ExecutionPlan, PlanStep {
    parallel: ParallelExecutionPlan[] //this is the root node of the graph of ParallelPlanStep's
    completed: boolean //true when the entire execution subtree rooted in this node has finished
    jsonPtr: JsonPointerString
    restore?: boolean //used to mark plans as being used in association with a restore operation
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
    restore?: boolean = false;
    //uid: string = crypto.randomUUID();

    constructor(tp:TemplateProcessor, parallelSteps:ParallelExecutionPlan[]=[], vals?:Partial<ParallelExecutionPlan> | null) {
        this.output = tp.output
        this.parallel = parallelSteps;
        // Copy properties from `vals` into `this`, while preserving existing defaults
        if(vals){
            Object.assign(this, vals);
        }
    }

    private static _toJSON(p:ParallelExecutionPlanDefault):SerializableExecutionPlan{
        const json = {
            op: p.op,
            parallel: p.parallel.map(p=> ParallelExecutionPlanDefault._toJSON(p as any) ),
            completed: p.completed,
            jsonPtr: p.jsonPtr,
            forkStack: p.forkStack.map(fork=>fork.forkId),
            forkId: p.forkId,
            didUpdate: p.didUpdate,
            //uid: p.uid
        };
        if(p.data){
            (json as any).data = p.data;
        }
        return json;
    }

    toJSON(): SerializableExecutionPlan {
        return ParallelExecutionPlanDefault._toJSON(this);
    }

    cleanCopy(tp:TemplateProcessor, source:ParallelExecutionPlanDefault=this):ParallelExecutionPlanDefault{
        return new ParallelExecutionPlanDefault(tp, [], {
            op: source.op,
            parallel: source.parallel.map(p=> source.cleanCopy(tp, p as any) ),
            completed: false,
            jsonPtr: source.jsonPtr,
            forkStack: [],
            forkId: "ROOT",
            didUpdate: false,
            data: source.data
        });
    }

    getNodeList(all:boolean=false): JsonPointerString[] {
        const nodeSet: Set<JsonPointerString> = new Set();

        // Generic tree-walking function
        const walkTree = (node: ParallelExecutionPlan) => {
            const {jsonPtr, didUpdate} = node;
            if(jsonPtr !== "/") {
                if (all) {
                    nodeSet.add(jsonPtr); // Use Set to ensure uniqueness
                } else {
                    didUpdate && nodeSet.add(jsonPtr); // Use Set to ensure uniqueness
                }
            }
            // Traverse child nodes in the parallel array
            node.parallel.forEach(child => walkTree(child as ParallelExecutionPlanDefault));
        };

        // Start walking from the current instance
        walkTree(this);

        // Convert Set to array before returning
        return Array.from(nodeSet);
    }

    /**
     * make a shell of an ExecutionPlan that exist just to carry the jsonPtr, with op set to "noop"
     */
    getPointer(tp:TemplateProcessor): ParallelExecutionPlan{
        const ptrNode = new ParallelExecutionPlanDefault(tp, [], {...this,
            op:"noop",
            completed: true,  //since we never execute noop, we can always treat them as completed
            parallel:[] //pointer nodes are always pointers to nodes that have been, or are being processed, therefore a pointer node can behave as if it has no dependencies
        });
        //delete or null out as many fields as possible
        delete(ptrNode.data);
        delete(ptrNode.output);
        ptrNode.output = null;
        return ptrNode;
    }

}

type MutationParamsType = {
    mutationPlan: ParallelExecutionPlan;
    mutationTarget: string;
    op: Op;
    data?: any;
};

type NodeTraversalOptions = {preOrPost:"preorder"|"postorder"}

class TraversalState{
    visited = new Set();
    recursionStack:Set<JsonPointerString> = new Set(); //for circular dependency detection
    stack: ParallelExecutionPlan[] = [];
    options:{exprsOnly:boolean} = {exprsOnly:true};
    tp:TemplateProcessor;

    constructor(tp:TemplateProcessor, options:{exprsOnly:boolean} ) {
        this.options = options;
        this.tp = tp;
    }

    pushNode(node: ParallelExecutionPlan):boolean{
        const {jsonPtr, op} = node;
        if(op !== "noop" && this.stack.map(n=>n.jsonPtr).includes(jsonPtr)){ //noop's are the end of a traversal chain and in the case of a mutation will be the same jsonPtr as the initial mutation, so not circular. But any other offender is circular
            const e = '🔃 Circular dependency  ' + this.stack.map(n=>n.jsonPtr).join(' → ') + " → " + jsonPtr;
            this.tp.warnings.push(e);
            this.tp.logger.log('warn', e);
            return false;
        }
        if(this.stack[this.stack.length-1]?.op==="noop"){
            throw new Error(`attempt to push ${jsonPtr} onto traversal path that is already closed by a noop`)
        }
        this.stack.push(node);
        return true;
    }

    popNode(){
        this.stack.pop();
    }

    isCircular(dependency:JsonPointerString, owner:JsonPointerString) {
        return this.recursionStack.has(dependency as JsonPointerString)
        || this.isCommonPrefix(owner as JsonPointerString, dependency as JsonPointerString)
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
    private isCommonPrefix(exprNode:JsonPointerString, dependency:JsonPointerString):boolean{
    return JsonPointer.isAncestor(dependency, exprNode);
}

    logCircular(dependency:JsonPointerString) {
        const e = '🔃 Circular dependency  ' + Array.from(this.visited).join(' → ') + " → " + dependency;
        this.tp.warnings.push(e);
        this.tp.logger.log('warn', e);
    }
}

export function isMutation(op:Op){
    return ["set", "forceSetInternal", "delete"].includes(op);
}

export class ParallelPlanner implements Planner{
    private tp: TemplateProcessor;
    //private nodeCache: Map<JsonPointerString, ParallelExecutionPlanDefault> = new Map();
    private planCache: Map<JsonPointerString, [ExecutionPlan, JsonPointerString[]]> = new Map();

    constructor(tp:TemplateProcessor) {
        this.tp = tp;
        tp.planner = this as Planner;
        tp.lifecycleManager.setLifecycleCallback(LifecycleState.StartInitialize, async (state) => {
            this.planCache.clear();
        });
        tp.lifecycleManager.setLifecycleCallback(LifecycleState.Closed, async (state) => {
            this.planCache.clear()
        })
    }

    private logCircularDependency = (dependency:JsonPointerString, state:TraversalState) => {
        const e = '🔃 Circular dependency  ' + Array.from(state.visited).join(' → ') + " → " + dependency;
        this.tp.warnings.push(e);
        this.tp.logger.log('warn', e);
    }

    //remember, initialization plan is not always for "/" because we can be initializing an imported template
    getInitializationPlan(jsonPtr:JsonPointerString): ExecutionPlan {
         return this.makeInitializationPlan({jsonPtr}); //THING 1
    }

    /*
    getMutationPlan(jsonPtr:JsonPointerString, data:any, op:Op): [ExecutionPlan, JsonPointerString[]]{
        return this.makeMutationPlan(jsonPtr, data, op);
    }
    */

    getMutationPlan(mutationTarget:JsonPointerString, data:any, op:Op): [ExecutionPlan, JsonPointerString[]]{

        let mutationPlan;
        let legacyFromPlan:JsonPointerString[];

        if(this.planCache.has(mutationTarget)) { //cache hit
            [mutationPlan, legacyFromPlan] =  this.planCache.get(mutationTarget)!;
        }else { //cache-miss


            mutationPlan = this.makeInitializationPlan({exprsOnly: false}); //start with the initialization plan
            mutationPlan.op = op;
            mutationPlan.data = data;
            mutationPlan.jsonPtr = mutationTarget;
            //pruning is performed to remove parts of the initialization plan that are independent of the mutation
            this.prune({mutationPlan, mutationTarget, data, op});
            legacyFromPlan = this.tp.from(mutationTarget);
            //return [mutationPlan, legacyFromPlan];

            this.planCache.set(mutationTarget, [mutationPlan, legacyFromPlan]);

        }
        //it is very important to return a defensively copied version of the mutationPlan since the plan includes fields
        //like isComplete, didUpdate, etc that are mutated as a plan is executed
        const cleanCopy = (mutationPlan as ParallelExecutionPlanDefault).cleanCopy(this.tp);
        cleanCopy.data = data;
        return [cleanCopy, legacyFromPlan];


    }


/*
    private prunePlan = (params: MutationParamsType):ParallelExecutionPlan => {
        const {mutationPlan} = params;
        for (const dag of mutationPlan.parallel) {
            this.prune({...params, mutationPlan: dag});
        }
        //use the 'prunable' marker to replace the parallel plan with one that has filtered out prunable elements
        mutationPlan.parallel = mutationPlan.parallel.filter(dag => !(dag as any).prunable) //retain the elements that cannot be pruned
        return mutationPlan;
    }
*/

    private prune(params:MutationParamsType) {
        const {mutationPlan, op, mutationTarget} = params;
/*
        const mutationTarget = params.mutationTarget.endsWith('/-')?params.mutationTarget.slice(0,-1):params.mutationTarget;

        if(mutationPlan.jsonPtr !== '/') {
            throw new Error(`Prune is incorrectly applid to jsonPtr:${mutationPlan.jsonPtr} (it can only apply to '/')`);
        }

 */
        if(!["set", "delete", "forceSetInternal"].includes(op)){
            throw new Error(`Prune is incorrectly applid to op:${op} (it can only apply to mutations)`);
        }

        // Generic tree-walking function
        const walkTree = (node: ParallelExecutionPlan) => {
            //the plan we are pruning into a mutation plan began its life as an 'initialize' plan. Since we are making
            //a mutation tree,mutations happen only after initialization so nodes that were marked 'initialize' in the
            //initialization plan are converted to 'eval' ('initialize' just being a special case of first-time eval...
            //these are really just optics, it does not affect the behavior)
            if(node.op === "initialize"){
                node.op = "eval"
            }

            if(this.pruneFunction(node)){
                return;
            }

            //here we are trying to determine when the mutation target (at the root of the plan) matches a leaf
            //node of the plan, meaning a dependency graph ends at the mutation. We want to mark those leaf nodes as not
            //prunable. Also, the leaf node will not have a mutation like "set" in it because we are pruning and fixing up
            //an initialization plan that knows nothing about mutations (only the root node of the plan has been set to
            //the mutation op when we enter this method)
            //account for both exact matches, and also mutation target is /a/b/- and node is /a/b or /a
            if(this.markLeafMutation(node, mutationTarget)){
                return;
            }
            // Traverse child nodes in the parallel array
            node.parallel.forEach(child =>{
                walkTree(child);
            });
            node.parallel = node.parallel.filter(child => {
                return !((child as any).prunable);
            });  //remove prunable nodes

            //if this is the leaf
            if(isMutation(node.op!)){ //this applies to removing the entire root tree of this plan
                (node as any).prunable = false; //can't prune this plan because it has the mutationTarget as a transitive dependency
                return;
            }

            this.dedupLeaves(node);

            (node as any).prunable = node.parallel.length === 0;

        };
/*
        for (const p of mutationPlan.parallel) {
            (p as any).prunable = true;
            if(p.jsonPtr === mutationTarget){
                continue; //a root plan originating at the mutation means someone has mutated the expression node itself, therefore we never need to pursue its dependencies
            };
            walkTree(p);
        }

 */
        this.removeDegenerates(params); //degenerate plans are those that set an expression to a scalar value. This is a very odd thing to do, but we account for it anyway
        walkTree(mutationPlan);
        return mutationPlan;
    }

    /**
     * There are situations when an expression can result in multiple parallel paths to the same node.
     * For example like ${a + a.b + a.c} where a is an expression (thus a.b and a.c are not materialized__)
     * will result in `parallel` containing three nodes of '/a'.
     * that cause
     * @param node
     * @private
     */
    private dedupLeaves(node:ParallelExecutionPlan) { //fixme todo - need to dedup across entire tree to avoid multiply running same expression..or do we? natural dduping w promise map on execute
        const seen:Record<string, any> = {}; // Object to track unique jsonPtr 
        const {parallel} = node;
        for (let i = parallel.length - 1; i >= 0; i--) { // Traverse array backward
            const {jsonPtr} = parallel[i];
            if (seen[jsonPtr]) {
                parallel.splice(i, 1); // Remove duplicate element
            } else {
                seen[jsonPtr] = true; // Mark `foo` value as seen
            }
        }
    }

    private pruneFunction(node:ParallelExecutionPlan):boolean {
        if(SerialPlanner.isFunction(node.jsonPtr, this.tp)){
            (node as any).prunable = true; //functions are immutable and are pruned off the mutation plan
            node.parallel = []; //no need to pursue children
            node.op = "noop"; //functions are not re-defined
            return true;
        }
        return false;
    }

    private markLeafMutation(node:ParallelExecutionPlan, mutationTarget: JsonPointerString):boolean {
        if(!isMutation(node.op!) && (JsonPointer.isAncestor(node.jsonPtr, mutationTarget) || JsonPointer.isAncestor(mutationTarget, node.jsonPtr))){
            (node as any).prunable = false; //the mutated node cannot be pruned, and this non-prunability will propagate to all transitive dependees
            node.op = "noop"; //lead mutations are actually noops that must not be applied since the root has already done it
            node.jsonPtr = mutationTarget; //adjust target /a/b to be /a/b/- so this leaf jsonPointer exactly matches the json pointer of the root of the mutation plan
            return true; //this the tail of the dependency chain
        }
        return false
    }

    //The mutation is the root of the plan. The root's parallel array are the entry points to independent dependency subgraphs that must 'pull' (postorder) the dependency through the graph. If an element of the parallel array has a jsonPtr of the mutation itself this is a degenerate dependency graph and means we replaced an expression with a value. Hence there can be no graph to pull through, so remove this element from the array
    private removeDegenerates(params:MutationParamsType) {
        const {mutationPlan, mutationTarget} = params;
        mutationPlan.parallel = mutationPlan.parallel.filter(child => {
            return !JsonPointer.isAncestor(mutationTarget, child.jsonPtr)
        } )
    }
    //you are working on the fact that a mutation always wants "/" here which is why when you change it from hard-coded
    //slash it will stop working for mutations. Basicalyl jsonPtr is an erroneus parameter at present. It is needed to support import
    //yet wants to be ignored for mutation plans that draft off the initialization plan
    private makeInitializationPlan(options:{
            exprsOnly?:boolean,
            jsonPtr?:JsonPointerString}={exprsOnly:true, jsonPtr:'/'}):ParallelExecutionPlan {
        const {jsonPtr="/", exprsOnly=true} = options;
        //this.nodeCache.clear();
        let rootExpressions: MetaInfo[] = this.getInitializationPlanEntryPoints(jsonPtr, options); //todo actually we should not even have to start with roots, can literally just throw in all the nodes
        if(rootExpressions.length === 0){ //can indicate circular dependency, or template with no expressions
            rootExpressions = this.tp.metaInfoByJsonPointer[jsonPtr].filter(metaInfo => metaInfo.expr__ !== undefined);
        }
        const parallelStepsRoot = new ParallelExecutionPlanDefault(this.tp);
        for(const metaInfo of rootExpressions){
            parallelStepsRoot.parallel.push(this.getDependenciesNode(metaInfo, new TraversalState(this.tp, {exprsOnly})));//this.getDependenciesNode(metaInfo, state)
        }
        return parallelStepsRoot
    }

    private getDependenciesNode(metaInfo:MetaInfo, traversalState:TraversalState) {
        const {options} = traversalState
        const node = new ParallelExecutionPlanDefault(this.tp, [],{
            jsonPtr:metaInfo.jsonPointer__ as JsonPointerString,
            op:"initialize"
        });
        const ok = traversalState.pushNode(node);
        if(!ok){ //circular
            node.op = "noop"; //break circular chain by marking op as noop and breaking out of recursion
            return node;
        }
        node.parallel = (metaInfo.absoluteDependencies__ as JsonPointerString[])
            .map(jsonPtr => {
                return JsonPointer.get(this.tp.templateMeta, jsonPtr) as MetaInfo;
            })
            .filter(metaInf =>{
                return !options.exprsOnly || metaInf.expr__ !== undefined; //filter to only expression nodes if exprsOnly:true
            })
            .map(metaInfo=>{
                return this.getDependenciesNode(metaInfo as MetaInfo, traversalState);
            });
        traversalState.popNode();
        return node;
    }

/*
    private makeMutationPlan(jsonPtr:JsonPointerString, data:any, op:Op):[ParallelExecutionPlan, JsonPointerString[]] {
        if(this.tp.planner !== this){
            throw new Error(`Illegal attempt to accessed TemplateProcessor with uniqueId ${this.tp.uniqueId} from a Planner that wasn't the template processor's Planner` );
        }
        this.nodeCache.clear();
        const plan = this.getDependeesNode(jsonPtr);
        plan.data = data;
        plan.op = op;
        const serializedFrom: JsonPointerString[] = this.tp.from(jsonPtr);
        return [plan,serializedFrom];
    }

 */


    /**
     * Produces a list of expressions that have no dependees and therefore are places to begin following dependencies
     * from.
     * @private
     */
    private getInitializationPlanEntryPoints(jsonPtr:JsonPointerString,  options:{
        exprsOnly?:boolean,
        jsonPtr?:JsonPointerString}={exprsOnly:true, jsonPtr:'/'}):MetaInfo[]{
        const leaves: MetaInfo[] = [];
        const metaInfos = this.tp.metaInfoByJsonPointer[jsonPtr];
        //link up the implicit dependencies into both the dependencies of this MetaInfo, and the dependees
        //of the dependencies
        metaInfos.forEach(metaInfo => {
            if(metaInfo.expr__) {
                const {
                    newDependencies,
                    previouslyVisitedDependencies
                } = this.immediateAndImplicitDependencies(metaInfo, new TraversalState(this.tp, {exprsOnly:options.exprsOnly!}));
                /*
                if(previouslyVisitedDependencies.length > 0){
                    throw new Error(`unexpected previouslyVisitedDependencies ${JSON.stringify(previouslyVisitedDependencies)} for ${metaInfo.expr__}`);
                }*/
                metaInfo.absoluteDependencies__ = [...new Set([
                    ...metaInfo.absoluteDependencies__ as JsonPointerString[],
                    ...newDependencies as JsonPointerString[]])];

                newDependencies.forEach((dependency:JsonPointerString) => {
                    //add new 'implicit' dependencies into existing set

                    const dependee:MetaInfo = JsonPointer.get(this.tp.templateMeta, dependency) as MetaInfo;
                    dependee.dependees__ = [...new Set([
                        ...dependee.dependees__ as JsonPointerString[],
                        metaInfo.jsonPointer__ as JsonPointerString])];//dependency])];
                })



            }
        });
        //now iterate over the MetaInfos again, this time, collecting entry points that have no dependees, now that we have
        // accunted for implicit dependees but skip the root which can be generated as an implicit parent dependency
        metaInfos.forEach(metaInfo => {
            if (metaInfo.dependees__.length === 0 && metaInfo.expr__ !== undefined && !JsonPointer.rootish(metaInfo.jsonPointer__ as JsonPointerString)) {
                leaves.push(metaInfo); //has no dependencies, therefore is an entry point to the graph
            }
        });
        return leaves;
    }

    /*
    private getDependenciesNode(metaInfo: MetaInfo, state:TraversalState):ParallelExecutionPlan {
        const {jsonPointer__:jsonPtr} = metaInfo;
        const {exprsOnly} = state.options;

        let node = this.nodeCache.get(jsonPtr as JsonPointerString);
        if (node){
            return node;
        }
        //cache a new node
        node = new ParallelExecutionPlanDefault(this.tp, [],{
            jsonPtr:jsonPtr as JsonPointerString,
            op:"initialize"
        })
        this.nodeCache.set(jsonPtr as JsonPointerString, node);
        //state.visited.clear();
        const {newDependencies, previouslyVisitedDependencies} = this.immediateAndImplicitDependencies(metaInfo, state);

        //populate the new dependencies into the cached node
        const tmp = [];
        for(const dependency of newDependencies){
            let p;
            try {
                state.recursionStack.add(metaInfo.jsonPointer__ as JsonPointerString);
                if (state.isCircular(dependency, jsonPtr as JsonPointerString)) {
                    state.logCircular(dependency as JsonPointerString);
                    continue; //do not follow circular dependencies
                }
                p = this.getDependenciesNode(this.tp.getMetaInfo(dependency), state);
            }catch(error:any){
                if(error.message === "circular dependency"){
                    state.logCircular(dependency);
                    break; //break out of dependency tracking when circularity discovered
                }else{
                    throw error;
                }
            }finally {
                state.recursionStack.delete(metaInfo.jsonPointer__ as JsonPointerString);
                state.visited.clear(); //state is cleared after each dependency is handled, since state is for recursive circular reference detection
            }
            tmp.push(p);
        }
        node.parallel = tmp;


        //any previously visited dependencies get added as 'pointers' to the existing object in cache
        for(const ptr of previouslyVisitedDependencies){
            //this happens in an indirect dependency loop such as {a:b:${x}} in which x is presumed a
            //child of b, therefore indirect dependency walking goes first up to a then back down to a/b so a/b is
            //reported as an indirect dependency of itself
            if(ptr === jsonPtr){
                continue; //avoid indirect dependency loops
            }
            const cached = this.nodeCache.get(ptr) as ParallelExecutionPlanDefault;
            //You might wonder why we have to verify if a previously visited dependency is in cache. Shouldn't it
            //always be, and we don't need if(cached) check first? The reason is that when
            // immediateAndImplicitDependencies is called with state.options.expressionsOnly=true
            //as is the case when forming the initialization plan, the expressionsOnly=true means that the leaves of
            //dependency tree (the actual values being pulled through the tree) are not returned in newDependencies
            //object.
            if(cached){
                const pointer = cached.getPointer(this.tp);
                //when the node is previously visited we simply add a thin 'pointer' to it
                node.parallel.push(pointer);
            }
        }

        return node;
    }


    private getDependenciesNode2(metaInfo: MetaInfo, options:{exprsOnly:boolean}={exprsOnly:true}):ParallelExecutionPlan {
        const {jsonPointer__:jsonPtr} = metaInfo;
        const {exprsOnly} = options;

        let visited = this.nodeCache.get(jsonPtr as JsonPointerString);
        if (visited){
            return visited;
        }
        const dependencies:JsonPointerString[] = this.immediateAndImplicitDependencies(metaInfo, {exprsOnly});

        const parallel = dependencies.map(ptr =>{
            return this.getDependenciesNode2(this.tp.getMetaInfo(ptr), options)
        });

        visited = new ParallelExecutionPlanDefault(this.tp, parallel,{
            jsonPtr:jsonPtr as JsonPointerString,
            op:"initialize"
        })
        this.nodeCache.set(jsonPtr as JsonPointerString, visited)

        return visited;
    }



    private getDependeesNode(jsonPtr:JsonPointerString):ParallelExecutionPlan{
        if(jsonPtr === undefined){
            throw new Error("can't getDependeesNode() for undefined jsonPointer");
        }
        const metaInf = this.tp.getMetaInfo(jsonPtr);
        let visited = this.nodeCache.get(jsonPtr as JsonPointerString);
        if(visited){
            return visited;
        }
        const serialPlanner = new SerialPlanner(this.tp);
        const dependees:MetaInfo[] = serialPlanner.getDependeesBFS(jsonPtr as JsonPointerString);
        const parallel = dependees.map(m =>this.getDependeesNode(m.jsonPointer__ as JsonPointerString));
        visited = new ParallelExecutionPlanDefault(this.tp, parallel,{
            jsonPtr:jsonPtr as JsonPointerString,
            op:"eval"
        })
        this.nodeCache.set(jsonPtr as JsonPointerString, visited)

        return visited;
    }

     */


    async execute(plan: ExecutionPlan): Promise<void>{
        //console.log(`executing ${stringifyTemplateJSON(plan)}`);
        //we create a map of Promises. This is very important as two or more ParallelPlanSteps can have dependency
        //on the same node (by jsonPtr). These must await on the same Promise. For any jsonPtr, there must be only
        //one Promise that all the dependees wait on
        const promises =new Map<JsonPointerString, Promise<ParallelExecutionPlan>>();

        /**
         * define a local recursive function that has access to the map of promises and awaits the completion
         * of all its dependencies in parallel
         * @param step
         */
        const _execute = async (step: ParallelExecutionPlan): Promise<ParallelExecutionPlan> => {
            const { jsonPtr, op } = step;

            // Check if a Promise already exists for this jsonPtr (mutation is put in the map first since it is the root of the plan, so will be found by the leaves that depend on it)
            if (promises.has(jsonPtr)) {
                const promise = promises.get(jsonPtr)!; //don't freak out ... '!' is TS non-null assertion
                /*
                if(op === 'noop'){ //a noop is essentially a pointer to a node that has already executed so when the true node executes we have to update the noop node
                    return await promise.then(didUpdate=>{
                        step.completed = true;
                        step.didUpdate = didUpdate; //the noop simply has to record that the mutation completed
                        return true; //fixme? shouldn't it return didUpdate
                    });
                }

                 */
                //return a 'pointer' to the cached plan, or else we create loops with lead nodes in a mutation plan pointing back to the root of the
                //plan that holds the mutation
                return promise.then(plan=>{
                    return (plan as ParallelExecutionPlanDefault).getPointer(this.tp);
                }); //the returned promise is just a boolean saying if the node value changed do to evaluation or mutation
            }

            // Create a placeholder Promise immediately and store it in the map
            const placeholderPromise: Promise<ParallelExecutionPlan> = new Promise<ParallelExecutionPlan>((resolve, reject) => {
                promises.set(
                    jsonPtr,
                    (async () => {
                        try {
                            step.output = plan.output;
                            step.forkId = plan.forkId;
                            step.forkStack = plan.forkStack;
                            //await all dependencies ...and replace the parallel array with the executed array, since the
                            //`promises` Map has caused already executed subtrees to be replaces with their cache-normalized
                            //equivalent
                            step.parallel = await Promise.all(
                                step.parallel.map((d) => {
                                    const executed = _execute(d);
                                    return executed
                                })
                            );
                            //if we are initializing the node, or of it had dependencies that changed, then we
                            //need to run the step
                            if(  plan.op === "initialize" || step.parallel.some((step) => step.didUpdate || step.completed)){
                                if(!step.completed){ //fast forward past completed steps
                                    try {
                                       // console.log(`calling evaluateNode with ${(step as any).uid}`);
                                        step.didUpdate = await this.tp.evaluateNode(step);
                                    }catch(error){
                                        //console.error(`error while executing ${step.jsonPtr} on plan\n: ${stringifyTemplateJSON(plan)}`);
                                        throw error;
                                    }
                                }
                            }else { //if we are here then we are not initializing a node, but reacting to some mutation.
                                    //and it is possible that the node itself is originally a non-materialized node, that
                                    //has now become materialized because it is inside/within a subtree set by a mutation
                                const _plan = plan as ParallelExecutionPlanDefault;
                                const insideMutation = this.stepIsDescendantOfMutationTarget(step, _plan );
                                if(insideMutation){
                                    const theMutation = promises.get(_plan.jsonPtr);
                                    if(!theMutation){
                                        throw new Error(`failed to retrieve mutation from cache for ${_plan.jsonPtr}`);
                                    }
                                    const mutationCausedAChange= (await theMutation).didUpdate;
                                    if(mutationCausedAChange){
                                        const _didUpdate= await this.tp.evaluateNode(step);
                                        step.didUpdate = _didUpdate;
                                    }
                                }
                            }
                            step.completed = true;
                            resolve(step);
                        } catch (error) {
                            promises.delete(jsonPtr); // Clean up failed promise
                            reject(error);
                        }
                    })().then(() => {//IIFE returns void, so we can't take it as parameter to then
                        return step as ParallelExecutionPlan; //return the step from the closure
                    }) // Explicitly return a ParallelExecutionPlan becuase IIFE does not return a known type
                );
            });

            return placeholderPromise;
        }; //end _execute

        try { //mutation plan
            const _plan = plan as ParallelExecutionPlanDefault;
            //on a mutation, the root node will be a mutation and the child nodes are independent dependency graphs
            const isMutation = ["set", "forceSetInternal", "delete"].includes(_plan.op);
            if(isMutation && !_plan.completed){
                const mutationPromise = this.tp.mutate(_plan);
                promises.set(_plan.jsonPtr, mutationPromise as Promise<ParallelExecutionPlan>);
                const {didUpdate} = await mutationPromise; //allow mutation to complete before triggering reaction plan
                _plan.didUpdate = didUpdate; //if you dig deep you will find technically _plan.didUpdate is already set, but doing it again here is good for comprehensibility

                //if a mutation came from a snapshot we cannot trust didUpdate to determine if we execute the rest
                //of the plan. THis is because a snapshot can be taken in between output getting set, and change
                //propagation. So if are restoring a snapshot we must always kickoff change propagation.
                if(_plan.didUpdate || _plan.restore) {
                    await Promise.all(_plan.parallel.map(p => { //change propagation
                        return _execute(p)
                    }));
                }

            }else {
                await _execute(plan as ParallelExecutionPlan);
            }

            (plan as ParallelExecutionPlan).completed = true;
        } catch (error) {
            this.tp.logger.error("Execution failed", error);
            throw error;
        }
    }

    private stepIsDescendantOfMutationTarget(step: ParallelExecutionPlan, plan: ParallelExecutionPlanDefault):boolean{
        const {op} = plan;
        if(["set", "forceSetInternal", "delete"].includes(op)){
            return (JsonPointer.isAncestor(step.jsonPtr, plan.jsonPtr));//plan.jsonPtr is the mutation target
        }
        return false;
    }

    immediateAndImplicitDependencies(metaInfo:MetaInfo, state:TraversalState):{newDependencies:JsonPointerString[], previouslyVisitedDependencies:JsonPointerString[]} {
        //const visited = new Set();
        //const recursionStack:Set<JsonPointerString> = new Set(); //for circular dependency detection
        //const orderedJsonPointers:Set<string> = new Set();
        const {visited, recursionStack} = state;
        const newDependencies =  new Set<string>();
        const previouslyVisitedDependencies =  new Set<string>();
        const templateMeta = this.tp.templateMeta;
        const {exprsOnly} = state.options

        //--------------- utility sub-functions follow ----------------//

        const impliedDependencies = (metaInfo:MetaInfo) => {
            markAsVisited(metaInfo); //visited tells us 'globally' is a node has ever been visited
            //...however, we also need to track the traversal of dependencies that is 'local' to a single
            //originating node/expression. Circularity of references is limited to this "local" Scope. If we
            //detected circularity with the global 'visited' list, it would mean that circularity was somehow
            //a property of the entire template, which it is not. Circularity is a property of individual expression
            //fanouts, '.from' a given expression/node
            //addToScope(metaInfo);
            processUnmaterializedDependency(metaInfo);
            emit(metaInfo);
            followChildren(metaInfo);

            //removeFromScope(metaInfo); //...and clear that 'local' scope now that we finished processing the node
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
            //THING 2
            /*
            if(!metaInfoNode.materialized__){
                return; //do not try to follow children of non-materialized nodes
            }

             */
            //Do not follow children of nodes that are expressions, because if you have a dependency on a value generated by an expression,
            //then there cannot be any expressions underneath this node. You already have your dependency by virtue of depending
            //on the expression-node.
            if(metaInfoNode.expr__ !== undefined){
                return; //thing 4
            }
            for (const childKey in metaInfoNode) {
                if (!childKey.endsWith("__")) { //ignore metadata fields
                    const child = metaInfoNode[childKey];
                    //fixme todo look into weird case where child key 'acc/-' is in tree structure but has no
                    if (!visited.has(child.jsonPointer__) ) { //&& !child.materialized__ //THING 3
                        impliedDependencies(child);
                    }else{
                        child.jsonPointer__ && previouslyVisitedDependencies.add(child.jsonPointer__)
                    }
                }
            }
        }

        const searchUpForExpression = (childNode:MetaInfo):MetaInfo|undefined=> {
            if(childNode.jsonPointer__===undefined){
                return undefined
            }
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
/*
        //fixme thing 4. Because we don't call followDependencies, we don't detect circularity anymore
        const followDependencies = (metaInfo:MetaInfo) => {
            if (!metaInfo.absoluteDependencies__) return;

            for (const dependency of metaInfo.absoluteDependencies__) {

                if (recursionStack.has(dependency as JsonPointerString)
                    || isCommonPrefix(metaInfo.jsonPointer__ as JsonPointerString, dependency as JsonPointerString)) {
                    logCircularDependency(dependency as JsonPointerString);
                    continue; //do not follow circular dependencies
                }

                if (visited.has(dependency)) {
                    previouslyVisitedDependencies.add(dependency as JsonPointerString);
                    continue;
                }
                const dependencyNode = JsonPointer.get(templateMeta, dependency) as MetaInfo;
                processUnmaterializedDependency(dependencyNode);
                impliedDependencies(dependencyNode);
            }
        }

 */

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
            if(metaInfo.jsonPointer__  == undefined){
                //throw new Error(`Execution failed, no jsonPointer__`);
                return;
            }
            newDependencies.add(metaInfo.jsonPointer__ as JsonPointerString);
        }


        //-------- end utility sub functions -------------//

        if(!metaInfo.jsonPointer__){
           throw new Error("expected metaInfo to have jsonPointer__");
        }
        visited.add(metaInfo.jsonPointer__);
        for(const dependency of metaInfo.absoluteDependencies__) {
            /*
            if (recursionStack.has(dependency as JsonPointerString)
                || isCommonPrefix(metaInfo.jsonPointer__ as JsonPointerString, dependency as JsonPointerString)) {
                logCircularDependency(dependency as JsonPointerString);
                continue; //do not follow circular dependencies
            }

             */
            if (visited.has(dependency)) {
                previouslyVisitedDependencies.add(dependency as JsonPointerString);
                //continue;
            }
            const depMeta:MetaInfo = JsonPointer.get(this.tp.templateMeta, dependency) as MetaInfo;
            emit(depMeta);
            //if (!visited.has(depMeta.jsonPointer__)) {
                impliedDependencies(depMeta);
            //}
        }

        return {
            newDependencies: [...newDependencies],
            previouslyVisitedDependencies: [...previouslyVisitedDependencies]
        };

    }

    public async restore(executionStatus: ExecutionStatus): Promise<void> {

        // restart all plans.
        for (const mutationPlan of executionStatus.plans) {
            this.validatePlan(mutationPlan as ParallelExecutionPlanDefault); //
            // restore functions into plan output
            this.restoreFunctions(mutationPlan.output);
            // restore intervals and timer handles into plan output
            //this.restoreIntervalsAndTimers(mutationPlan.output, restarts);
            (mutationPlan as any).restore = true; //add the 'restore' marker to the plan so that downstream consumers like Plan.execute() know they are doing a restore
            //we don't await here. In fact, it is critical NOT to await here because the presence of multiple mutationPlan
            //means that there was concurrent ($forked) execution and we don't want to serialize what was intended to
            //run concurrently
            this.tp.executePlan(mutationPlan); // restart the restored plan asynchronously

        }
    }

    private validatePlan(plan: ParallelExecutionPlanDefault): void {
        if(!plan.toJSON()){
            throw new Error(`plan is missing toJSON method; this probably indicates you forgot to rehydrate the JSON via ExecutionStatus.fromJsonObject, resulting in a borked plan`);
        }
    }

    private async restoreFunctions(output:any) {
        try {
            this.tp.metaInfoByJsonPointer["/"]
                ?.filter(metaInfo => metaInfo.isFunction__)
            .forEach(metaInfo => {
                const jsonPtr = metaInfo.jsonPointer__ as JsonPointerString;
                const func = jp.get(this.tp.output, jsonPtr);
                jp.set(output, jsonPtr, func);
            });
        } catch (error) {
            this.tp.logger.error();
            throw error;
        }
    }

    private  restoreIntervalsAndTimers(output:any, restarts:JsonPointerString[]) {
        try {
            //put the restarted timers and intervals in place in the MVCC plan
            restarts.forEach(jsonPtr=>{
                const intervalOrTimer = jp.get(this.tp.output, jsonPtr);
                jp.set(output, jsonPtr, intervalOrTimer)
            });
        } catch (error) {
            this.tp.logger.error(error);
            throw error;
        }
    }

    async restartIntervalsAndTimers():Promise<JsonPointerString[]> {
        try {
            return await Promise.all(
                this.tp.metaInfoByJsonPointer["/"]
                    ?.filter(metaInfo => metaInfo.data__ === '--interval/timeout--')
                    .map(async metaInfo => {
                        const jsonPtr = metaInfo.jsonPointer__ as JsonPointerString;
                        this.tp.evaluateNode({
                            op: "eval",
                            jsonPtr,
                            output: this.tp.output,
                            forkStack: [],
                            forkId: "ROOT",
                            didUpdate: false
                        });
                        return jsonPtr;
                    })
            );
        } catch (error) {
            this.tp.logger.error("Failed to restart intervals/timers:", error);
            throw error;
        }
    }


    /**
     * to preserve backward compatibility of the from command, the parallel ple
     * @param jsonPtr
     */
    from(jsonPtr: JsonPointerString): JsonPointerString[] {
        return new SerialPlanner(this.tp).from(jsonPtr);
    }

    toJSON(mutationPlan: ExecutionPlan): SerializableExecutionPlan {
        const _plan= mutationPlan as ParallelExecutionPlanDefault
        return _plan.toJSON();
    }

    async executeDataChangeCallbacks(plan: ExecutionPlan): Promise<void> {
        const _plan = plan as ParallelExecutionPlanDefault;

        const {receiveNoOpCallbacksOnRoot:everything = false} = this.tp.options;
        const jsonPtrArray = _plan.getNodeList(everything); //vs default which is 'only changes'
        const anyUpdates = jsonPtrArray.length > 0

        if (anyUpdates || everything) {
            const {op="set"} = plan;
            // current callback APIs are not interested in deferred updates, so we reduce op to boolean "removed"
            const removed = op==="delete";
            //admittedly this structure of this common callback is disgusting. Essentially if you are using the
            //common callback you don't want to get passed any data that changed because you are saying in essence
            //"I don't care what changed".
            //ToDO - other calls to callDataChangeCallbacks are not awaiting. Reconcile this
            await this.tp.callDataChangeCallbacks(plan.output, jsonPtrArray, removed, op);
        }
    }

    fromJSON(planData: SerializableExecutionPlan, snapshot: Snapshot, forks: Map<string, Fork>): ExecutionPlan {
        const parallelPlan = new ParallelExecutionPlanDefault(this.tp, [], {
            ...planData,
            forkStack:planData.forkStack.map((forkId: string) => forks.get(forkId)!),
            output: forks.get(planData.forkId)?.output || {},
        });
        return parallelPlan;
    }



}




