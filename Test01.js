const jsonata = require('jsonata');
const jp = require('json-pointer');

class TemplateProcessor {
    constructor(template) {
        this.template = template;
        this.templateMeta = null;
        this.depOrder = null;
    }

    async initialize() {
        const metaInfProducerJsonataProgram = `(
            $getPaths := function($o, $acc, $path){
                $spread($o)~>$reduce(function($acc, $item){
                    (
                        $k := $keys($item)[0];
                        $v := $lookup($item, $k);
                        $nextPath := $append($path, $k);
                        $match := /\\s*\\$\\{(.+)\\}\\s*$/($v);
                        $count($match) > 0
                            ? $append($acc, { "expr__": $match[0].groups[0], "jsonPointer__": $nextPath, "dependees__": [] })
                            : $type($v)="object"
                                ? $getPaths($v, $acc, $nextPath)
                                : $append($acc, { "jsonPointer__": $nextPath, "dependees__": [], "dependencies__":[], "data__":$v })
                    )
                }, $acc)
            };
            $getPaths($, [], [])
        )`;

        const metaInfProcessor = jsonata(metaInfProducerJsonataProgram);
        let metaInfos = await metaInfProcessor.evaluate(this.template);
        //for each metaInf about a piece of the template, we want to analyze any embedded ${} which we are
        //now storing in expr__, and deduce from its AST which object traversal path steps like 'a.b.c' it took.
        //From these path steps we can infer the dependencies__ of the expression
        const compiledPathFinder = jsonata("**[type='path'].[steps.value][]");
        metaInfos= await Promise.all(metaInfos.map(async e => { //map over the metaInfos and fill in their dependencies
            if(e.expr__ !== undefined) {
                const compiledExpr = jsonata(e.expr__);
                e.dependencies__ = await compiledPathFinder.evaluate(compiledExpr.ast());
            }
            return e;
        }));

        //copy the given template
        this.templateMeta = JSON.parse(JSON.stringify(this.template));
        //place each meta data about each field into templateMeta replacing it's "real" peer that came from template
        //and producing true jsonPointers from what had been just arrays of individual path segments
        metaInfos.forEach(meta => {
            meta.jsonPointer__ = jp.compile(meta.jsonPointer__);
            meta.dependencies__ = meta.dependencies__.map(d => jp.compile(d));
            jp.set(this.templateMeta, meta.jsonPointer__, meta);
        });
        //for each dependency we can find the thing it depends on and push onto its dependees. We now have a graph
        //in which each metaInfo holds a list of whom it needs to get data from (dependencies__) as well as whom it
        //needs to push data to (dependees__) when its data__ changes. At runtime we don't use the dependencies__.
        //these were just a necessary means to compute the dependees__
        metaInfos.forEach(i =>
            i.dependencies__?.forEach(ptr =>{
                //dependency in an expression on an as-yet non-existant node we just create that metaIfo node
                if(!jp.has(this.templateMeta, ptr)){
                    jp.set(this.templateMeta, ptr, { "jsonPointer__": ptr, "dependees__": [], "dependencies__":[]})
                }
                //now we can update the metaInfo node with it's detected dependendee
                jp.get(this.templateMeta, ptr).dependees__.push(i.jsonPointer__);
            })
        );

        async function evaluateNode(templateMeta, template, jsonPtr, data) {
            if (!jp.has(templateMeta, jsonPtr)) {
                throw Error("the templateMeta was missing " + jsonPtr);
            }
            if (data === undefined) { //we must be intending to just evaluate an expression in this node
                const { expr__ } = jp.get(templateMeta, jsonPtr);
                if (typeof expr__ !== 'undefined') {
                    data = await jsonata(expr__).evaluate(template); //we have an expression, run it against the template
                    jp.set(template, jsonPtr, data);
                } else {
                    data = jp.get(template, jsonPtr);
                }
            } else {
                jp.set(template, jsonPtr, data);
            }
            jp.set(templateMeta, jsonPtr + "/data__", data); //keeping data__ in templateMeta is really just for debugging
            return jp.get(templateMeta, jsonPtr);
        }

        this.evaluateNode = evaluateNode;

        async function evaluateNodeAndDeps(templateMeta, template, jsonPtr, data) {
            const meta = await evaluateNode(templateMeta, template, jsonPtr, data);
            const queue = [jsonPtr];
            const visited = new Set();

            while (queue.length > 0) {
                const currentJsonPtr = queue.shift();
                visited.add(currentJsonPtr);
                const currentMeta = jp.get(templateMeta, currentJsonPtr);

                for (const dependee of currentMeta.dependees__) {
                    if (!visited.has(dependee)) {
                        await evaluateNode(templateMeta, template, dependee);
                        queue.push(dependee);
                        visited.add(dependee);
                    }
                }
            }
        }

        this.evaluateNodeAndDeps = evaluateNodeAndDeps;

        async function depOrder(templateMeta) {
            const sortedItems = [];
            const visited = new Set();

            function visit(jsonPtr) {
                if (!visited.has(jsonPtr)) {
                    visited.add(jsonPtr);
                    const meta = jp.get(templateMeta, jsonPtr);
                    if(meta.dependencies__.length === 0){
                        sortedItems.push(">>>>");
                    }
                    const dependencies = meta.dependencies__;
                    dependencies.forEach(dependency => visit(dependency));
                    sortedItems.push(jsonPtr);
                }
            }

            const ptrs = await jsonata("**[jsonPointer__].jsonPointer__").evaluate(templateMeta);
            ptrs.forEach(ptr => visit(ptr));

            return sortedItems;
        }

        this.depOrder = await depOrder(this.templateMeta);
        console.log("depOrder is " + this.depOrder);
    }

    async setData(jsonPtr, data) {
        await this.evaluateNodeAndDeps(this.templateMeta, this.template, jsonPtr, data);
        console.log(JSON.stringify(this.templateMeta, null, 2));
    }
}

const template = {
    "a": "${b & '<< a '}",
    "b": "${c.d & '<< b '}",
    "c": { "d": "${ e & '<< c.d' }" }, //intentionally reference 'e', an as-yet non existent node
    "f": "${'['& a &', ' & b &', ' & c.d & ']<< f'}",
    "g": 10,
    "h": "${'g=' & g & ', c='& c}"
};

(async () => {
    const templateProcessor = new TemplateProcessor(template);
    await templateProcessor.initialize();
    await templateProcessor.setData("/e", 42);
})();
