const jsonata = require('jsonata');
const jp = require('json-pointer');

class TemplateProcessor {
    constructor(template) {
        this.output = template;
        this.templateMeta = null;
        this.depOrder = null;
        this.input = JSON.parse(JSON.stringify(template));;
    }

    async initialize() {
        const metaInfProducerJsonataProgram = `( $getPaths := function($o, $acc, $path){
                $spread($o)~>$reduce(function($acc, $item){
                    (
                        $k := $keys($item)[0];
                        $v := $lookup($item, $k);
                        $nextPath := $append($path, $k);
                        $match := /\\s*\\$\\{(.+)\\}\\s*$/($v); 
                        $count($match) > 0
                            ? $append($acc, { "expr__": $match[0].groups[0], "jsonPointer__": $nextPath, "dependees__": []})
                            : $type($v)="object"
                                ? $getPaths($v, $append($acc, { "jsonPointer__": $nextPath, "dependees__": [], "dependencies__":[]}), $nextPath)
                                : $append($acc, { "jsonPointer__": $nextPath, "dependees__": [], "dependencies__":[], "data__":$v } )
                    )
                }, $acc)
            }; 
            $getPaths($, [], []); 
        )`;

        const metaInfProcessor = jsonata(metaInfProducerJsonataProgram);
        let metaInfos = await metaInfProcessor.evaluate(this.output);

        // For each metaInf about a piece of the template, analyze any embedded ${} and deduce the object traversal path steps like 'a.b.c' it took.
        // These are the dependencies__ of the expression
        const compiledPathFinder = jsonata("**[type='path'].[steps.value][]");
        metaInfos = await Promise.all(metaInfos.map(async e => {
            if (e.expr__ !== undefined) {
                const compiledExpr = jsonata(e.expr__);
                e.dependencies__ = await compiledPathFinder.evaluate(compiledExpr.ast());
            }
            return e;
        }));

        // Copy the given template
        this.templateMeta = JSON.parse(JSON.stringify(this.output));

        // Place each meta data about each field into templateMeta, replacing its "real" peer that came from the template.
        // Also, produce true jsonPointers from what had been just arrays of individual path segments.
        metaInfos.forEach(meta => {
            meta.jsonPointer__ = jp.compile(meta.jsonPointer__);
            meta.dependencies__ = meta.dependencies__.map(d => jp.compile(d));
            jp.set(this.templateMeta, meta.jsonPointer__, meta);
        });

        // For each dependency, find the thing it depends on and push onto its dependees. Now we have a graph in which each metaInfo
        // holds a list of whom it needs to get data from (dependencies__) as well as whom it needs to push data to (dependees__)
        // when its data__ changes.
        metaInfos.forEach(i => {
            i.dependencies__?.forEach(ptr => {
                // Dependency in an expression on an as-yet nonexistent node, so create that metaInfo node
                if (!jp.has(this.templateMeta, ptr)) {
                    jp.set(this.templateMeta, ptr, { "jsonPointer__": ptr, "dependees__": [], "dependencies__": [] });
                }
                // Now update the metaInfo node with its detected dependee
                jp.get(this.templateMeta, ptr).dependees__.push(i.jsonPointer__);
            });
        });

        // Evaluate the dependencies
        const nodePtrList = this.topologicalSort(metaInfos);

        // Evaluate the expressions in the correct order using a for loop
        await this.evaluateJsonPointersInOrder(nodePtrList);
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
            return;
        }

        if (data === undefined) {
            const { expr__ } = jp.get(templateMeta, jsonPtr);

            if (typeof expr__ !== 'undefined') {
                try {
                    data = await jsonata(expr__).evaluate(template);
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
            jp.set(template, jsonPtr, data);
        }

        jp.set(templateMeta, jsonPtr + "/data__", data);
        return jp.get(templateMeta, jsonPtr);
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
        await this.evaluateNode(jsonPtr, data); // Evaluate the node provided
        await this.evaluateJsonPointersInOrder(sortedJsonPtrs); // Evaluate all other affected nodes, in optimal evaluation order
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

        // Get parent node
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
        }else{
            return [];
        }
    }
    /*
    getDependenciesRecursive(jsonPtr, visited = new Set()) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            const dependencies = jp.get(this.templateMeta, jsonPtr).dependencies__;
            const recursiveDependencies = [];

            for (const dependency of dependencies) {
                if (!visited.has(dependency)) {
                    visited.add(dependency);
                    const subDependencies = this.getDependenciesRecursive(dependency, visited);
                    recursiveDependencies.push(...subDependencies);
                }
            }

            return [...dependencies, ...recursiveDependencies];
        }

        return [];
    }

     */
    getDependenciesTransitiveExecutionPlan(jsonPtr, data) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            const node = jp.get(this.templateMeta, jsonPtr);
            return this.topologicalSort(node);
        }
        return sortedJsonPtrs;
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
