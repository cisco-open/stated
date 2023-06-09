const jsonata = require('jsonata');
const jp = require('json-pointer');
const _ = require('lodash');
const metaInfoProducer = require('./nodeInfoAnalyzer');
const DependencyFinder=require('./DependencyFinder');

class TemplateProcessor {
    constructor(template) {
        this.output = template; //initial output is input template
        this.input = JSON.parse(JSON.stringify(template));
        this.templateMeta = JSON.parse(JSON.stringify(this.output));// Copy the given template to initialize the templateMeta
    }

    async initialize() {
        let metaInfos = await this.createMetaInfos();
        this.sortMetaInfos(metaInfos);
        this.populateTemplateMeta(metaInfos);
        this.buildDependenciesGraph(metaInfos);
        await this.evaluateDependencies(metaInfos);
    }

    async createMetaInfos() {
        const metaInfProcessor = jsonata(metaInfoProducer);
        let metaInfos = await metaInfProcessor.evaluate(this.input);

        //const compiledPathFinder = jsonata("**[type='path'].[steps.value][]");
        metaInfos = await Promise.all(metaInfos.map(async metaInfo => {
            if (metaInfo.expr__ !== undefined) {
                const depFinder = new DependencyFinder(metaInfo.expr__);
                metaInfo.compiledExpr__  = depFinder.compiledExpression;
                metaInfo.compiledExpr__.assign("path", (path) => { //create the $path(<path>) function
                    if(path){
                        if(!path.match(/(\.\.\/)+/)){
                            throw new Error(`Path ${path} is malformatted`);
                        }
                        const levelsUp = path.split("/").filter(Boolean).length; // so ../../ would be 2 levelsUp
                        const parsedExistingPter = jp.parse(metaInfo.parentJsonPointer__);
                        if(levelsUp > (parsedExistingPter.length)){
                            return undefined;
                        }
                        const absoluteJsonPtr = jp.compile(jp.parse(metaInfo.parentJsonPointer__).slice(0, -levelsUp));
                        if(!jp.has(this.output, absoluteJsonPtr)){
                            return undefined;
                        }
                        return jp.get(this.output, absoluteJsonPtr);
                    }
                    return undefined;
                });
                metaInfo.dependencies__ = depFinder.findDependencies();//await compiledPathFinder.evaluate(metaInfo.compiledExpr__ .ast());
            }
            return metaInfo;
        }));

        return metaInfos;
    }

    sortMetaInfos(metaInfos) {
        metaInfos.sort((a, b) => a.jsonPointer__ < b.jsonPointer__ ? -1 : (a.jsonPointer__ > b.jsonPointer__ ? 1 : 0));
    }

    populateTemplateMeta(metaInfos) {
        metaInfos.forEach(meta => {
            meta.dependencies__ = this.removeLeadingDollarsFromDependencies(meta).map(jp.compile);
            meta.parentJsonPointer__ = jp.compile(meta.jsonPointer__.slice(0, -1));
            meta.jsonPointer__ = jp.compile(meta.jsonPointer__);
            meta.jsonPointer__ !== "" && jp.set(this.templateMeta, meta.jsonPointer__, meta);
        });
    }

    buildDependenciesGraph(metaInfos) {
        metaInfos.forEach(i => {
            i.dependencies__?.forEach(ptr => {
                if (!jp.has(this.templateMeta, ptr)) {
                    jp.set(this.templateMeta, ptr, { "jsonPointer__": ptr, "dependees__": [], "dependencies__": [] });
                }
                jp.get(this.templateMeta, ptr).dependees__.push(i.jsonPointer__);
            });
        });
    }

    async evaluateDependencies(metaInfos) {
        const nodePtrList = this.topologicalSort(metaInfos);
        await this.evaluateJsonPointersInOrder(nodePtrList);
    }


    removeLeadingDollarsFromDependencies(metaInfo) {
        // Extract dependencies__ and jsonPointer__ from metaInfo
        const { dependencies__, } = metaInfo;
        // Iterate through each depsArray in dependencies__ using reduce function
        dependencies__.forEach((depsArray) => {
            const root = depsArray[0];
            if(root === "" || root === "$"){
                depsArray.shift();
            }
        });
        return dependencies__;
    }

    topologicalSort(nodes) {
        const visited = new Set();
        const orderedJsonPointers = [];
        const templateMeta = this.templateMeta;

        function listDependencies(node) {
            visited.add(node.jsonPointer__);

            for (const dependency of node.dependencies__) {
                if (!visited.has(dependency)) {
                    listDependencies(jp.get(templateMeta, dependency));
                }
            }

            orderedJsonPointers.push(node.jsonPointer__);
        }

        if(!(nodes instanceof Set || Array.isArray(nodes))){
            nodes = [nodes];
        }
        // Perform topological sort
        nodes.forEach(node => {
            if (!visited.has(node.jsonPointer__)) {
                listDependencies(node);
            }
        });

        return orderedJsonPointers;
    }
    async setData(jsonPtr, data) {
        //get all the jsonPtrs we need to update, including this one, to percolate the change
        const sortedJsonPtrs = this.getDependentsTransitiveExecutionPlan(jsonPtr);
        await this.evaluateJsonPointersInOrder(sortedJsonPtrs, data); // Evaluate all affected nodes, in optimal evaluation order
    }

