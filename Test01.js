const jsonata = require('jsonata');
var pointer = require('json-pointer');
const _ = require('lodash');
const {set} = require("lodash/object");

(async () => {


    const template = {

        "a": "${b & '<< a '}",
        "b": "${c.d & '<< b '}",
        "c": {"d":"${ e & '<< c.d' }"},
        "e":null,
        "f":"${a &', ' & b &', ' & c.d & '<< f'}"

    };
 /*
    const template = {
        "name": "AwsRegionMap",
        "vz": "${ name }"
    };

  */
    //note - there isn't any compelling reason to write this xprExtractorProgram in jsonata. It might as well be written
    //in jS but whatever. This program will yank out all the expressions and their json pointers
    const exprExtractorProgram =`(
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
                            : $acc
                )
            }, $acc)
        };
        $getPaths($, [], [])
    )`;
    const exprExtractor = jsonata(exprExtractorProgram);
    const exprs = await exprExtractor.evaluate(template);

    //search expression AST to find path steps (a.b.c)
    const compiledPathFinder = jsonata("**[type='path'].[steps.value][]");
    var exprsWithDeps = await Promise.all(exprs.map(async e => {
        const compiledExpr = jsonata(e.expr__);
        e.dependencies__  = await compiledPathFinder.evaluate(compiledExpr.ast());
        return e;
    }));
    const templateMeta = JSON.parse(JSON.stringify(template));

    //convert paths to json pointers
    exprsWithDeps = exprsWithDeps.map(i=>{
        i.jsonPointer__ = pointer.compile(i.jsonPointer__);
        i.dependencies__ = i.dependencies__.map(d=>{
            return pointer.compile(d)
        });
        pointer.set(templateMeta, i.jsonPointer__, i);
        return i;
    });
    //const template = {"template":input,  "exprs":exprsWithDeps};

    //take original object structure and update each object with this 'meta' information we have gathered
    exprsWithDeps.forEach(i=>{
        i.dependencies__?.forEach(ptr=>{
            var target = pointer.get(templateMeta, ptr);

            if(!(target instanceof Object) || target.jsonPointer__ === undefined){ //if the field had no expression target would be something like "42" or some ordinary object. We need to replace it with one of our bookeepers
                target = {"dependees__":[], "dependencies__":[], "jsonPointer__":ptr};
            }
            target.dependees__.push(i.jsonPointer__);
            pointer.set(templateMeta, ptr, target)
        });
    })

    async function evaluateNode(templateMeta, template, jsonPtr, data) {
        if (!pointer.has(templateMeta, jsonPtr)) { //init the metadata node of needed
            pointer.set(templateMeta, jsonPtr, {"dependees__": [], "dependencies__": [], "jsonPointer__": jsonPtr});
        }
        if (data === undefined) {
            // data was not passed into this node, so we must evaluate the expression
            const {expr__} = pointer.get(templateMeta, jsonPtr);
            if (typeof expr__ !== 'undefined') {
                data = await jsonata(expr__).evaluate(template);
                pointer.set(template, jsonPtr, data); // Set the data into the actual template
            }else{
                data = pointer.get(template, jsonPtr); //get the data from the template, since there is no expression
            }
        }else{
            pointer.set(template, jsonPtr, data);
        }
        pointer.set(templateMeta, jsonPtr + "/data__", data); // Set the data into the meta world (we just keep it here for debugging purpose. It's source of truth remains in the template)
        return pointer.get(templateMeta, jsonPtr);
    }

    const evaluateNodeAndDeps = async function(templateMeta, template, jsonPtr, data) {
        const meta = await evaluateNode(templateMeta, template, jsonPtr, data);

        return Promise.all(meta.dependees__.map(async (jsonPtr) => {
            await evaluateNodeAndDeps(templateMeta, template, jsonPtr); // Await the recursive call to setData
        }));
    };

    await evaluateNodeAndDeps(templateMeta, template, "/e", 42);
    console.log(JSON.stringify(templateMeta, null, 2));

    async function depOrder(templateMeta) {
        const sortedItems = [];
        const visited = new Set();

        function visit(jsonPtr) {
            if (!visited.has(jsonPtr)) {
                visited.add(jsonPtr);
                const dependencies = pointer.get(templateMeta, jsonPtr).dependencies__;
                dependencies.forEach(dependency => visit(dependency));
                sortedItems.push(jsonPtr);
            }
        }

        const ptrs = await jsonata("**[jsonPointer__].jsonPointer__").evaluate(templateMeta);
        ptrs.forEach(ptr => visit(ptr));

        return sortedItems;
    }

    const depOrderedNodePtrs = await depOrder(templateMeta);
    console.log(depOrderedNodePtrs);
    for (const ptr of depOrderedNodePtrs) {
        await evaluateNode(templateMeta, template, ptr);
    }
    console.log(JSON.stringify(templateMeta, null, 2));



})();

