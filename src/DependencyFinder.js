const _ = require('lodash');
const jsonata = require("jsonata");
const jp = require("json-pointer");

class DependencyFinder {
    constructor(program, metaInfo) { //second argument is needed when $path() function is in the program
        this.compiledExpression = jsonata(program);
        this.ast = this.compiledExpression.ast();
        this.currentSteps = [];
        this.paths = [];
        this.exprStack = [];
        this.pathInterrupts = 0;
        this.metaInfo = metaInfo;
    }

    findDependencies(node = this.ast) {
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
                procedure,
                arguments:args
            } = node;
            this.capturePathExpressions(node)
            this.exprStack.push(type);
            let children;
            switch (type) {
                case "bind":  // :=
                    this.currentSteps = [];
                    break;
                case "transform":
                    children = [{"type": "pattern", pattern}, {"type": "update", update}];
                    break;
                case "path": //a.b.c
                    //paths can happen inside paths. a.b[something].[zz] contains paths within paths
                    //so each time the path is broken we push the current paths and reset it.
                    this.emitPaths();
                    break;
                case "unary":
                case "filter":
                    this.pathInterrupts++;
                    break;
                case "predicate":
                    children = [{"type": "predicate", predicate}];
                    this.pathInterrupts++;
                    break;
                case "stages":
                    children = [{"type": "stages", stages}];
                    this.pathInterrupts++;
                    break;
            }
            //the children above require the special processing above. But then there are all the other
            //children which we deal with and we don't need to write any special code for them.
            children = this.collectChildren(children, node);

            children.forEach(c => {
                this.findDependencies(c);
            });

            //now we are coming out of the recursion, so the swtich below is over the just-finished subtree
            switch (type) {
                //case "pathFunction":
                case "path":
                    this.emitPaths();
                    break;
                case "unary":
                case "filter":
                case "predicate":
                case "stages":
                    this.pathInterrupts--;
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

    capturePathExpressions(node) {
        const {type, value, function:func} = node;
        if (type !== "name" && type !== "variable" && type !== "pathFunction") { // $path(../) must be detected here too
            return;
        }
        if (this.isRootedIn$$(value)) { //if the root of the expression is $$ then we will always accept the navigation downwards
            this.currentSteps.push({type, value, "emit": true});
            return;
        }
        if (this.isInsideAScopeWhere$IsLocal()) { //path expressions inside a transform are ignored modulo the $$ case just checked for above
            this.currentSteps.push({type, value, "emit": false});
            return;
        }
        if (this.isSingle$Var(type, value)) {  //accept the "" variable which comes from single-dollar like $.a.b when we are not inside a transform. We won't accept $foo.a.b
            this.currentSteps.push({type, value, "emit": true});
            return;
        }
        if (type === "variable") {
            //if we are here then the variable must be an ordinary locally named variable since it is neither $$ or $
            this.currentSteps.push({type, value, "emit": false});
        }
        //if we are here then we are dealing with names, which are identifiers like 'a' which can occur in a.b.c or $.a or $$.a or $foo.a, etc
        //The decision to emit a name is made based on its ancestor, or lack thereof
        const ancestor = _.last(this.currentSteps);
        if (ancestor) {
            this.currentSteps.push({type, value, "emit": ancestor.emit && this.pathInterrupts === 0});
        } else {
            this.currentSteps.push({type, value, "emit": this.pathInterrupts === 0});
        }
    }

    isSingle$Var(type, value) {
        return type === "variable" && value === ""; // $ or $.<whatever> means the variable whose name is empty/"".
    }

    isRootedIn$$(value) {
        return this.currentSteps.length === 0 && value === "$"
            || this.currentSteps.length > 0 && this.currentSteps[0].value === "$";
    }



    isInsideAScopeWhere$IsLocal() {
        return this.exprStack.some(type => type === "transform")
    }

    captureRootAndGlobalVariables(type, value) {
        if (type === "variable" && (value === "" || value === "$")) {
            this.paths.push([value])
        }
    }

    emitPaths() {
        let filteredSteps = this.currentSteps.filter(s => s.emit).map(s => s.value);
        if (filteredSteps.length > 0) {
            this.paths.push(filteredSteps);
        }
        this.currentSteps = [];

    }

}


module.exports = DependencyFinder;

