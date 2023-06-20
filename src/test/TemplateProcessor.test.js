const TemplateProcessor = require('../TemplateProcessor');
const _ = require('lodash');

test("test 1", async () => {
    const tp = new TemplateProcessor({
        "a": "aaa",
        "b": "${a}"
    });
    await tp.initialize();
    const received = [];
    tp.setDataChangeCallback("", (data, jsonPtr) => {
        received.push({data, jsonPtr})
    });
    tp.setDataChangeCallback("/a", (data, jsonPtr) => {
        received.push({data, jsonPtr})
    });
    tp.setDataChangeCallback("/b", (data, jsonPtr) => {
        received.push({data, jsonPtr})
    });
    await tp.setData("/a", 42);
    expect(received).toEqual([
        {"data": 42, "jsonPtr": "/a"},
        {"data": 42, "jsonPtr": "/b"}
    ]);
});

test("test 2", async () => {
    const o = {
        "a": {
            "b": '${c}',
            "c": 100
        },
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": {"b": 100, "c": 100},
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

test("test 4", async () => {
    const o = {
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "../${e.f}" //$path function allows us to escape the local scope
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

test("test 5", async () => {
    const o = {
        "a": 10,
        "b": 10,
        "c": "${$$.a*b}",
        "d": "${c-a-b}",
        "e": {
            "f": -1,
            "g": "../${e.x}", //non-existent path,
            "h": "../${e.f}"
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
            "g": undefined, //<<--intentional
            "h": -1
        }
    });
});

test("test 6", async () => {
    const o = {
        "a": 10,
        "b": [
            "../${a}",
        ]
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": [10]
    });
});

test("test 7", async () => {
    const o = [
        10,
        "${$[0]}",
        "${$$[1] + $[0]}"
    ];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([10, 10, 20]);
});

test("test 8", async () => {
    const o = {
        "a": 10,
        "b": [
            "../${a}",
            "${$[0]-5}"
        ]
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": [10, 5]
    });
});

test("test 9", async () => {
    const o = {
        "b": {
            "d": -1,
            "c": "../${b.d*a + c}",
        },
        "a": 10,
        "c": "${d}",
        "d": 20
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": {
            "d": -1,
            "c": 10
        },
        "c": 20,
        "d": 20
    });
});

test("test 9.1 - $ refers to the array the expression is in", async () => {
    const o = [7, " ${ $[0]  }"];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([7,7]);
});

test("test 9.1 - allow ../ to back up past root", async () => {
    const o = [7, " ../../../../../../${ $[0]  }"];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([7,7]);
});

test("test 9.1.1", async () => {
    const o = [7, [" ../${ $[0]  }"]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([7,[7]]);
});

test("test 9.1.2", async () => {
    const o = [1, [" ../${ $[0] +  1 }", "${ $[0]+1 }"]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([1,[2, 3]]);
});
test("test 9.1.3", async () => {
    const o = [1, "${ $[2]  }" , [" ../${ $[0]+1  }", "${ $[0] + 1}"]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([1,[2, 3], [2, 3]]);
});
test("test 9.1.4", async () => {
    const o = [1, "${ $[2][2]  }" , ["../${ $[0]+1  }", "${ $[0] + 1}", {"a":{"b":42}}]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([1,{"a":{"b":42}}, [2, 3, {"a":{"b":42}}]]);
});

test("test 9.1.5", async () => {
    const o = {
        "a": [
            [
                10,
                '${ $[0] }'
            ],
        ]
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": [
            [
                10,
                10
            ],
        ]
    });
});

test("test 9.2", async () => {
    const o = {
        "a": 10,
        "b": [
            [
                "../../${a}",
                "${ $[0]+1 }"
            ],
        ]
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": 10,
        "b": [
            [
                10,
                11
            ],
        ]
    });
});

test("test 10", async () => {
    const o = {
        "x": "${  k.z~>|$|{'band':true}|}",
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
            "f": -1,
            "g": 8
        },
        "h": 8,
        "i": 8,
        "j": [
            100,
            80,
            [
                80,
                10
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
                10
            ],
            44,
            "hi"
        ]
    });
});

test("test 11 - test for slash 'rooting'", async () => {
    const o = {
        "a": {
            "b": '/${b}',
            "c": [7, ["/${b}"]]
        },
        "b":42
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": {"b": 42, "c": [7, [42]]},
        "b":42
    });
});


const mysql = {
    "name": "mysql",
    "count": "${[1..30]}",
    "pn": 3306,
    "providerName": "aws",
    "tmp": {
        "host": "/${count.{'database_instance.host':'mysql-instance-' & $ & '.cluster-473653744458.us-west-2.rds.amazonaws.com'}}",
        "port": "/${count.{'database_instance.port:':$$.pn}}",
        "provider": "/${count.{'cloud.provider': $$.providerName}}",
        "instanceId": "/${count.{'cloud.database_instance.id':'db-mysql-instance-' & $formatBase($,16)}}",
        "instanceName": "/${count.{'database_instance.name':'MySQL instance' & $}}",
        "clusterName": "/${count.{'database_instance.cluster._name':'MySQL cluster' & $}}"
    },
    "instances": "${$zip(tmp.host, tmp.port, tmp.provider, tmp.instanceId, tmp.instanceName, tmp.clusterName)~>$map($merge)}"
};

test("mysql output", async () => {
    const o= _.cloneDeep(mysql);
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o.instances[0]).toEqual( {
            "database_instance.host": "mysql-instance-1.cluster-473653744458.us-west-2.rds.amazonaws.com",
            "database_instance.port:": 3306,
            "cloud.provider": "aws",
            "cloud.database_instance.id": "db-mysql-instance-1",
            "database_instance.name": "MySQL instance1",
            "database_instance.cluster._name": "MySQL cluster1"
        }
    );
});

test("mysql plan", async () => {
    const o= _.cloneDeep(mysql);
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(tp.getEvaluationPlan()).toEqual(
        [
            "/count",
            "/tmp/host",
            "/tmp/port",
            "/tmp/provider",
            "/tmp/instanceId",
            "/tmp/instanceName",
            "/tmp/clusterName",
            "/instances"
        ]
    );

});


test("mysql to /tmp/provider", async () => {
    const o= _.cloneDeep(mysql);
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(tp.getDependenciesTransitiveExecutionPlan("/tmp/provider")).toEqual(
        [
            "/providerName",
            "/count",
            "/tmp/provider"
        ]
    );

});




