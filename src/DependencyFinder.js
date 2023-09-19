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

import {default as last} from 'lodash-es/last.js';
import jsonata from "jsonata";



export default class DependencyFinder {
    constructor(program) {
        this.compiledExpression = jsonata(program);
        this.ast = this.compiledExpression.ast();
        this.currentSteps = [];
        this.paths = [];
        this.nodeStack = [];
    }

    findDependencies(node = this.ast) {
        if (this.currentSteps.length === 0) {
            this.currentSteps.push([]); //initialize a container for steps
        }
        if (node === undefined) {
            return;
        }
        if (Array.isArray(node)) {
            node.forEach(c => {
                this.findDependencies(c);
            });
            return;
        }

        if (typeof node === 'object' && node !== null) {
            const {
                type,
            } = node;
            this.capturePathExpressions(node);
            this.captureArrayIndexes(node);
            this.nodeStack.push(node);
            switch (type) {
                case "bind":  // :=
                case "path": //a.b.c
                    //paths can happen inside paths. a.b[something].[zz] contains paths within paths
                    //so each time the path is broken we push the current paths and reset it.
                    const {pseudoType} = node;
                    if(pseudoType !== "procedure") { //this means we are entering a function call and we want to collect the function name as part of the path we are currently traversing, not as a new path
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
                    if (!this.hasAncestor(n => n.type === "path")) {
                        this.emitPaths(); //every independent variable should be separately emitted. But if it is under a path then don't emit it since it should be glommed onto the path
                    }
                    break;
                case "path":
                    this.emitPaths(); //every independent path should be separately emitted
                    break;
            }
            this.nodeStack.pop();
        }
        return this.paths;
    }

    findTargetsOfSet(node = this.ast){
        console.log(node);
    }


    collectChildren(node) {
        function ensureProcedureBeforeArguments(arr) {
            const procedureIndex = arr.indexOf("procedure");
            const argumentsIndex = arr.indexOf("arguments");

            // If both strings are in the array and "arguments" comes before "procedure"
            if (procedureIndex !== -1 && argumentsIndex !== -1 && argumentsIndex < procedureIndex) {
                // Swap the strings
                [arr[procedureIndex], arr[argumentsIndex]] = [arr[argumentsIndex], arr[procedureIndex]];
            }

            return arr;
        }
        function introducePseudoTypes(node, key) {
            const value = node[key];
            if (!value) return null;

            if (Array.isArray(value)) {
                if (key === "arguments") {
                    return { ...value, "pseudoType": key };
                }
                return value;
            } else if (typeof value === 'object' && value !== null) {
                return { ...value, "pseudoType": key };
            }
            return null;
        }

        //any property of node that is not type, value, or position is a child of the node
        const keysToIgnore = ["type", "value", "position", "pseudoType"];
        const filteredKeys = Object.keys(node).filter(key => !keysToIgnore.includes(key));
        const orderedKeys = ensureProcedureBeforeArguments(filteredKeys);

        const result = [];
        for (const key of orderedKeys) {
            const processedAttribute = introducePseudoTypes(node, key);
            if (processedAttribute) {
                result.push(processedAttribute);
            }
        }
        return result;
    }

    captureArrayIndexes(node) {
        const {type, expr} = node;
        if (type === "filter" && expr?.type === "number") {
            last(this.currentSteps).push({type, "value": expr.value, "emit": expr?.type === "number"});
        }
    }
    //this is where we capture the path and name expressions like a.b.c or $.a
    capturePathExpressions(node) {
        const {type, value} = node;
        if (type !== "name" && type !== "variable") {
            return;
        }
        if (this.isRootedIn$$(value)) { //if the root of the expression is $$ then we will always accept the navigation downwards
            last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        if (this.isInsideAScopeWhere$IsLocal(node)) { //path expressions inside a transform are ignored modulo the $$ case just checked for above
            last(this.currentSteps).push({type, value, "emit": false});
            return;
        }
        if (this.isSingle$Var(type, value)) {  //accept the "" variable which comes from single-dollar like $.a.b when we are not inside a transform. We won't accept $foo.a.b
            last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        if (type === "variable") {
            //if we are here then the variable must be an ordinary locally named variable since it is neither $$ or $.
            //variables local to a closure cannot cause/imply a dependency for this expression
            if (!this.hasParent("function")) { //the function name is actually a variable, we want to skip such variables
                last(this.currentSteps).push({type, value, "emit": false});
            }
            return;

        }
        //if we are here then we are dealing with names, which are identifiers like 'a' which can occur in a.b.c or
        // just plain a
        //if the name is an argument to a function, then it should be emitted as a dependency
        if(this.hasAncestor(n=>n.pseudoType === "arguments")){
            last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        /*
        if (!this.isUnderTreeShape(["path", "function"])) {
            last(this.currentSteps).push({type, value, "emit": true}); //tree shape like a.$sum(x,y) we cannot count x and y as dependencies because a can be an array that is mapped over
        }

         */
        last(this.currentSteps).push({type, value, "emit": true});

    }


    hasParent(parentType) {
        return this.nodeStack.length !==0  &&
            ( last(this.nodeStack).type === parentType || last(this.nodeStack).pseudoType === parentType);
    }

    hasAncestor(matcher) {
        return this.nodeStack.some(matcher);
    }

    ancestors(matcher) {
        return this.nodeStack.filter(matcher);
    }

    isUnderTreeShape(pathTypes) {
        return this.nodeStack.reduce((_pathTypes, curr) => {
            if (_pathTypes[0] === curr.type || _pathTypes[0] === curr.pseudoType) {
                _pathTypes.shift(); //if the curr path item is the first element of the _pathTypes we remove it from _path
            }
            return _pathTypes;
        }, [...pathTypes]).length === 0; //if 0 then the desired shape existed
    }

    isSingle$Var(type, value) {
        return type === "variable" && value === ""; // $ or $.<whatever> means the variable whose name is empty/"".
    }

    isRootedIn$$(value) {
        const _last = last(this.currentSteps);
        return _last && (_last.length === 0 && value === "$"
            || _last.length > 0 && _last[0].value === "$");
    }


    isInsideAScopeWhere$IsLocal(node) {
        let matches = this.ancestors(n => {
            const {type:t, pseudoType:p, value:v} = n;
            return (t === "unary" && ["(", "{", "[", "^"].includes(v)) //(map, {reduce, [filter, ^sort
                || t === "filter"
                || p === "predicate";
        });
        //the local scope is equal to the input scope to the expression the first time we enter one of these blocks
        //However the second time the scope is the output from a prior expression, not the input. Therefore the scope
        //is local to the expression when there is more than one match in the ancestors
        if (matches.length > 1){
            return true;
        }

        //if we are following a consarray like [1..count].{"foo"+$}} then $ is a local scope. So we have to make
        //sure we are not IN a consarray as count is in and then if we are not in a consarray, are we following
        //a consarray (immediately or later)
        matches = !this.hasAncestor(n=>n.consarray !== undefined) && this.ancestors(n => {
            const {type:t,  position, steps} = n;
            //iterate the steps array and determine if there is a consarray that comes before this node's position in the steps
            return t==="path" && steps.find(nn=>nn.consarray && nn.position < node.position);
        });
        if (matches.length > 0){
            return true;
        }


        //If we are in a transfor, scope is local
        matches = this.ancestors(n => {
            const {type:t} = n;
            return t === "transform";
        });
        return matches.length > 0;
    }

    emitPaths() {

        const emitted = [];
        const steps = this.currentSteps.flat(); //[[],["a","b"], ["c"]] -> ["a","b","c"]
        const lastStepsArray = last(this.currentSteps);
        if (lastStepsArray.length > 0 && lastStepsArray.every(s => s.emit)) {
            if (lastStepsArray[0].value === "$") { //corresponding to '$$' variable
                //in this case the chain of steps must be broken as '$$' is an absolute reference to root document
                lastStepsArray.forEach(s => emitted.push(s.value));
            } else {
                steps.forEach(s => s.emit && emitted.push(s.value));
            }
        }
        this.currentSteps.pop();
        if(emitted[emitted.length-1]===""){
            emitted.pop(); //foo.{$} would result in [foo, ""] as dependency. Trailing "" must be removed.
        }
        if(emitted.length === 1 && emitted[0]==="$"){
            return; // a solo dependency of "$" gets scrapped. We don't track dependencies on the root of the template itself
        }
        if (emitted.length > 0) {
            this.paths.push(emitted);
        }

    }

    isRootLevelFunctionDecalaration(node){
        return this.nodeStack.length===0 && node.type === "lambda"
    }

}



