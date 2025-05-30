// Copyright 2023 Cisco Systems, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import last from 'lodash/last.js';
import * as jsonata from "jsonata";
import {ExprNode} from "jsonata";

/*
  There are cases where we need to generate some AST nodes the JSONata does not generate. Instead of referring to
  their ExprNode 'type' we say the generated node has a pseudoType
 */
interface GeneratedExprNode extends jsonata.ExprNode {
    pseudoType?: string;
    expr?:{value:any, type:string, position:number}; //this actually comes from jsonata itself, but oddly is not captured in their ExprNode interface
    usesReturnedValueFromFunction?:boolean;
    consarray?:boolean; //another field from jsonata itself, not documents in ExprNode
}

/*
    Used to record a Step like 'b' in 'a.b.c'
 */
interface StepRecord{
    type:string;
    value: string;
    emit:boolean;  //not every step gets emitted as a dependency
}


export default class DependencyFinder {
    //@ts-ignore
    compiledExpression: jsonata.Expression;
    //@ts-ignore
    private ast: jsonata.ExprNode;
    private readonly currentSteps: StepRecord[][]; //logically, [[a,b,c],[d,e,f]]
    private nodeStack: GeneratedExprNode[];
    private readonly dependencies: string[][]; //during tree walking we collect these dependencies like [["a", "b", "c"], ["foo", "bar"]] which means the dependencies are a.b.c and foo.bar
    public readonly variables: Set<string> = new Set<string>();
    /**
     * program can be either a string to be compiled, or an already-compiled AST
     * @param program
     */
    constructor(program: string | ExprNode) {
        if (typeof program === 'string') {
            if(program !== "") {
                // Handle the case where program is a string
                this.compiledExpression = jsonata.default(program);
                this.ast = this.compiledExpression.ast();
            }
        } else {
            this.ast = program;
        }

        this.currentSteps = [];
        this.dependencies = [];
        this.nodeStack = [];
    }

    /**
     * If we are looking to analyze only a portion of the jsonata program we can provide another jsonata expression
     * such as '**[procedure.value='serial']' which will filter the AST down to what is defined. In the case of
     * '**[procedure.value='serial']' the expression will extract the AST for $serial(...) as it may exist in the
     * original program.
     * @param jsonatExpr
     */
    async withAstFilterExpression(jsonatExpr:string):Promise<DependencyFinder>{
        const filter = jsonata.default(jsonatExpr);
        this.ast = await filter.evaluate(this.ast);
        return this;
    }

    /*
        Walk the AST of the JSONata program
     */
    findDependencies(node:GeneratedExprNode = this.ast):string[][] {
        if(!this.ast){
            return [];
        }
        if (this.currentSteps.length === 0) {
            this.currentSteps.push([]); //initialize a container for steps
        }
        if (node === undefined) {
            return [];
        }
        if (Array.isArray(node)) {
            node.forEach(c => {
                this.findDependencies(c);
            });
            return [];
        }

        if (typeof node === 'object' && node !== null) {
            const {
                type,
            } = node;
            this.captureBuiltInFunctionNames(node);
            this.capturePathExpressions(node);
            this.captureArrayIndexes(node);
            this.nodeStack.push(node);
            switch (type) {
                case "bind":  // :=
                case "path": //a.b.c
                    //dependencies can happen inside dependencies. a.b[something].[zz] contains dependencies within dependencies
                    //so each time the path is broken we push the current dependencies and reset it.
                    const {pseudoType} = node;
                    if(pseudoType !== "procedure") { //this means we are entering a function call, and we want to collect the function name as part of the path we are currently traversing, not as a new path
                        this.currentSteps.push([]);
                    }
                    break;
            }
            //the children above require the special processing above. But then there are all the other
            //children which we deal with, and we don't need to write any special code for them.
            const children = this.collectChildren(node);


            children.forEach(c => {
                this.findDependencies(c);
            });

            //now we are coming out of the recursion, so the switch below is over the just-finished subtree
            switch (type) {
                case "variable":
                    if (!this.hasAncestor((n:ExprNode) => n.type === "path")) {
                        this.emitPaths(); //every independent variable should be separately emitted. But if it is under a path then don't emit it since it should be glimmered onto the path
                    }
                    break;
                case "path":
                    this.emitPaths(); //every independent path should be separately emitted
                    break;
            }
            //we are exiting the scope so pop
            const scopeWeExited = this.nodeStack.pop()
            this.markScopeWhenFunctionReturnsValue(scopeWeExited as GeneratedExprNode);
        }
        return this.dependencies;
    }