    async evaluateJsonPointersInOrder(jsonPtrList, data) {
        const jsonPtr = jsonPtrList.shift(); //first jsonPtr is the target of the change, the rest are dependents
        if(!jp.has(this.output, jsonPtr)){ //node doesn't exist yet, so just create it and return
            await this.evaluateNode(jsonPtr, data);
        }
        // Check if the node contains an expression. If so, print a warning and return.
        const metaInf = jp.get(this.templateMeta, jsonPtr);
        if (metaInf.expr__ !== undefined) {
            console.warn(`Attempted to replace expressions with data under ${jsonPtr}. This operation is ignored.`);
            return;
        }
        const isChanged = await this.evaluateNode(jsonPtr, data); // Evaluate the node provided with the data provided
        if(!isChanged) {
            console.log(`data did not change for ${jsonPtr}, short circuiting dependents.`);
            return false;
        }
        for (const jsonPtr of jsonPtrList) {
            try {
                await this.evaluateNode(jsonPtr);
            } catch (e) {
                console.log(`An error occurred while evaluating dependencies for ${jsonPtr}`);
            }
        }
    }

    async evaluateNode(jsonPtr, data) {
        const templateMeta = this.templateMeta;
        const template = this.output;

        if (!jp.has(templateMeta, jsonPtr)) {
            jp.set(template, jsonPtr, data); //this is just the weird case of setting something into the template that has no affect on any expressions
            return false;
        }
        const { expr__, compiledExpr__, treeHasExpressions__, callback__ , parentJsonPointer__} = jp.get(templateMeta, jsonPtr);
        if (data === undefined) {

            if (typeof expr__ !== 'undefined') {
                try {
                    const target = jp.get(template, parentJsonPointer__); //an expression is always relative to a target
                    data = await compiledExpr__.evaluate(target);
                    this._setData(template, jsonPtr, data, callback__);
                } catch (error) {
                    console.error(`Error evaluating expression at ${jsonPtr}:`, error);
                    data = undefined;
                }
            } else {
                try {
                    data = jp.get(template, jsonPtr);
                } catch (error) {
                    console.log(`The reference with json pointer ${jsonPtr} does not exist`);
                    data = undefined;
                }
            }
        } else {
            if(treeHasExpressions__){
                console.log(`nodes containing expressions cannot be overwritten: ${jsonPtr}`);
                return false;
            }
            const existingData = jp.get(template, jsonPtr);
            if(!_.isEqual(existingData, data)){
                this._setData(template, jsonPtr, data, callback__);
            }else{
                console.log(`data to be set at ${jsonPtr} did not change, ignored. `);
                return false;
            }

        }

        jp.set(templateMeta, jsonPtr + "/data__", data); //saving the data__ in the templateMeta is just for debugging
        return true; //true means that the data was new/fresh/changed and that subsequent updates must be propagated
    }

    _setData(template, jsonPtr, data, callback){
        jp.set(template, jsonPtr, data);
        callback && callback(data, jsonPtr);
    }

    getDependentsTransitiveExecutionPlan(jsonPtr) {
        const effectedNodesSet = this.getDependentsRecursive(jsonPtr);
        //const sortedJsonPtrs = this.topologicalSort(effectedNodesSet);
        return [jsonPtr, ...[...effectedNodesSet].map(n=>n.jsonPointer__)];

    }

    getDependents(jsonPtr){
        if(jp.has(this.templateMeta, jsonPtr)){
            return jp.get(this.templateMeta, jsonPtr).dependees__
        }else{
            return [];
        }
    }

    getDependentsRecursive(jsonPtr, dependees = new Set()) {
        const metaInf = jp.get(this.templateMeta, jsonPtr);
        if (metaInf.dependees__) {
            metaInf.dependees__.forEach(dependee => {
                dependees.add(jp.get(this.templateMeta, dependee));
                this.getDependentsRecursive(dependee, dependees);
            });
        }

        // Get parent node. Ancestors are considered implicit dependents
        let parentPtrParts = jp.parse(jsonPtr);
        parentPtrParts.pop();

        // Only proceed if there are more ancestor nodes to process
        if (parentPtrParts.length > 0) {
            let parentPtr = jp.compile(parentPtrParts);
            // recursively process the parent node
            this.getDependentsRecursive(parentPtr, dependees);
        }

        return dependees;
    }

    getDependencies(jsonPtr){
        if(jp.has(this.templateMeta, jsonPtr)){
            return jp.get(this.templateMeta, jsonPtr).dependencies__
        }
        return [];

    }

    getDependenciesTransitiveExecutionPlan(jsonPtr, data) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            const node = jp.get(this.templateMeta, jsonPtr);
            return this.topologicalSort(node);
        }
        return [];
    }

    setDataChangeCallback(jsonPtr, cbFn){
        if (jp.has(this.templateMeta, jsonPtr)) {
            const node = jp.get(this.templateMeta, jsonPtr);
            node.callback__ = cbFn;
        }
    }

}

module.exports = TemplateProcessor;
