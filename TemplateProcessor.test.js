const TemplateProcessor=require('./TemplateProcessor');
const DependencyFinder = require("./DependencyFinder");

test("test 1", async () => {
    const tp = new TemplateProcessor({
        "a":"aaa",
        "b":"../../${a}"
    });
    await tp.initialize();
    const received = [];
    tp.setDataChangeCallback("", (data, jsonPtr)=>{received.push({data, jsonPtr})});
    tp.setDataChangeCallback("/a", (data, jsonPtr)=>{received.push({data, jsonPtr})});
    tp.setDataChangeCallback("/b", (data, jsonPtr)=>{received.push({data, jsonPtr})});
    await tp.setData("/a", 42);
    expect(received).toEqual([
        {"data":42, "jsonPtr": "/a"},
        {"data":42, "jsonPtr":"/b"}
    ]);
});

test("test 2", async () => {
    const o = {
        "a":{"b":'${c}', "c":100},
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a":{"b":100, "c":100},
    });
});



test("test 2", async () => {
    const o = {
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "${e.f}" //<--- this is an intentionally incorrect reference
        }
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": 10,
        "c": 100,
        "d": 80,
        "e": {
            "f": -1,
            "g": undefined //because e.f is undefined because e is undefined in this expression. Only f and g are targetable form an expression inside e.
        }
    });
});

test("test 3", async () => {
    const o = {
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "${$path('../').e.f}" //$path function allows us to escape the local scope
        }
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": 10,
        "c": 100,
        "d": 80,
        "e": {
            "f": -1,
            "g": -1, //use of $path allows this
        }
    });
});

test("test 4", async () => {
    const o = {
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "${$path('../../').e.f}", //non-existent path,
        }
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": 10,
        "c": 100,
        "d": 80,
        "e": {
            "f": -1,
            "g": undefined,
            "h": -1
        }
    });
});

test("test 5", async () => {
    const o = {
        "a": 10,
        "b": [
            "${$path('../').a}",
        ]
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": [10]
    });
});

test("test 6", async () => {
    const o = [
             10,
            "${$[0]}",
            "${$$[1] + $[0]}"
        ];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([10,10, 20]);
});

test("test 5", async () => {
    const o = {
        "a": 10,
        "b": [
            "${$path('../').a}",
            "${$[0]-5}"
        ]
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": [10,5]
    });
});

test("test 6", async () => {
    const o = {
        "x": "${  k.z~>|$|{'band':true}|}",
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "${e.f*d + h}"
        },
        "h": "${i}",
        "i": 8,
        "j": [
            "${$path('../').c}",
            "${$path('../').d}",
            [
                "${$path('../')[1]}",
                "${$path('../../').j[0]+$[0]}"
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
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "x": {
            "zz": "top",
            "band": true
        },
        "a": 10,
        "b": 10,
        "c": 100,
        "d": 80,
        "e": {
            "f": -1
        },
        "h": 8,
        "i": 8,
        "j": [
            100,
            80,
            [
                80,
                180
            ],
            44,
            "hi"
        ],
        "k": {
            "z": {
                "zz": "top"
            },
            "q": "top"
        },
        "l": [
            100,
            80,
            [
                80,
                180
            ],
            44,
            "hi"
        ]
    });
});


