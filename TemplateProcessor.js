const jsonata = require('jsonata');
const jp = require('json-pointer');
const _ = require('lodash');
const metaInfoProducer = require('./nodeInfoAnalyzer');

class TemplateProcessor {
    constructor(template) {
        this.output = template; //initial output is input template
        this.input = JSON.parse(JSON.stringify(template));
        this.templateMeta = JSON.parse(JSON.stringify(this.output));// Copy the given template to initialize the templateMeta
    }

    async initialize() {
        let metaInfos = await this.processMetaInfos();
        this.sortMetaInfos(metaInfos);
        this.populateTemplateMeta(metaInfos);
        this.buildDependenciesGraph(metaInfos);
        await this.evaluateDependencies(metaInfos);
    }

    async processMetaInfos() {
        const metaInfProcessor = jsonata(metaInfoProducer);
        let metaInfos = await metaInfProcessor.evaluate(this.output);

        const compiledPathFinder = jsonata("**[type='path'].[steps.value][]");
        metaInfos = await Promise.all(metaInfos.map(async e => {
            if (e.expr__ !== undefined) {
                e.compiledExpr__  = jsonata(e.expr__);
                e.dependencies__ = await compiledPathFinder.evaluate(e.compiledExpr__ .ast());
            }
            return e;
        }));

        return metaInfos;
    }

    sortMetaInfos(metaInfos) {
        metaInfos.sort((a, b) => a.jsonPointer__ < b.jsonPointer__ ? -1 : (a.jsonPointer__ > b.jsonPointer__ ? 1 : 0));
    }

    populateTemplateMeta(metaInfos) {
        metaInfos.forEach(meta => {
            meta.dependencies__ = this.convertDollarsToAbsoluteJsonPointer(meta).map(jp.compile);
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


    convertDollarsToAbsoluteJsonPointer(metaInfo) {
        // Extract dependencies__ and jsonPointer__ from metaInfo
        const { dependencies__, jsonPointer__ } = metaInfo;

        // Iterate through each depsArray in dependencies__ using reduce function
        return dependencies__.reduce((result, depsArray) => {
            // Create a new array by mapping depsArray. If element is "", replace it with the parent json pointer
            // If element is not "$", add it as is.
            const mappedValues = depsArray.reduce((acc, d) => {
                if (d === "") { // for some reason Jsonata compiler converts $ to ""
                    acc.push(...jsonPointer__.slice(0, -1));
                } else if (d !== "$") { // ...and $$ to $ in path steps
                    acc.push(d);
                }
                return acc;
            }, []);

            // Push mappedValues to the result and return
            result.push(mappedValues);
            return result;
        }, []);
    }



    async evaluateJsonPointersInOrder(jsonPtrList) {
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
        const { expr__, compiledExpr__, treeHasExpressions__ } = jp.get(templateMeta, jsonPtr);
        if (data === undefined) {

            if (typeof expr__ !== 'undefined') {
                try {
                    data = await compiledExpr__.evaluate(template);
                    jp.set(template, jsonPtr, data);
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
                jp.set(template, jsonPtr, data);
            }else{
                console.log(`data added to ${jsonPtr} did not change. Data flow will be short circuited.`);
                return false;
            }

        }

        jp.set(templateMeta, jsonPtr + "/data__", data);
        return true; //true means that the data was new/fresh/changed and that subsequent updates must be propagated
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
        if(!jp.has(this.output, jsonPtr)){ //node doesn't exist yet, so just create it and return
            await this.evaluateNode(jsonPtr, data);
            return;
        }
        // Check if the node contains an expression. If so, print a warning and return.
        const metaInf = jp.get(this.templateMeta, jsonPtr);
        if (metaInf.expr__ !== undefined) {
            console.warn(`Attempted to set data on a node that contains an expression at ${jsonPtr}. This operation is ignored.`);
            return;
        }
        const sortedJsonPtrs = this.getDependentsTransitiveExecutionPlan(jsonPtr, data);
        const isChanged = await this.evaluateNode(jsonPtr, data); // Evaluate the node provided with the data provided
        if(isChanged) {
            await this.evaluateJsonPointersInOrder(sortedJsonPtrs); // Evaluate all other affected nodes, in optimal evaluation order
        }
    }

    getDependentsTransitiveExecutionPlan(jsonPtr, data) {
        const effectedNodesSet = this.getDependentsRecursive(jsonPtr);
        //const sortedJsonPtrs = this.topologicalSort(effectedNodesSet);
        return [...effectedNodesSet].map(n=>n.jsonPointer__);
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

}
/*
const template = {
    "a": "${b & '<< a '}",
    "b": "${c.d & '<< b '}",
    "c": { "d": "${ e & '<< c.d' }" }, // intentionally referencing 'e', an as-yet non-existent node
    "f": "${'['& a &', ' & b &', ' & c.d & ']<< f'}",
    "g": 10,
    "h": "${'g=' & g & ', c='& c}",

};

(async () => {
    const templateProcessor = new TemplateProcessor(template);
    await templateProcessor.initialize();
    await templateProcessor.setData("/e", 42);
    console.log(JSON.stringify(templateProcessor.templateMeta, null, 2));
})();

 */
module.exports = TemplateProcessor;