    /**
     * Function calls like $count(...) are recorded in this.variables so that the MetaInf can have a record
     * of what context variables (in this case functions) were accessed by the expression.
     * @param node
     * @private
     */
    private captureBuiltInFunctionNames(node:GeneratedExprNode) {
        if(node.type === 'function'){
            const name = node.procedure?.value;
            if(name !== undefined){
                this.variables.add(name);
            }
        }
    }

    private markScopeWhenFunctionReturnsValue(scopeWeExited:GeneratedExprNode) {
        if (scopeWeExited?.type === 'function') { //function has returned
            const currentScope = DependencyFinder.peek(this.nodeStack);
            if (currentScope !== undefined) {
                const {type} = currentScope;
                if (type === 'path') {
                    currentScope.usesReturnedValueFromFunction = true; //add this flag so subsequent elements of the steps array that followed the function return don't emit a dependency
                }
            }
        }
    }

    static peek(array:any[]){
        if(array.length > 0){
            return array[array.length-1];
        }
        return undefined;
    }


    collectChildren(node: GeneratedExprNode):GeneratedExprNode[] {
        function ensureProcedureBeforeArguments(arr:any[]):string[] {
            const procedureIndex = arr.indexOf("procedure");
            const argumentsIndex = arr.indexOf("arguments");

            // If both strings are in the array and "arguments" comes before "procedure"
            if (procedureIndex !== -1 && argumentsIndex !== -1 && argumentsIndex < procedureIndex) {
                // Swap the strings
                [arr[procedureIndex], arr[argumentsIndex]] = [arr[argumentsIndex], arr[procedureIndex]];
            }

            return arr;
        }
        function introducePseudoTypes(node:ExprNode, key:string):GeneratedExprNode|null {
            const value:ExprNode = (node as any)[key] as ExprNode;
            if (!value) return null;

            if (Array.isArray(value)) {
                if (key === "arguments") {
                    return { ...value, "pseudoType": key };
                }
                return value;
            } else if (typeof value === 'object') {
                return { ...value, "pseudoType": key };
            }
            return null;
        }

        //any property of node that is not type, value, or position is a child of the node
        const keysToIgnore: string[] = ["type", "value", "position", "pseudoType"];
        const filteredKeys: string[] = Object.keys(node).filter(key => !keysToIgnore.includes(key));
        const orderedKeys: string[] = ensureProcedureBeforeArguments(filteredKeys);

        const result = [];
        for (const key of orderedKeys) {
            const processedAttribute = introducePseudoTypes(node, key);
            if (processedAttribute) {
                result.push(processedAttribute);
            }
        }
        return result;
    }

