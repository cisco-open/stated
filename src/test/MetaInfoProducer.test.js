import MetaInfoProducer from '../../dist/src/MetaInfoProducer.js';
import {stringifyTemplateJSON as stringify} from '../../dist/src/utils/stringify.js';


test("tt1", async () => {
    const template = {
        "a": 42,
        "b": "${a}",
        "c": "${'the answer is: '& b}"
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "a",
            "jsonPointer__": [
                "b"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "'the answer is: '& b",
            "jsonPointer__": [
                "c"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});

test("t2", async () => {
    const template = {
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "${e.f}" //<--- this is an intentionally incorrect reference
        }
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "$$.a*b",
            "jsonPointer__": [
                "c"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "c-a-b",
            "jsonPointer__": [
                "d"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "e",
                "f"
            ],
            "materialized__": true,
            "parent__": [
                "e"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [
                "e"
            ],
            "expr__": "e.f",
            "jsonPointer__": [
                "e",
                "g"
            ],
            "materialized__": true,
            "parent__": [
                "e"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "e"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});


test("t3", async () => {
    const template = {
        "x": " @INSTALL ${  k.z~>|$|{'band':true}|}",
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "../${h}"
        },
        "h": "${i}",
        "i": 8,
        "j": [
            "../${c}",
            "../${d}",
            [
                "../${$[1]}",
                "../../${a}"
            ],
            44,
            "hi"
        ],
        "k": {
            "z": {
                "zz": "top"
            },
            "q": "${$.z.zz}"
        },
        "l": "${j}"
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "  k.z~>|$|{'band':true}|",
            "jsonPointer__": [
                "x"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [
                "INSTALL"
            ],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "$$.a*b",
            "jsonPointer__": [
                "c"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "c-a-b",
            "jsonPointer__": [
                "d"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "e",
                "f"
            ],
            "materialized__": true,
            "parent__": [
                "e"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "../",
            "exprTargetJsonPointer__": [
                "e"
            ],
            "expr__": "h",
            "jsonPointer__": [
                "e",
                "g"
            ],
            "materialized__": true,
            "parent__": [
                "e"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "e"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "i",
            "jsonPointer__": [
                "h"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "i"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "../",
            "exprTargetJsonPointer__": [
                "j"
            ],
            "expr__": "c",
            "jsonPointer__": [
                "j",
                0
            ],
            "materialized__": true,
            "parent__": [
                "j"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "../",
            "exprTargetJsonPointer__": [
                "j"
            ],
            "expr__": "d",
            "jsonPointer__": [
                "j",
                1
            ],
            "materialized__": true,
            "parent__": [
                "j"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "../",
            "exprTargetJsonPointer__": [
                "j",
                2
            ],
            "expr__": "$[1]",
            "jsonPointer__": [
                "j",
                2,
                0
            ],
            "materialized__": true,
            "parent__": [
                "j",
                2
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "../../",
            "exprTargetJsonPointer__": [
                "j",
                2
            ],
            "expr__": "a",
            "jsonPointer__": [
                "j",
                2,
                1
            ],
            "materialized__": true,
            "parent__": [
                "j",
                2
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "j",
                2
            ],
            "materialized__": true,
            "parent__": [
                "j"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "j",
                3
            ],
            "materialized__": true,
            "parent__": [
                "j"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "j",
                4
            ],
            "materialized__": true,
            "parent__": [
                "j"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "j"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "k",
                "z",
                "zz"
            ],
            "materialized__": true,
            "parent__": [
                "k",
                "z"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "k",
                "z"
            ],
            "materialized__": true,
            "parent__": [
                "k"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [
                "k"
            ],
            "expr__": "$.z.zz",
            "jsonPointer__": [
                "k",
                "q"
            ],
            "materialized__": true,
            "parent__": [
                "k"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "k"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "j",
            "jsonPointer__": [
                "l"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});

test("temp vars 1", async () => {
    const template = {
        "a":"!${42}",
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "42",
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});

test("temp vars 2", async () => {
    const template = {
        "a":42,
        "b":{
            "b1":10,
            "b2":"!${b1}",
            "b3": "!${b2+10}",
            "b4":{
                "b5":"!../${b3+b2}",
                "b6":"  !  /${b.b3+b.b2}",
                "b7":"  !/${b.b3+b.b2}",
                "b8":" !  ../${b3+b2}",
            },
            "b5!":{ //should be marked as temporary
                "nozzle":42
            }
        },
        "c": "${b4}" //non-existant node reference
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b",
                "b1"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [
                "b"
            ],
            "expr__": "b1",
            "jsonPointer__": [
                "b",
                "b2"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [
                "b"
            ],
            "expr__": "b2+10",
            "jsonPointer__": [
                "b",
                "b3"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "../",
            "exprTargetJsonPointer__": [
                "b",
                "b4"
            ],
            "expr__": "b3+b2",
            "jsonPointer__": [
                "b",
                "b4",
                "b5"
            ],
            "materialized__": true,
            "parent__": [
                "b",
                "b4"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "/",
            "exprTargetJsonPointer__": [
                "b",
                "b4"
            ],
            "expr__": "b.b3+b.b2",
            "jsonPointer__": [
                "b",
                "b4",
                "b6"
            ],
            "materialized__": true,
            "parent__": [
                "b",
                "b4"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "/",
            "exprTargetJsonPointer__": [
                "b",
                "b4"
            ],
            "expr__": "b.b3+b.b2",
            "jsonPointer__": [
                "b",
                "b4",
                "b7"
            ],
            "materialized__": true,
            "parent__": [
                "b",
                "b4"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "../",
            "exprTargetJsonPointer__": [
                "b",
                "b4"
            ],
            "expr__": "b3+b2",
            "jsonPointer__": [
                "b",
                "b4",
                "b8"
            ],
            "materialized__": true,
            "parent__": [
                "b",
                "b4"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b",
                "b4"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b",
                "b5!",
                "nozzle"
            ],
            "materialized__": true,
            "parent__": [
                "b",
                "b5!"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b",
                "b5!"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "b4",
            "jsonPointer__": [
                "c"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});

test("temp vars 3", async () => {
    const template = {
        "a": 42,
        "b": {
            "b1": 10,
            "b2": "!${b1}",
        },
        "c": "!${a}",
        "d!": {
            "b1": 10,
            "b2": "!/${b}",
        }
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b",
                "b1"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [
                "b"
            ],
            "expr__": "b1",
            "jsonPointer__": [
                "b",
                "b2"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "a",
            "jsonPointer__": [
                "c"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "d!",
                "b1"
            ],
            "materialized__": true,
            "parent__": [
                "d!"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": "/",
            "exprTargetJsonPointer__": [
                "d!"
            ],
            "expr__": "b",
            "jsonPointer__": [
                "d!",
                "b2"
            ],
            "materialized__": true,
            "parent__": [
                "d!"
            ],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "d!"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": true,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});

test("blocked paths with ⛔ character 1", async () => {
    const template = {
        "a": 42,
        "⛔b": "Should be ignored",
        "c": "${a}"
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "a",
            "jsonPointer__": [
                "c"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});

test("blocked paths with ⛔ character 2", async () => {
    const template = {
        "a": 42,
        "b": {
            "normal": "value",
            "⛔secret": {
                "nested": "This should be ignored"
            }
        },
        "c": "${a}"
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b",
                "normal"
            ],
            "materialized__": true,
            "parent__": [
                "b"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "b"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "exprRootPath__": null,
            "exprTargetJsonPointer__": [],
            "expr__": "a",
            "jsonPointer__": [
                "c"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": true
        }
    ]);
});

test("blocked paths with ⛔ character in array", async () => {
    const template = {
        "a": 42,
        "arr": [
            "normal",
            "⛔blocked", // This should be included since array indices are numbers, not strings with ⛔
            {
                "⛔key": "blocked object key",
                "normal": "normal object key"
            }
        ]
    };
    const metaInfos = await MetaInfoProducer.getMetaInfos(template);
    expect(JSON.parse(stringify(metaInfos))).toEqual([
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "a"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "arr",
                0
            ],
            "materialized__": true,
            "parent__": [
                "arr"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "arr",
                1
            ],
            "materialized__": true,
            "parent__": [
                "arr"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "arr",
                2,
                "normal"
            ],
            "materialized__": true,
            "parent__": [
                "arr",
                2
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "arr",
                2
            ],
            "materialized__": true,
            "parent__": [
                "arr"
            ],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [
                "arr"
            ],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        },
        {
            "absoluteDependencies__": [],
            "dependees__": [],
            "dependencies__": [],
            "jsonPointer__": [],
            "materialized__": true,
            "parent__": [],
            "tags__": [],
            "temp__": false,
            "treeHasExpressions__": false
        }
    ]);
});



