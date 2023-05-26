const jsonata = require('jsonata');

(async () => {

    const input = {

        "a": "${b & '_pulledBy_a'}",
        "b": "${c & '_pulledBy_c'}",
        "c": {"d":"${ 'the magic numbner is ' & e }"},
        "e":42,
        "f":"${a & b & c.d[foo='bar']}"

    };
    //note - there isn't any compelling reason to write this xprExtractorProgram in jsonata. It might as well be written
    //in jS but whatever. This program will yank out all the expressions and their json pointers
    const exprExtractorProgram = "(\n" +
        "    $getPaths := function($o, $acc, $path){\n" +
        "        $spread($o)~>$reduce(function($acc, $item){(\n" +
        "            $k := $keys($item)[0];\n" +
        "            $v := $lookup($item, $k);\n" +
        "            $nextPath := $append($path, $k);           \n" +
        "            $match := /\\s*\\$\\{(.+)\\}\\s*$/($v);\n" +
        "            $count($match) > 0 \n" +
        "                ?$append($acc,{\"expr\":$match[0].groups[0], \"jsonPointer\":$nextPath})                     \n" +
        "                :$type($v)=\"object\"\n" +
        "                  ?$getPaths($v, $acc, $nextPath)\n" +
        "                  :$acc\n" +
        "            )}, $acc)\n" +
        "    };\n" +
        "    $getPaths($, [], [])\n" +
        ")"
    const exprExtractor = jsonata(exprExtractorProgram);
    const exprs = await exprExtractor.evaluate(input);

    const compiledPathFinder = jsonata("**[type='path'].[steps.value]");
    var exprsWithDeps = await Promise.all(exprs.map(async e => {
        const compiledExpr = jsonata(e.expr);
        e.dependencies  = await compiledPathFinder.evaluate(compiledExpr.ast());
        return e;
    }));
    //jam them into a map keyed by path
    exprsWithDeps = exprsWithDeps.reduce((a,i)=>{
        const path = i.jsonPointer.join(".");
        a[path]=i;
        i.dependees = [];
        return a;
    },{})
    const template = {"template":input,  "exprs":exprsWithDeps};
    /* At this point we have a map of structures like this, one for every expression.For each expr, we are keeping
       track of which fields of the object this particular expression depends on. Meaning, when one of these
       dependencies changes, we must rerun our expr
     {
      "expr": "a & b & c.d[foo='bar']",
      "jsonPointer": [
        "f"
      ],
      "dependencies": [
        [
          "a"
        ],
        [
          "b"
        ],
        [
          "c",
          "d"
        ]
      ]
    }
    Now we are going to process all of ^^^ to collect a set of *outgoing* 'dependees'. These are the other fields
    of the object, not that this field depends on, but who depend on this field. In this way, when we change the data
    for this field, we have an immediately accessible list of other fields that we must transit to and recompute.
    */

    exprsWithDeps = Object.keys(exprsWithDeps).reduce((acc, k)=>{
        exprsWithDeps[k].dependencies.forEach(d=>{
            var jsonPointer = d;
            if(Array.isArray(d)){
                jsonPointer = d.join(".");
            }
            if(acc[jsonPointer] != null){
                acc[jsonPointer].dependees.push(jsonPointer)
            }else{
                acc[jsonPointer] = {"dependees":[jsonPointer]}
            }
        });
        return acc;
    }, exprsWithDeps);
    console.log(JSON.stringify(exprsWithDeps, null, 2));

})();