    captureArrayIndexes(node:GeneratedExprNode):void {
        const {type, expr} = node;
        if (type === "filter" && expr?.type === "number" && !this.hasAncestor((node:GeneratedExprNode)=>node.usesReturnedValueFromFunction)) {
            //@ts-ignore
            last(this.currentSteps).push({type, "value": expr.value, "emit": expr?.type === "number"});
        }

    }
    //this is where we capture the path and name expressions like a.b.c or $.a
    capturePathExpressions(node:GeneratedExprNode) {
        const {type, value} = node;
        if (type !== "name" && type !== "variable") {
            return;
        }
        if (this.isRootedIn$$(value)) { //if the root of the expression is $$ then we will always accept the navigation downwards
            //@ts-ignore
            last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        if (this.isInsideAScopeWhere$IsLocal(node)) { //path expressions inside a transform are ignored modulo the $$ case just checked for above
            //@ts-ignore
            last(this.currentSteps).push({type, value, "emit": false});
            return;
        }
        if (this.isSingle$Var(type, value)) {  //accept the "" variable which comes from single-dollar like $.a.b when we are not inside a transform. We won't accept $foo.a.b
            //@ts-ignore
            last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        if (type === "variable") {
            //if we are here then the variable must be an ordinary locally named variable since it is neither $$ or $.
            //variables local to a closure cannot cause/imply a dependency for this expression
            this.variables.add(value);
            if (!this.hasParent("function")) { //the function name is actually a variable, we want to skip such variables
                //@ts-ignore
                last(this.currentSteps).push({type, value, "emit": false});
            }
            return;

        }

        if(this.hasAncestor((node:GeneratedExprNode)=>node.usesReturnedValueFromFunction)){
            //@ts-ignore
            last(this.currentSteps).push({type, value, "emit": false});
            return;
        };

        const stepRecord: StepRecord = {type, value, "emit": true};
        //@ts-ignore
        last(this.currentSteps).push(stepRecord);

    }


    hasParent(parentType:string) {
        return this.nodeStack.length !==0  &&
            ( last(this.nodeStack)?.type === parentType || last(this.nodeStack)?.pseudoType === parentType);
    }

    //@ts-ignore
    hasAncestor(matcher) {
        return this.nodeStack.some(matcher);
    }

    //@ts-ignore
    ancestors(matcher) {
        return this.nodeStack.filter(matcher);
    }

    isSingle$Var(type:string, value:any) {
        return type === "variable" && value === ""; // $ or $.<whatever> means the variable whose name is empty/"".
    }

    isRootedIn$$(value:any) {
        const _last = last(this.currentSteps);
        return _last && (_last.length === 0 && value === "$"
            || _last.length > 0 && _last[0].value === "$");
    }


    isInsideAScopeWhere$IsLocal(node:GeneratedExprNode): boolean {
        let matches = this.ancestors((n:GeneratedExprNode) => {
            const {type:t, pseudoType:p, value:v} = n;
            return (t === "unary" && ["(", "{", "[", "^"].includes(v)) //(map, {reduce, [filter, ^sort
                || t === "filter"
                || p === "predicate";
        });
        //the local scope is equal to the input scope to the expression the first time we enter one of these blocks
        //However the second time the scope is the output from a prior expression, not the input. Therefore, the scope
        //is local to the expression when there is more than one match in the ancestors
        if (matches.length > 1){
            return true;
        }

        //if we are following a consarray like [1..count].{"foo"+$}} then $ is a local scope. So we have to make
        //sure we are not IN a consarray as count is in and then if we are not in a consarray, are we following
        //a consarray (immediately or later)
        //@ts-ignore
        matches = !this.hasAncestor((n:GeneratedExprNode)=>n.consarray !== undefined) && this.ancestors((n:GeneratedExprNode) => {
            const {type:t,  steps} = n;
            //iterate the steps array and determine if there is a consarray that comes before this node's position in the steps
            //@ts-ignore
            return t==="path" && steps.find((nn:GeneratedExprNode)=>nn.consarray && nn.position < node.position);
        });
        if (matches.length > 0){
            return true;
        }


        //If we are in a transform, scope is local
        matches = this.ancestors((n:GeneratedExprNode) => {
            const {type:t} = n;
            return t === "transform";
        });
        return matches.length > 0;
    }

    emitPaths() {
        if(this.currentSteps?.length === 0){
           return;
        }
        //@ts-ignore
        const lastStepsArray:StepRecord[] = last(this.currentSteps);
        let emitted:string[];
        if(DependencyFinder.isNoOpSteps(lastStepsArray)){
            emitted = [];
        }else if(DependencyFinder.stepsRootedIn$(lastStepsArray)){
            emitted = DependencyFinder.emit(lastStepsArray);
        }else{
            emitted = DependencyFinder.emit(this.currentSteps.flat()); //[[],["a","b"], ["c"]] -> ["a","b","c"]
        }
        this.currentSteps.pop();
        if(emitted[emitted.length-1]===""){
            emitted.pop(); //foo.{$} would result in [foo, ""] as dependency. Trailing "" must be removed.
        }
        if(emitted.length === 1 && emitted[0]==="$"){
            return; // a solo dependency of "$" gets scrapped. We don't track dependencies on the root of the template itself
        }
        if (emitted.length > 0) {
            this.dependencies.push(emitted);
        }

    }

    static isNoOpSteps(stepArray:StepRecord[]){
        return stepArray.length===0 || !stepArray[0].emit; //if a step array starts with a not emitted step, the entire thing is NoOp
    }

    static stepsRootedIn$(stepArray:StepRecord[]){
        return stepArray.length > 0 && stepArray[0].value === "$"; // in the actual expression this is $$ which means 'the variable named $'
    }

    static emit(stepArray:StepRecord[]){
        const emitted = [];
        for(let i=0;i<stepArray.length;i++){
            const {emit, value} = stepArray[i];
            if(emit){
                emitted.push(value)
            }else{
                break;
            }
        }
        return emitted;
    }


}



