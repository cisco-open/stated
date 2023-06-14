const jsonata = require("jsonata");
const _ = require('lodash');


class DependencyFinder {
    constructor(program) { //second argument is needed when $path() function is in the program
        this.compiledExpression = jsonata(program);
        this.ast = this.compiledExpression.ast();
        this.currentSteps = [];
        this.paths = [];
        this.exprStack = [];
        //this.pathInterrupts = 0;
    }

    findDependencies(node = this.ast) {
        if(this.currentSteps.length === 0){
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
                update,
                pattern,
                predicate,
                stages,
                procedure
            } = node;
            this.capturePathExpressions(node);
            this.captureArrayIndexes(node);
            this.exprStack.push(type);
            let children;
            switch (type) {
                case "bind":  // :=
                case "path": //a.b.c
                    //paths can happen inside paths. a.b[something].[zz] contains paths within paths
                    //so each time the path is broken we push the current paths and reset it.
                    //this.emitPaths();
                    this.currentSteps.push([]);
                    break;
            }
            //the children above require the special processing above. But then there are all the other
            //children which we deal with, and we don't need to write any special code for them.
            children = this.collectChildren(children, node);

            children.forEach(c => {
                this.findDependencies(c);
            });

            //now we are coming out of the recursion, so the switch below is over the just-finished subtree
            switch (type) {
                case "variable":
                    if(!this.hasAncestor(["path"])){
                        this.emitPaths(); //every independent variable should be separately emitted. But if it is under a path then don't emit it since it should be glommed onto the path
                    }
                    break;
                case "path":
                    this.emitPaths(); //every independent path should be separately emitted
                    break;
            }
            this.exprStack.pop();
        }
        return this.paths;
    }


    collectChildren(children, node) {
        //any property of node that is not type, value, or position is a child of the node
        if (children === undefined) {
            children = Object.keys(node).filter(k => !["type", "value", "position"]
                .includes(k)).reduce((acc, k) => {
                const v = node[k];
                if (v) {
                    acc.push(v);
                }
                return acc;
            }, []);
        }
        return children;
    }

    captureArrayIndexes(node){
        const {type, expr} = node;
        if (type==="filter" && expr?.type==="number") {
            _.last(this.currentSteps).push({type, "value":expr.value, "emit": expr?.type === "number"});
        }
    }

    capturePathExpressions(node) {
        const {type, value} = node;
        if (type !== "name" && type !== "variable" ) {
            return;
        }
        if (this.isRootedIn$$(value)) { //if the root of the expression is $$ then we will always accept the navigation downwards
            _.last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        if (this.isInsideAScopeWhere$IsLocal()) { //path expressions inside a transform are ignored modulo the $$ case just checked for above
            _.last(this.currentSteps).push({type, value, "emit": false});
            return;
        }
        if (this.isSingle$Var(type, value)) {  //accept the "" variable which comes from single-dollar like $.a.b when we are not inside a transform. We won't accept $foo.a.b
            _.last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        if (type === "variable") {
            //if we are here then the variable must be an ordinary locally named variable since it is neither $$ or $.
            //variables local to a closure cannot cause/imply a dependency for this expression
            if(!this.hasParent("function") ) { //the function name is actually a variable, we want to skip such variables
                _.last(this.currentSteps).push({type, value, "emit": false});
            }
            return;

        }
        //if we are here then we are dealing with names, which are identifiers like 'a' which can occur in a.b.c or $.a or $$.a or $foo.a, etc
        //The decision to emit a name is made based on its ancestor, or lack thereof
        //this.currentSteps.push({type, value, "emit": !this.isNested(["path", "filter"])});
        if(!this.isUnderTreeShape(["path", "function"])) {
            _.last(this.currentSteps).push({type, value, "emit": true}); //tree shape like a.$sum(x,y) we cannot count x and y as dependencies because a can be an array that is mapped over
        }

    }

    isNested(ancestors){
        return this.exprStack.reduce((count, curr) =>{
            return ancestors.includes(curr)?count+1:count;
        }, 0) > 1;
    }

    hasParent(parent){
        return _.last(this.exprStack) === parent;
    }

    hasAncestor(ancestors){
        return this.exprStack.reduce((count, curr) =>{
            return ancestors.includes(curr)?count+1:count;
        }, 0) >= 1;
    }

    isUnderTreeShape(path){
        return this.exprStack.reduce((_path, curr) =>{
            if(_path[0] === curr){
                _path.shift(); //if the curr path item is the first element of the _path we remove it from _path
            }
            return _path;
        }, [...path]).length===0; //if 0 then the desired shape existed
    }

    isSingle$Var(type, value) {
        return type === "variable" && value === ""; // $ or $.<whatever> means the variable whose name is empty/"".
    }

    isRootedIn$$(value) {
        const last = _.last(this.currentSteps);
        return last && (last.length === 0 && value === "$"
            || last.length > 0 && last[0].value === "$");
    }



    isInsideAScopeWhere$IsLocal() {
        return this.exprStack.some(type => type === "transform")
    }

    emitPaths() {
        const emitted = [];
        const steps = this.currentSteps.flat();
        const last = _.last(this.currentSteps);
        if(last.length > 0 && last.every(s=>s.emit)){
            steps.forEach(s=>emitted.push(s.value));
        }
        this.currentSteps.pop();

        if(emitted.length > 0){
            this.paths.push(emitted);
        }
    }

}


module.exports = DependencyFinder;

