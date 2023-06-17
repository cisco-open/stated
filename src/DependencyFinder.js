const jsonata = require("jsonata");
const _ = require('lodash');


class DependencyFinder {
    constructor(program) { //second argument is needed when $path() function is in the program
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
                    //this.emitPaths();
                    this.currentSteps.push([]);
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


    collectChildren(node) {
        //any property of node that is not type, value, or position is a child of the node
        return Object.keys(node).filter(k => !["type", "value", "position", "pseudoType"]
            .includes(k)).reduce((acc, k) => {
            const v = node[k];
            if (v) {
                acc.push({...v, "pseudoType": k});
            }

            return acc;
        }, []);
    }

    captureArrayIndexes(node) {
        const {type, expr} = node;
        if (type === "filter" && expr?.type === "number") {
            _.last(this.currentSteps).push({type, "value": expr.value, "emit": expr?.type === "number"});
        }
    }

    capturePathExpressions(node) {
        const {type, value} = node;
        if (type !== "name" && type !== "variable") {
            return;
        }
        if (this.isRootedIn$$(value)) { //if the root of the expression is $$ then we will always accept the navigation downwards
            _.last(this.currentSteps).push({type, value, "emit": true});
            return;
        }
        if (this.isInsideAScopeWhere$IsLocal(node)) { //path expressions inside a transform are ignored modulo the $$ case just checked for above
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
            if (!this.hasParent("function")) { //the function name is actually a variable, we want to skip such variables
                _.last(this.currentSteps).push({type, value, "emit": false});
            }
            return;

        }
        //if we are here then we are dealing with names, which are identifiers like 'a' which can occur in a.b.c or $.a or $$.a or $foo.a, etc
        //The decision to emit a name is made based on its ancestor, or lack thereof
        //this.currentSteps.push({type, value, "emit": !this.isNested(["path", "filter"])});
        if (!this.isUnderTreeShape(["path", "function"])) {
            _.last(this.currentSteps).push({type, value, "emit": true}); //tree shape like a.$sum(x,y) we cannot count x and y as dependencies because a can be an array that is mapped over
        }

    }


    hasParent(parentType) {
        return _.last(this.nodeStack).type === parentType;
    }

    hasAncestor(matcher) {
        return this.nodeStack.some(matcher);
    }

    ancestors(matcher) {
        return this.nodeStack.filter(matcher);
    }

    isUnderTreeShape(pathTypes) {
        return this.nodeStack.reduce((_pathTypes, curr) => {
            if (_pathTypes[0] === curr.type) {
                _pathTypes.shift(); //if the curr path item is the first element of the _pathTypes we remove it from _path
            }
            return _pathTypes;
        }, [...pathTypes]).length === 0; //if 0 then the desired shape existed
    }

    isSingle$Var(type, value) {
        return type === "variable" && value === ""; // $ or $.<whatever> means the variable whose name is empty/"".
    }

    isRootedIn$$(value) {
        const last = _.last(this.currentSteps);
        return last && (last.length === 0 && value === "$"
            || last.length > 0 && last[0].value === "$");
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
        const steps = this.currentSteps.flat();
        const last = _.last(this.currentSteps);
        if (last.length > 0 && last.every(s => s.emit)) {
            if (last[0].value === "$") { //corresponding to '$$' variable
                //in this case the chain of steps must be broken as '$$' is an absolute reference to root document
                last.forEach(s => emitted.push(s.value));
            } else {
                steps.forEach(s => emitted.push(s.value));
            }
        }
        this.currentSteps.pop();

        if (emitted.length > 0) {
            this.paths.push(emitted);
        }
    }

}


module.exports = DependencyFinder;

