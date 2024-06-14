// Copyright 2023 Cisco Systems, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import TemplateProcessor from '../../dist/src/TemplateProcessor.js';
import cloneDeep from 'lodash-es/cloneDeep.js';
import largeResources from './large.js';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {fileURLToPath} from 'url';
import {dirname} from 'path';
import DependencyFinder from "../../dist/src/DependencyFinder.js";
import jsonata from "jsonata";
import { default as jp } from "../../dist/src/JsonPointer.js";
import {expect} from "@jest/globals";


test("test 1", async () => {
    const tp = new TemplateProcessor({
        "a": "aaa",
        "b": "${a}",
        "removeMe":"!${'I better get removed because I am temporary variable'}"
    });
    let theTempvar = "--";
    tp.postInitialize = async ()=>{ theTempvar = tp.output.removeMe}
    await tp.initialize();
    //validate thaat postInitialize call happens before temp var removal
    expect(theTempvar).toBe('I better get removed because I am temporary variable');
    const received = [];
    tp.setDataChangeCallback("/a", (data, jsonPtr) => {
        received.push({data, jsonPtr})
    });
    tp.setDataChangeCallback("/b", (data, jsonPtr) => {
        received.push({data, jsonPtr})
    });
    tp.setDataChangeCallback("/", (data, jsonPtr) => {
        received.push(JSON.parse(JSON.stringify({data, jsonPtr}))); //create immutable snapshot of output
    });
    await tp.setData("/a", 42);
    //the temporary variable is not seen by root data change callback
    expect(received).toEqual([
        {
            "data": 42,
            "jsonPtr": "/a"
        },
        {
            "data": 42,
            "jsonPtr": "/b"
        },
        {
            "data": {
                "a": 42,
                "b": 42
            },
            "jsonPtr": [
                "/a",
                "/b"
            ]
        }
    ]);
    received.length = 0; //clear
    //set the same data, expect plan to short circuit and not call callbacks
    await tp.setData("/a", 42);
    expect(received).toEqual([]);
    //now we change data to 2600 we expect callbacks to be called
    await tp.setData("/a", 2600);
    expect(received).toEqual([
        {
            "data": 2600,
            "jsonPtr": "/a"
        },
        {
            "data": 2600,
            "jsonPtr": "/b"
        },
        {
            "data": {
                "a": 2600,
                "b": 2600
            },
            "jsonPtr": [
                "/a",
                "/b"
            ]
        }
    ]);
    received.length = 0; //clear received
    //now we change data to empty string we expect callbacks to be called
    await tp.setData("/a", "");
    expect(received).toEqual([
        {
            "data": "",
            "jsonPtr": "/a"
        },
        {
            "data": "",
            "jsonPtr": "/b"
        },
        {
            "data": {
                "a": "",
                "b": ""
            },
            "jsonPtr": [
                "/a",
                "/b"
            ]
        }
    ]);
    //now we test the ability to receive callbacks even when the data has not changed
    tp.options.receiveNoOpCallbacksOnRoot = true;
    received.length = 0; //clear received
    //now we set a to same value, but since we opted to receive NoOp callbacks, we expect the callback anyway
    await tp.setData("/a", "");
    expect(received).toEqual([
        {
            "data": {
                "a": "",
                "b": ""
            },
            "jsonPtr": [
                "/a",
                "/b"
            ]
        }
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
    expect(o).toEqual([7, 7]);
});

test("test 9.1 - allow ../ to back up past root", async () => {
    const o = [7, " ../../../../../../${ $[0]  }"];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([7, 7]);
});

test("test 9.1.1", async () => {
    const o = [7, [" ../${ $[0]  }"]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([7, [7]]);
});

test("test 9.1.2", async () => {
    const o = [1, [" ../${ $[0] +  1 }", "${ $[0]+1 }"]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([1, [2, 3]]);
});
test("test 9.1.3", async () => {
    const o = [1, "${ $[2]  }", [" ../${ $[0]+1  }", "${ $[0] + 1}"]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([1, [2, 3], [2, 3]]);
});
test("test 9.1.4", async () => {
    const o = [1, "${ $[2][2]  }", ["../${ $[0]+1  }", "${ $[0] + 1}", {"a": {"b": 42}}]];
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual([1, {"a": {"b": 42}}, [2, 3, {"a": {"b": 42}}]]);
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
        "b": 42
    };
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o).toEqual({
        "a": {"b": 42, "c": [7, [42]]},
        "b": 42
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
    const o = cloneDeep(mysql);
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(o.instances[0]).toEqual({
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
    const o = cloneDeep(mysql);
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    const plan = await tp.getEvaluationPlan();
    expect(plan).toEqual(
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
    const o = cloneDeep(mysql);
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    const deps = tp.to("/tmp/provider");
    expect(deps).toEqual(
        [
            "/providerName",
            "/count",
            "/tmp/provider"
        ]
    );

});

// test default functions does not include set
test("default functions", async () => {
    expect(TemplateProcessor.DEFAULT_FUNCTIONS['set']).toBeUndefined();
    const o = cloneDeep(mysql);
    const tp = new TemplateProcessor(o);
    await tp.initialize();
    expect(TemplateProcessor.DEFAULT_FUNCTIONS['set']).toBeUndefined();
})


test("nested arrays", async () => {
        const o = {
            "spec": {
                "count": 0,
                "increment": "function($state) { { \"count\": $state.count+1 } }",
                "decrement": "function($state) { { \"count\": $state.count-1 } }",
                "return": [
                    [
                        "div",
                        {
                            ".": "App"
                        },
                        [
                            "h2",
                            {},
                            "/${ spec.count }"
                        ]
                    ]
                ]
            }
        };
        const tp = new TemplateProcessor(o);
        await tp.initialize();
        expect(tp.output).toEqual(
            {
                "spec": {
                    "count": 0,
                    "decrement": "function($state) { { \"count\": $state.count-1 } }",
                    "increment": "function($state) { { \"count\": $state.count+1 } }",
                    "return": [
                        [
                            "div",
                            {
                                ".": "App"
                            },
                            [
                                "h2",
                                {},
                                0
                            ]
                        ]
                    ]
                }
            }
        );
    }
);

test("fetch", async () => {
    const tp = await TemplateProcessor.load({
        "url": 'https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/foobar.json',
        "bar": "${data.foo}",
        "respHandler": "${ function($res){$res.ok? $res.json()~> |props|{'yo':'there', 'zoink':'zing'}|:{'error': $res.status}} }",
        "data": "${ $fetch(url) ~> respHandler }",
        "expectedError": "${$fetch(url&'breakme') ~> respHandler }"
    });
    delete tp.output["respHandler"];
    expect(tp.output).toEqual(
        {
            "bar": "bar",
            "data": {
                "baz": "zap",
                "foo": "bar",
                "props": {
                    "koink": {
                        "dingus": "doink",
                        "nozzle": "bingus"
                    },
                    "yo": "there",
                    "zoink": "zing"
                }
            },
            "expectedError": {
                "error": 404
            },
            "url": "https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/foobar.json"
        }
    );

});

test("big data block", async () => {
    const tp = new TemplateProcessor({
        "foo": "${data.a.b.c}",
    });
    await tp.initialize();
    await tp.setData("/data", {"a": {"b": {"c": {"bing": 1, "bang": 2, "boom": 3}}}});

    expect(tp.output).toEqual({
            "data": {
                "a": {
                    "b": {
                        "c": {
                            "bang": 2,
                            "bing": 1,
                            "boom": 3
                        }
                    }
                }
            },
            "foo": {
                "bang": 2,
                "bing": 1,
                "boom": 3
            }
        }
    );

});
test("big data block 2", async () => {
    const tp = new TemplateProcessor({
        "foo": "${data.a}",
    });
    await tp.initialize();
    await tp.setData("/data", {
        "a": {
            "b": {
                "c": {
                    "bang": 2,
                    "bing": 1,
                    "boom": 3
                }
            }
        }
    });
    expect(tp.output).toEqual({
            "data": {
                "a": {
                    "b": {
                        "c": {
                            "bang": 2,
                            "bing": 1,
                            "boom": 3
                        }
                    }
                }
            },
            "foo": {
                "b": {
                    "c": {
                        "bang": 2,
                        "bing": 1,
                        "boom": 3
                    }
                }
            }
        }
    );

});

test("big data block 3", async () => {
    const tp = new TemplateProcessor({
        "foo": "${data}",
    });
    await tp.initialize();
    await tp.setData("/data", {"a": {"b": {"c": {"bing": 1, "bang": 2, "boom": 3}}}});

    expect(tp.output).toEqual({
            "data": {
                "a": {
                    "b": {
                        "c": {
                            "bang": 2,
                            "bing": 1,
                            "boom": 3
                        }
                    }
                }
            },
            "foo": {
                "a": {
                    "b": {
                        "c": {
                            "bang": 2,
                            "bing": 1,
                            "boom": 3
                        }
                    }
                }
            }
        }
    );

});

test("set 0", async () => {
    const tp = await TemplateProcessor.load(
        {
            "data": {
                "a": {
                    "b": {
                        "c": {
                            "bang": "${bing+1}",
                            "bing": 1,
                            "boom": "${bang+1}"
                        }
                    }
                }
            },
            "foo": {
                "bang": "${ $set('/data/a/b/c/bing', 42) }",
                "bing": 1,
                "boom": 3
            },
            "bar": "${data.a}"
        });
    expect(tp.from('/data/a/b/c/bing')).toStrictEqual([
        "/data/a/b/c/bing",
        "/data/a/b/c/bang",
        "/data/a/b/c/boom",
        "/bar"
    ]);
    expect(tp.output).toEqual(
        {
            "bar": {
                "b": {
                    "c": {
                        "bang": 43,
                        "bing": 42,
                        "boom": 44
                    }
                }
            },
            "data": {
                "a": {
                    "b": {
                        "c": {
                            "bang": 43,
                            "bing": 42,
                            "boom": 44
                        }
                    }
                }
            },
            "foo": {
                "bang": [
                    "/data/a/b/c/bing",
                    "/data/a/b/c/bang",
                    "/data/a/b/c/boom",
                    "/bar"
                ],
                "bing": 1,
                "boom": 3
            }
        });
});


test("circular", async () => {
    const tp = new TemplateProcessor({
        "a": "${b}",
        "b": "${c}",
        "c": "${a}"
    });
    await tp.initialize();
    expect(tp.warnings).toEqual(
        ["🔃 Circular dependency  /a → /b → /c → /a"]
    );

});

test("import 0", async () => {
    const tp = new TemplateProcessor({
        "a": "${'hello A'}"
    });
    await tp.initialize();
    await tp.import("${ 'hello B' }", "/b")
    expect(tp.output).toEqual(
        {
            "a": "hello A",
            "b": "hello B"
        }
    );
});
test("import 1", async () => {
    const tp = new TemplateProcessor({
        "a": "${'hello A'}"
    });
    await tp.initialize();
    await tp.import({
        "b1": "${ 'hello B' }",
        "b2": 42
    }, "/b")
    expect(tp.output).toEqual(
        {
            "a": "hello A",
            "b": {
                "b1": "hello B",
                "b2": 42
            }
        }
    );
});

test("import 2", async () => {
    const tp = new TemplateProcessor({
        "a": "${'hello A'}"
    });
    await tp.initialize();
    await tp.import({
        "b1": "${ 'hello B' }",
        "b2": 42,
        "b3": "//${a}",
        "b4": "../${a}"
    }, "/b")
    expect(tp.output).toEqual(
        {
            "a": "hello A",
            "b": {
                "b1": "hello B",
                "b2": 42,
                "b3": "hello A",
                "b4": "hello A"
            }
        }
    );
    await tp.import({
        "b1": "${ 'hello B NEW STUFF' }",
        "b2": 42,
        "b3": "//${a & ' NEW STUFF'}",
        "b4": "../${a & ' NEW STUFF'}"
    }, "/b")
    expect(tp.output).toEqual(
        {
            "a": "hello A",
            "b": {
                "b1": "hello B NEW STUFF",
                "b2": 42,
                "b3": "hello A NEW STUFF",
                "b4": "hello A NEW STUFF"
            }
        }
    );
});

test("import simple template strings", async () => {
    const tp = new TemplateProcessor({
        "a": "${'A'}",
        "b": `\${\$import('\${[a,"B"]~>\$join(" ")}')}`, //test literal import of raw template string
        "x":{
            "c":"C"
        }
    });
    await tp.initialize();
    expect(tp.output).toEqual(
        {
            "a": "A",
            "b": "A B",
            "x":{
                "c":"C"
            }
        }
    );
    //test *injecting* a literal expression moustache string into '/d'
    await tp.setExpression(`/\${[b,x.c,'D']~>\$join(' ')}`, '/d');
    expect(tp.output).toEqual(
        {
            "a": "A",
            "b": "A B",
            "d": "A B C D",
            "x":{
                "c":"C"
            }
        }
    );
    //re-import same thing, make sure that's not a problem
    await tp.setExpression(`/\${[b,x.c,'D']~>\$join(' ')}`, '/d');
    expect(tp.output).toEqual(
        {
            "a": "A",
            "b": "A B",
            "d": "A B C D",
            "x":{
                "c":"C"
            }
        }
    );
    //import nested deeper
    await tp.setExpression(`../../\${a}`, '/x/y');
    expect(tp.output).toEqual(
        {
            "a": "A",
            "b": "A B",
            "d": "A B C D",
            "x":{
                "c":"C",
                "y": "A"
            }
        }
    );
    await tp.setExpression('//${x.y}', '/x/z');
    expect(tp.output).toEqual(
        {
            "a": "A",
            "b": "A B",
            "d": "A B C D",
            "x":{
                "c":"C",
                "y": "A",
                "z": "A"
            }
        }
    );

});

test("context", async () => {
    const nozzle = (something) => "nozzle got some " + something;
    const context = {"nozzle": nozzle, "ZOINK": "ZOINK"}
    const tp = new TemplateProcessor({
        "a": "${$nozzle($ZOINK)}"
    }, context);
    await tp.initialize();
    expect(tp.output).toEqual(
        {
            "a": "nozzle got some ZOINK",
        }
    );
});

test("pass function as parameter", async () => {

    const tp = new TemplateProcessor({
        "a": 42,
        "b": "${a}",
        "c": "${'the answer is: '& b}",
        "increment": "${ function($f) { ($set('/a', a+$f()); a) } }",
    });
    await tp.initialize();
    await tp.output.increment.apply(this, [() => {
        return 3;
    }]);
    expect(tp.output.a).toEqual(45);
});

test("chuck data", async () => {

    const tp = new TemplateProcessor({
        "props": {
            "token": "ws0d-2rkn-23kl-klwej"
        },
        "view": [
            [
                "div",
                {},
                "/${ data.chuck.data.value }"
            ]
        ]
    });
    await tp.initialize();
    await tp.setData("/data", {
        chuck: {
            data: {
                value: "are you serious?!"
            }
        }
    });
    expect(tp.output.view[0][2]).toEqual("are you serious?!");
});

test("large resources", async () => {
    const tp = new TemplateProcessor(largeResources);
    await tp.initialize();
    expect(tp.output.metrics[0].resources).toEqual(largeResources.resources[0]);
});
test("string in context", async () => {
    let template = {"Aela": "${$title}"};
    let context = {"title": "The Huntress"};
    const tp = new TemplateProcessor(template, context);
    await tp.initialize();
    expect(tp.output).toStrictEqual({"Aela": "The Huntress"})
});

test("annotations", async () => {
    const o = {
        "a": 42,
        "b": "@DEV ${'if we are developing, then ' & a}",
        "c": "${a}", //no @DEV tag so this won't execute,
        "d": "  @DING    ${b}"
    };
    const tp = new TemplateProcessor(o);
    tp.tagSet.add("DEV").add("DING");
    await tp.initialize();
    expect(o).toEqual({
        "a": 42,
        "b": "if we are developing, then 42",
        "c": "${a}",
        "d": "if we are developing, then 42"
    });
});

test("Solution Environment Files", async () => {
    //define two possible environment configurations
    const env1 = {
        "a": 42,
        "msg": "I am env1",
        "tag": "env1"
    };

    const env2 = {
        "a": 24,
        "msg": "I am env2",
        "tag": "env2"
    };
    const envs = [env1, env2];
    //randomly choose one of them
    const indexToUse = Math.floor(Math.random() * 2);
    const whichEnvToUse = envs[indexToUse];

    const template = {
        "somethingAtInstallTime": "@INSTALL ${$env.msg}",
        "somethingElseAtInstallTime": "${ somethingAtInstallTime & '...somethingElseAtInstallTime'}",
        "somethingDependsOnInstall": "${somethingAtInstallTime &  '...sure' }",
        "somethingInCodex": "@CODEX ${'hi from codex'}",
        "somethingInDashboard": "@DASHBOARD ${'hi from dashboards'}"
    };

    const tp = new TemplateProcessor(template, {env: whichEnvToUse});
    tp.tagSet.add("INSTALL");
    await tp.initialize();
    let expected;
    if (indexToUse === 0) {
        expected = {
            "somethingAtInstallTime": "I am env1",
            "somethingDependsOnInstall": "I am env1...sure",
            "somethingElseAtInstallTime": "I am env1...somethingElseAtInstallTime",
            "somethingInCodex": "@CODEX ${'hi from codex'}",
            "somethingInDashboard": "@DASHBOARD ${'hi from dashboards'}"
        }
    } else {
        expected = {
            "somethingAtInstallTime": "I am env2",
            "somethingDependsOnInstall": "I am env2...sure",
            "somethingElseAtInstallTime": "I am env2...somethingElseAtInstallTime",
            "somethingInCodex": "@CODEX ${'hi from codex'}",
            "somethingInDashboard": "@DASHBOARD ${'hi from dashboards'}"
        }
    }
    expect(tp.output).toEqual(expected);
});

test("remove all DEFAULT_FUNCTIONS", async () => {
    let template = {"fetchFunctionShouldNotExists": "${$fetch('https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/foobar.json')}"};
    const restore = TemplateProcessor.DEFAULT_FUNCTIONS;
    try {
        TemplateProcessor.DEFAULT_FUNCTIONS = {};
        const tp = new TemplateProcessor(template);
        await tp.initialize();
        expect(tp.output).toStrictEqual({
            "fetchFunctionShouldNotExists": {
                "error": {
                    "message": "Attempted to invoke a non-function",
                    "name": "JSONata evaluation exception"
                }
            }
        });
    }finally {
        TemplateProcessor.DEFAULT_FUNCTIONS = restore;
    }
});

test("shadow DEFAULT_FUNCTIONS fetch with hello", async () => {
    let template = {"fetchFunctionBecomesHello": "${$fetch('https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/foobar.json')}"};
    const restoreFetch = TemplateProcessor.DEFAULT_FUNCTIONS.fetch;
    try {
        TemplateProcessor.DEFAULT_FUNCTIONS['fetch'] = () => {console.error('fetch function replaced by "hello" by function shadowing test"'); return 'hello'};
        const tp = new TemplateProcessor(template);
        await tp.initialize();
        expect(tp.output).toStrictEqual({
            "fetchFunctionBecomesHello": "hello"
        })
    }finally{
        TemplateProcessor.DEFAULT_FUNCTIONS.fetch = restoreFetch;
    }
});

test("replace DEFAULT_FUNCTIONS fetch with hello", async () => {
    let template = {"fetchFunctionBecomesHello": "${$fetch('https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/foobar.json')}"};
    const tp = new TemplateProcessor(template, {fetch: () => "hello"});
    await tp.initialize();
    expect(tp.output).toStrictEqual({
        "fetchFunctionBecomesHello": "hello"
    })
});

test("strict.refs", async () => {
    let template = {
        "a": 42,
        "b": "${a}",
        "c": "${z}",
        "d$": "c + a"
    };
    const tp = new TemplateProcessor(template, {}, {strict: {refs: true}});
    await tp.initialize();
    expect(tp.errorReport).toEqual({
        "/c": {
            "message": "/z does not exist, referenced from /c (strict.refs option enabled)",
            "name": "strict.refs"
        },
        "/d$": {
            "message": "The left side of the \"+\" operator must evaluate to a number",
            "name": "JSONata evaluation exception"
        }
    });
    expect(tp.output).toEqual({
        "a": 42,
        "b": 42,
        "c": {
            "error": {
                "message": "/z does not exist, referenced from /c (strict.refs option enabled)",
                "name": "strict.refs"
            }
        },
        "d$": {
            "error": {
                "message": "The left side of the \"+\" operator must evaluate to a number",
                "name": "JSONata evaluation exception"
            }
        }
    });
});

test("remove temp vars 1", async () => {
    let template = {
        "a": 42,
        "b": {
            "b1": 10,
            "b2": "!${b1}",
        },
        "c": "!${a}",
        "d!": {
            "b1": 10,
            "b2": "!/${b}",
        },
    };
    const tp = new TemplateProcessor(template, {});
    await tp.initialize()
    expect(tp.output).toEqual({
        "a": 42,
        "b": {
            "b1": 10
        }
    });
    await tp.setData("/a", 100);
    await tp.setData("/b/b1", -10);
    expect(tp.output).toEqual({
        "a": 100,
        "b": {
            "b1": -10
        }
    });
});
test("remove temp vars", async () => {
    let template = {
        "a": 42,
        "b": {
            "b1": 10,
            "b2": "!${b1}",
            "b3": "!${b2+10}",
            "b4": {
                "b5": "!../${b3+10}",
                "b6": "  !  /${b.b3+10}",
                "b7": "  !/${b.b3+b.b2}",
                "b8": " !  ../${b3+b2}",
            }
        },
        "c": "${b.b4.b5}",
        "d": "${b.b4.b6}",
        "e": "${b.b4.b7}",
        "f": "${b.b4.b8}"
    };
    const tp = new TemplateProcessor(template, {});
    await tp.initialize();
    expect(tp.output).toEqual({
        "a": 42,
        "b": {
            "b1": 10,
            "b4": {}
        },
        "c": 30,
        "d": 30,
        "e": 30,
        "f": 30
    })
});


test("dashboard", async () => {


    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const yamlFilePath = path.join(__dirname, 'data', 'dbWarning.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    const template = yaml.load(templateYaml);
    const tp = new TemplateProcessor(template, {});
    await tp.initialize();
    expect(tp.to('/view/0/2/0/1/warning')).toEqual([
        "/data/warningStatus/data/0/count",
        "/view/0/2/0/1/warning"
    ])
});

test("local import without --importPath", async () => {
    const template = {
        "foo": "bar",
        "baz": "${ $import('example/ex01.json') }"
    };
    const tp = new TemplateProcessor(template, {});
    await tp.initialize();
    expect(tp.output).toEqual({
        "baz": {
            "a": 42,
            "b": 42,
            "c": "the answer is: 42"
        },
        "foo": "bar"
    });
});

test("local import with bad filename and no --importPath", async () => {
    const template = {
        "foo": "bar",
        "baz": "${ $import('example/dingus.json') }"
    };
    const tp = new TemplateProcessor(template, {});
    await tp.initialize();
    expect(tp.output.baz.error.message).toBe("Import failed for 'example/dingus.json' at '/baz'");
});


test("local import with absolute --importPath", async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const importPath = path.join(__dirname, '../', '../', 'example');
    const template = {
        "foo": "bar",
        "baz": "${ $import('ex01.json') }"
    };
    const tp = new TemplateProcessor(template, {}, {importPath});
    await tp.initialize();
    expect(tp.output).toEqual({
        "baz": {
            "a": 42,
            "b": 42,
            "c": "the answer is: 42"
        },
        "foo": "bar"
    });
});

test("local import with non-absolute --importPath", async () => {
    const template = {
        "foo": "bar",
        "baz": "${ $import('ex01.json') }"
    };
    const tp = new TemplateProcessor(template, {}, {importPath: 'example'});
    await tp.initialize();
    expect(tp.output).toEqual({
        "baz": {
            "a": 42,
            "b": 42,
            "c": "the answer is: 42"
        },
        "foo": "bar"
    });
});

test("deep view", async () => {
    const template = {
        "closureExpression": "/${ ($names := $distinct(data.pD.data.name);  {'yAxis': [ {'categories': $names} ]}) }",
        "view": [
            [

                [
                    [
                        [
                            [
                                "/${ $string(data.pD.data) }"
                            ]
                        ]
                    ]
                ]
            ]
        ]
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    expect(tp.from("/data/pD/data")).toEqual([
            "/data/pD/data",
            "/view/0/0/0/0/0/0",
            "/closureExpression"
        ]
    );
    expect(tp.from("/data/pD")).toEqual([
            "/data/pD",
            "/view/0/0/0/0/0/0",
            "/closureExpression"
        ]
    );
    expect(tp.from("/data/pD/data/name")).toEqual([
            "/data/pD/data/name",
            "/closureExpression",
             "/view/0/0/0/0/0/0"
        ]
    );
    expect(tp.from("/data")).toEqual([
            "/data",
            "/view/0/0/0/0/0/0",
            "/closureExpression"
        ]
    );
    await tp.setData("/data/pD/data", [{
        "role": "ACCOUNTADMIN",
        "privilege": "OWNERSHIP",
        "table": "6146"
    }, {"role": "ACCOUNTADMIN", "privilege": "OWNERSHIP", "table": "4100"}, {
        "role": "ACCOUNTADMIN",
        "privilege": "OWNERSHIP",
        "table": "5128"
    }])
    expect(tp.output).toEqual({
            "closureExpression": {
                "yAxis": [
                    {}
                ]
            },
            "view": [
                [
                    [
                        [
                            [
                                [
                                    "[{\"role\":\"ACCOUNTADMIN\",\"privilege\":\"OWNERSHIP\",\"table\":\"6146\"},{\"role\":\"ACCOUNTADMIN\",\"privilege\":\"OWNERSHIP\",\"table\":\"4100\"},{\"role\":\"ACCOUNTADMIN\",\"privilege\":\"OWNERSHIP\",\"table\":\"5128\"}]"
                                ]
                            ]
                        ]
                    ]
                ]
            ],
            "data": {
                "pD": {
                    "data": [
                        {
                            "role": "ACCOUNTADMIN",
                            "privilege": "OWNERSHIP",
                            "table": "6146"
                        },
                        {
                            "role": "ACCOUNTADMIN",
                            "privilege": "OWNERSHIP",
                            "table": "4100"
                        },
                        {
                            "role": "ACCOUNTADMIN",
                            "privilege": "OWNERSHIP",
                            "table": "5128"
                        }
                    ]
                }
            }
        }
    );
});

test("test rxLog", async () => {
    const templateYaml =
    `# to run this locally you need to have pulsar running in standalone mode
    interval$: ($subscribe(subscribeParams); $setInterval(function(){$publish(pubParams)}, 1000))
    pubParams:
      type: /\${ subscribeParams.type} #pub to same type we subscribe on
      data: "\${ function(){  {'msg': 'hello', 'rando': $random()}}  }"
      testData: [ {'msg':'hello'} ]
      client:
        type: test
    subscribeParams: #parameters for subscribing to a cloud event
      source: cloudEvent
      type: 'my-topic'
      to: \${ function($e){$set('/rxLog/-', $e)}  }
      subscriberId: dingus
      initialPosition: latest
      client:
        type: test
    rxLog: [ {"default": 42} ]
    stop$: ($count(rxLog)=5?$clearInterval(interval$):'still going')
    `;
    const template = yaml.load(templateYaml);
    let tp
    try {
        tp = new TemplateProcessor(template, {
            "subscribe": () => {
            }, "publish": () => {
            }
        });
        await tp.initialize();
        expect(tp.from("/rxLog")).toEqual([
            "/rxLog",
            "/stop$"
        ]);
        expect(tp.from("/rxLog/-")).toEqual([
            "/rxLog/-",
            "/stop$"
        ]);
    }finally{
        tp.close();
    }

});

test("plunked expression", async () => {
    let template = {"foo$": "2$%&^"};
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    expect(tp.output).toStrictEqual({"foo$": "2$%&^"});
    expect(tp.errorReport).toEqual({
        "/foo$": {
            "error": {
                "message": "problem analysing expression : 2$%&^",
                "name": "badJSONata"
            }
        }
    });
});

test("errorReport function", async () => {
    let template = {
        a: "${ [0..2]~>$map(function($i){$errorReport('oops I goofed ' & $i, 'BARFERROR')})  }",
        b: "${!*plunked}", //broken on purpose
        c: "${$errorReport('noname error occured')}"
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    expect(tp.errorReport).toEqual({
        "/a": [
            {
                "error": {
                    "message": "oops I goofed 0",
                    "name": "BARFERROR"
                }
            },
            {
                "error": {
                    "message": "oops I goofed 1",
                    "name": "BARFERROR"
                }
            },
            {
                "error": {
                    "message": "oops I goofed 2",
                    "name": "BARFERROR"
                }
            }
        ],
        "/b": {
            "error": {
                "message": "problem analysing expression : !*plunked",
                "name": "badJSONata"
            }
        },
        "/c": {
            "error": {
                "message": "noname error occured"
            }
        }
    });
});

test("example from README explaining plans", async () => {
    let template = {
        a: {
            c: {
                g: {
                    h: 100,
                    i: "${h}"
                },
                d: 100
            }
        },
        b: {
            e: "/${a.c.g}",
            f: "${e.i+100}"
        }
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    const plan = await tp.getEvaluationPlan();
    expect(plan).toStrictEqual([
        "/a/c/g/i",
        "/b/e",
        "/b/f"
    ]);
    expect(tp.output).toStrictEqual({
        a: {
            c: {
                g: {
                    h: 100,
                    i: 100,
                },
                d: 100
            }
        },
        b: {
            e: {
                h: 100,
                i: 100,
            },
            f: 200
        }
    });

});

test("ex14.yaml", async () => {

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const yamlFilePath = path.join(__dirname, '..','..','example', 'ex14.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    const template = yaml.load(templateYaml);
    let tp;
    try {
        tp = new TemplateProcessor(template);
        await tp.initialize();
        expect(await tp.getEvaluationPlan()).toStrictEqual([
            "/incr$",
            "/upCount$",
            "/status$"
        ]);
        expect(tp.to('/status$')).toStrictEqual([
            "/counter",
            "/incr$",
            "/upCount$",
            "/status$"
        ]);
        expect(tp.to('/upCount$')).toStrictEqual([
            "/counter",
            "/incr$",
            "/upCount$"
        ]);
        expect(tp.from('/incr$')).toStrictEqual([
            "/incr$"
        ]);
        expect(tp.from('/counter')).toStrictEqual([
                "/counter",
                "/status$"
            ]
        );
        expect(tp.from('/upCount$')).toStrictEqual([
            "/upCount$",
            "/status$"
        ]);
        expect(tp.from('/status$')).toStrictEqual([
            "/status$"
        ]);
        expect(tp.to('/incr$')).toStrictEqual([
            "/counter",
            "/incr$"
        ]);
        expect(tp.to('/counter')).toStrictEqual([
            "/counter"
        ]);
    }finally {
        tp.close();
    }
});
describe('TemplateProcessor.fromString', () => {

    it('should correctly identify and parse JSON string', async () => {
        const jsonString = '{"key": "value"}';
        const instance = TemplateProcessor.fromString(jsonString);
        await instance.initialize();
        expect(instance).toBeInstanceOf(TemplateProcessor);
        expect(instance.output).toEqual({ key: "value" });  // Assuming parsedObject is publicly accessible
    });

    it('should correctly identify and parse YAML string using ---', async () => {
        const yamlString = `---
key: value`;
        const instance = TemplateProcessor.fromString(yamlString);
        await instance.initialize();
        expect(instance).toBeInstanceOf(TemplateProcessor);
        expect(instance.output).toEqual({ key: "value" });
    });

    it('should correctly identify and parse YAML string using colon', async () => {
        const yamlString = `key: value`;
        const instance = TemplateProcessor.fromString(yamlString);
        await instance.initialize();
        expect(instance).toBeInstanceOf(TemplateProcessor);
        expect(instance.output).toEqual({ key: "value" });
    });

    it('should throw an error for unknown formats', async () => {
        const unknownString = `Hello World`;
        expect(() => TemplateProcessor.fromString(unknownString)).toThrow("Unknown format");
    });

    it('should not misinterpret colon in JSON string', async () => {
        const jsonString = '{"greeting": "Hello: World"}';
        const instance = TemplateProcessor.fromString(jsonString);
        expect(instance).toBeInstanceOf(TemplateProcessor);
        await instance.initialize();
        expect(instance.output).toEqual({ greeting: "Hello: World" });
    });


});


test("test /__META__/tags callback ", async () => {
    const tp = new TemplateProcessor({
        "solutionId": "@INSTALL ${$sys.solutionId}",
        "ex": "example1",
        "version": "@INSTALL ${$manifest.solutionVersion}",
        "name": "@INSTALL ${$env.name}",
        "__META__!": {
            "tags": "@INSTALL ${'hello'}"
        }
    }, {sys:{solutionId:123}, manifest:{solutionVersion: 2.0}, env:{name:"dev"}});
    tp.tagSet.add("INSTALL");
    const received = [];
    tp.setDataChangeCallback("/__META__!/tags", (data, jsonPtr) => {
        received.push({data, jsonPtr})
    });
    await tp.initialize();
    expect(tp.output).toEqual({
        "ex": "example1",
        "name": "dev",
        "solutionId": 123,
        "version": 2
    });

    expect(received).toEqual([
        {
            "data": "hello",
            "jsonPtr": "/__META__!/tags"
        }
    ]);
});



test("test /__META__/tags array callback ", async () => {
    const tp = new TemplateProcessor({
        "solutionId": "@INSTALL ${$sys.solutionId}",
        "ex": "example1",
        "version": "@INSTALL ${$manifest.solutionVersion}",
        "name": "@INSTALL ${$env.name}",
        "__META__!": [{ "tags": { "foo": 'bar' } }]
    }, {sys:{solutionId:123}, manifest:{solutionVersion: 2.0}, env:{name:"dev"}});
    tp.tagSet.add("INSTALL");
    const received = [];
    tp.setDataChangeCallback("/__META__!", (data, jsonPtr, removed) => {
        received.push({data, jsonPtr})
    });
    await tp.initialize();
    const plan = await tp.getEvaluationPlan();
    expect(plan).toEqual([
          "/name",
          "/solutionId",
          "/version",
        ]);
    expect(tp.output).toEqual({
        "ex": "example1",
        "name": "dev",
        "solutionId": 123,
        "version": 2
    });

    expect(received).toEqual([
        {
            "data": [
                {
                    "tags": {
                        "foo": "bar"
                    }
                }
            ],
            "jsonPtr": "/__META__!"
        }
    ]);
});

test("test array with /__META__/tags callback ", async () => {
    const tp = new TemplateProcessor([
            {
                "solutionId": "@INSTALL ${$sys.solutionId}",
                "ex": "example1",
                "version": "@INSTALL ${$manifest.solutionVersion}",
                "name": "@INSTALL ${$env.name}",
                "__META__!": [{ "tags": { "foo": 'bar' } }]
            },
            {
                "solutionId": "@INSTALL ${$sys.solutionId}",
                "ex": "example1",
                "version": "@INSTALL ${$manifest.solutionVersion}",
                "name": "@INSTALL ${$env.name}",
                "__META__!": [{ "tags": { "foo": "@INSTALL${41+1}" } }]
            }
        ], {sys:{solutionId:123}, manifest:{solutionVersion: 2.0}, env:{name:"dev"}});
    tp.tagSet.add("INSTALL");
    tp.postInitialize = async()=>{
        expect(tp.output).toEqual([
            {
                "ex": "example1",
                "name": "dev",
                "solutionId": 123,
                "version": 2,
                "__META__!": [{ "tags": { "foo": 'bar' } }]
            },
            {
                "ex": "example1",
                "name": "dev",
                "solutionId": 123,
                "version": 2,
                "__META__!": [{ "tags": { "foo": 42 } }]
            }
        ])
    }
    await tp.initialize();
    expect(tp.output).toStrictEqual([
        {
            "ex": "example1",
            "name": "dev",
            "solutionId": 123,
            "version": 2
        },
        {
            "ex": "example1",
            "name": "dev",
            "solutionId": 123,
            "version": 2
        }
    ]);

});


test("parallel TemplateProcessors", () => {
    let template = { "foo$": "41+1" };
    let processors = [];

    // Create 10 TemplateProcessor instances with the same template
    for (let i = 0; i < 10; i++) {
        let tp = new TemplateProcessor(template);
        processors.push(tp.initialize().then(() => tp)); // Store the initialized promise
    }

    return Promise.all(processors).then((initializedProcessors) => {
        // At this point, all processors have been initialized and we can test their output
        initializedProcessors.forEach((tp) => {
            expect(tp.output).toStrictEqual({ "foo$": 42 });
        });
    });
});

test("function generators",async () => {
    let template = {
        a: "${ $jit() }",
        b: "${ $jit() }",
        d:{e:"${ $jit() }"},
        e: "${ (koink; $serial([foo.zing.zap,bar,baz]))}",
        f:{
            g:"/${$serial(steps)}",
            h:"../${$serial(steps)}",
            i:{
                j:"../../${$serial(steps)}",
                k:"../${$serial(steps)}",
            }
        },
        steps:{
            a:{},
            b:{}
        },
        foo:{
            zing:{
                zap:{}
            }
        },
        bar:{},
        baz:{}
    };

    let tp = new TemplateProcessor(template);
    const jit = (metaInf, tp)=>{
        return ()=>{
            return `path was: ${metaInf.jsonPointer__}`;
        }
    }
    tp.functionGenerators.set("jit", jit);
    let serialDeps = {};
    const serial = async (metaInf, tp)=>{
        return async (input, steps, context)=>{
            const ast = metaInf.compiledExpr__.ast();
            let depFinder = new DependencyFinder(ast);
            depFinder = await depFinder.withAstFilterExpression("**[procedure.value='serial']");
            //this is just an example of how we can find the dependencies of $serial([foo, bar]) and cache them for later use
            const absDeps = depFinder.findDependencies().map(d=>[...jp.parse(metaInf.exprTargetJsonPointer__), ...d]);
            serialDeps[metaInf.jsonPointer__] = absDeps.map(jp.compile);

            return "nothing to see here"
        }
    }
    tp.functionGenerators.set('serial', serial);
    await tp.initialize();

    expect(tp.output).toStrictEqual({
        "a": "path was: /a",
        "b": "path was: /b",
        "bar": {},
        "baz": {},
        "d": {
            "e": "path was: /d/e"
        },
        "e": "nothing to see here",
        "f": {
            "g": "nothing to see here",
            "h": "nothing to see here",
            "i": {
                "j": "nothing to see here",
                "k": "nothing to see here"
            }
        },
        "foo": {
            "zing": {
                "zap": {}
            }
        },
        "steps": {
            "a": {},
            "b": {}
        }
    });
    expect(serialDeps).toStrictEqual({
        "/e": [
            "/foo/zing/zap",
            "/bar",
            "/baz"
        ],
        "/f/g": [
            "/steps"
        ],
        "/f/h": [
            "/steps"
        ],
        "/f/i/j": [
            "/steps"
        ],
        "/f/i/k": [
            "/f/steps"
        ]
    });
});

test("broken function generator",async () => {
    let template = {
        a: "${ $jit() }"};

    let tp = new TemplateProcessor(template);
    const jit = async (metaInf, tp)=>{
        throw new Error("oops");
    }
    tp.functionGenerators.set("jit", jit);
    let serialDeps = {};
    await tp.initialize();

    expect(tp.output).toStrictEqual({
        "a": {
            "error": {
                "message": "Function generator 'jit' failed to generate a function and erred with:\"oops\"",
                "name": "JSONata evaluation exception"
            }
        }
    });
});

test("apply", async () => {
    let template = {
        "f":"${function($p){$p&'hello'}}",
        "g":"${f('hi ')}",
        "a": "--",
        "b": "${function($e){$set('/a', $e)}}"
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    const hello = await tp.output.f('well ');
    expect(hello).toBe("well hello");
    expect(await tp.output.f.apply(null, ['yo '])).toBe('yo hello');
    expect(tp.output.g).toBe('hi hello');
    await tp.output.b('xxx');
    expect(tp.output.a).toBe('xxx');
});

test("debounce", async () => {
    let template = {
        "acc": [],
        "appendAcc": "${ function($v){$set('/acc/-', $v)} ~> $debounce(15)}",
        "counter": "${ function(){($set('/count', $$.count+1); $$.count)} }",
        "count": 0,
        "rapidCaller": "${ $setInterval(counter~>appendAcc, 10)}",
        "stop": "${ count=100?($clearInterval($$.rapidCaller);'done'):'not done' }"
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    // Wait for a few seconds (adjust the time as needed)
    await new Promise(resolve => setTimeout(resolve, 3000));

    expect(tp.output.acc).toStrictEqual([100]); //debouncing causes only the final value to append to the array

});

test("defer", async () => {
    let template = {
        "counter": "${ function(){($set('/count', $$.count+1); $$.count)} }",
        "count": 0,
        "deferredCount": "${$defer('/count', 500)}",
        "rapidCaller": "${ $setInterval(counter, 10)}",
        "stop": "${ count=10?($clearInterval($$.rapidCaller);'done'):'not done' }"
    };
    const tp = new TemplateProcessor(template);
    let done;
    const latch = new Promise(resolve => done = resolve);
    let deferredCountNumChanges = 0;
    tp.setDataChangeCallback('/deferredCount', (data, jsonPtr)=>{
        deferredCountNumChanges++;
        if(deferredCountNumChanges === 2){ //will call once for initial value, then again on debounced/defer
            done();
        }
    })
    await tp.initialize();
    await latch;
    expect(tp.output.count).toBe(10);
    expect(tp.output.deferredCount).toBe(10); //defering causes only the final value to be captured
    expect(deferredCountNumChanges).toBe(2); //once for initial value, and again on debounce
});

test('generateDeferFunction produces correct exception when path is wrong', async () => {

    const tp = new TemplateProcessor({
        some:{path: "hello"},
        deferred: "${$defer('/whoops')}"
    });
    await tp.initialize();
    expect(tp.output.deferred).toMatchObject({
        "error":{
            "message":"$defer called on non-existant field: /whoops"
        }
    })

});

test("relative vs absolute root '//' in import", async () => {
    let template = {
        viz:{props:{x:'not hello'}},
        replacementProp: "hello",
        b:{
            c:{
                d:"../../${ viz ~> |props|{'x':'../../../../${$$.replacementProp}'}| ~> $import}",
                e:"../../${ viz ~> |props|{'x':'//${$$.replacementProp}'}| ~> $import}"
            }
        }
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    expect(tp.output.b.c.d).toStrictEqual({props:{x:"hello"}});
    expect(tp.output.b.c.e).toStrictEqual({props:{x:"hello"}});
});

test("root / vs absolute root // inside various rooted expressions", async () => {
    let template = {
        a: "Global A",
        b:{
            c:{
                d: "${  {'a':'Local A', 'b':'/${a}'} ~> $import  }",
                e: "/${importMe ~>|$|{'b':'/${a}'}| ~> $import}",
                f: "../../${importMe ~> |$|{'b':'/${a}'}|~> $import}",
                g: "${  {'a':'Local A', 'b':'//${a}'} ~> $import  }",
                h: "/${importMe ~>|$|{'b':'//${a}'}| ~> $import}",
                i: "../../${importMe ~> |$|{'b':'//${a}'}|~> $import}",
            }
        },
        importMe: {a:'Local A', b:'SOMETHING TO BE REPLACED'}
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    expect(tp.output.b.c.d.b).toBe("Local A");
    expect(tp.output.b.c.e.b).toBe("Local A");
    expect(tp.output.b.c.f.b).toBe("Local A");
    expect(tp.output.b.c.g.b).toBe("Global A");
    expect(tp.output.b.c.h.b).toBe("Global A");
    expect(tp.output.b.c.i.b).toBe("Global A");
});

// This test ensures that functions do not have dependencies
test("functions are immutable and have no 'from'", async () => {
    const templateYaml = `
    # producer will be sending some test data
    produceParams:
      type: "my-topic"
      data: ['luke', 'han', 'leia']
      client:
        type: test
    # the subscriber's 'to' function will be called on each received event
    subscribeParams: #parameters for subscribing to an event
      source: cloudEvent
      type: /\${produceParams.type} # subscribe to the same topic as we are publishing to test events
      to: /\${joinResistance}
      subscriberId: rebelArmy
      initialPosition: latest
      client:
          type: test
    joinResistance:  /\${function ($rebel) {$set('/rebelForces', rebelForces ~> $append($rebel))}}
    # starts producer function
    send$: $publish(produceParams)
    # starts consumer function
    recv$: $subscribe(subscribeParams)
    # the subscriber's \`to\` function will write the received data here
    rebelForces: [ ]`

    const template = yaml.load(templateYaml);
    const tp = new TemplateProcessor(template, {publish: ()=>{'NoOp'}, subscribe: ()=>{'NoOp'}}); //just stub subscribe with a noop
    await tp.initialize();
    expect(tp.from("/rebelForces")).toEqual(["/rebelForces"]); // /rebelForces has no fan-out
    expect(tp.to("/rebelForces")).toEqual(["/rebelForces"]); // /rebelForces has no fan-in
    expect(tp.from("/subscribeParams/to")).toEqual([
        "/subscribeParams/to",
        "/subscribeParams/type", //<--- this is somewhat dubious
        "/recv$"
    ]);
    expect(tp.to("/subscribeParams/to")).toEqual(    [
        "/rebelForces",
        "/joinResistance",
        "/subscribeParams/to"
    ]);

    expect(tp.to("/subscribeParams/to")).toEqual([
        "/rebelForces",
        "/joinResistance",
        "/subscribeParams/to"
    ]);

    expect(await tp.getEvaluationPlan()).toEqual([
            "/joinResistance",
            "/subscribeParams/to",
            "/subscribeParams/type",
            "/recv$",
            "/send$"
        ]
    );
});

test("don't re-evaluate intervals", async () => {

    let template = {
        "count": 0,
        "counter": "${ $setInterval(function(){$set('/count', count+1)}, 1000) }",
        "stop": "${ count=10?($clearInterval($$.counter);'done'):'not done'  }"
    }
    const tp = new TemplateProcessor(template);
    try {
        await tp.initialize();
        const from = tp.from("/count");
        expect(from).toEqual(["/count", "/stop"]);
    } finally {
        await tp.close();
    }

});

test("expected function call behavior", async () => {
    let context = {
        "a":42,
        "echo": (echoMe)=>echoMe
    };
    let expr = "echo(a)";
    let answer = await jsonata(expr).evaluate(context);
    expect(answer).toBe(42);
    context = {
        "someRootValue":'xxx',
        "nested": {
            "a":42,
            "echo": (echoMe)=>echoMe
        },
    };
    expr = "nested.echo(nested.a)";
    answer = await jsonata(expr).evaluate(context);
    expect(answer).toBeUndefined(); // jsonata will not 'see' 'nested.a'
    expr = "nested.echo($$.nested.a)";
    answer = await jsonata(expr).evaluate(context);
    expect(answer).toBe(42); //jsonata *will* 'see' $$.nested.a since it is an absolute reference
    expr = "nested.echo(a)";
    answer = await jsonata(expr).evaluate(context);
    expect(answer).toBe(42);//jsonata *will* 'see' a since it's 'scope' is `nested` at the point that `echo` is invoked
    expr = "nested.echo(someRootValue)";
    answer = await jsonata(expr).evaluate(context);
    expect(answer).toBeUndefined();//jsonata won't see 'someRootValue' because scope is 'nested' but someRootValue is outside the nested scope
    expr = "nested.echo($$.someRootValue)";
    answer = await jsonata(expr).evaluate(context);
    expect(answer).toBe('xxx');//jsonata will see '$$.someRootValue' because the reference is absolute
});

test("interval snapshot", async () => {

    const snapshotObj = {
        "template": {
            "counter": "${ function(){( $set('/count', $$.count+1); $$.count)} }",
            "count": 0,
            "rapidCaller": "${ $setInterval(counter, 1000)}",
            "stop": "${ count>=2?($clearInterval($$.rapidCaller);'done'):'not done' }"
        },
        "options": {
            "foo": {
                "bar": "baz"
            }
        },
        "mvcc": [
            {
                "forkId": "ROOT",
                "output": {
                    "counter": "{function:}",
                    "count": 1,
                    "rapidCaller": "--interval/timeout--",
                    "stop": "not done"
                }
            }
        ],
            "metaInfoByJsonPointer": {
            "/": [
                {
                    "materialized__": true,
                    "jsonPointer__": "",
                    "dependees__": [],
                    "dependencies__": [],
                    "absoluteDependencies__": [],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprTargetJsonPointer__": ""
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/count",
                    "dependees__": [
                        "/counter",
                        "/stop"
                    ],
                    "dependencies__": [],
                    "absoluteDependencies__": [],
                    "treeHasExpressions__": false,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprTargetJsonPointer__": "",
                    "data__": 1
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/counter",
                    "dependees__": [
                        "/rapidCaller"
                    ],
                    "dependencies__": [
                        "/count",
                        "/count"
                    ],
                    "absoluteDependencies__": [
                        "/count"
                    ],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprRootPath__": null,
                    "expr__": " function(){( $set('/count', $$.count+1); $$.count)} ",
                    "exprTargetJsonPointer__": "",
                    "compiledExpr__": "--compiled expression--",
                    "isFunction__": true,
                    "data__": "{function:}"
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/rapidCaller",
                    "dependees__": [
                        "/stop"
                    ],
                    "dependencies__": [
                        "/counter"
                    ],
                    "absoluteDependencies__": [
                        "/counter"
                    ],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprRootPath__": null,
                    "expr__": " $setInterval(counter, 1000)",
                    "exprTargetJsonPointer__": "",
                    "compiledExpr__": "--compiled expression--",
                    "data__": "--interval/timeout--"
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/stop",
                    "dependees__": [],
                    "dependencies__": [
                        "/count",
                        "/rapidCaller"
                    ],
                    "absoluteDependencies__": [
                        "/count",
                        "/rapidCaller"
                    ],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprRootPath__": null,
                    "expr__": " count>=2?($clearInterval($$.rapidCaller);'done'):'not done' ",
                    "exprTargetJsonPointer__": "",
                    "compiledExpr__": "--compiled expression--",
                    "data__": "not done"
                }
            ]
        },
        "plans": [
            {
                "forkId": "ROOT",
                "forkStack": [],
                "sortedJsonPtrs": [
                    "/count",
                    "/stop"
                ],
                "op": "set",
                "data": 1,
                "lastCompletedStep": "/count"
            }
        ]
    };
    const snapshot = JSON.stringify(snapshotObj);
    let latch;
    let done;
    const tp = new TemplateProcessor();
    tp.logger.leve = 'debug';
    latch = new Promise(resolve => done = resolve);
    tp.setDataChangeCallback('/count', (data, ptr, removed) => {
        if (data === 2) {
            done()
        }
    });
    try {
        await tp.initializeFromExecutionStatusString(snapshot);
        await latch;
    } finally {
        await tp.close();
    }
})


/**
 * End to end snapshot/restore test
 * - Run a simple template with a timeout (setInterval)
 * - capture a snapshot after template is initialized
 * - validate and restore from the snapshot
 * - validate template processor converges to the expected result
 *
  */

test("snapshot and restore", async () => {
    let template = {
        "counter": "${ function(){($set('/count', $$.count+1); $$.count)} }",
        "count": 0,
        "rapidCaller": "${ $setInterval(counter, 100)}",
        "stop": "${ count>=10?($clearInterval($$.rapidCaller);'done'):'not done' }"
    };
    const options = {"foo": {"bar": "baz"}};
    const tp = new TemplateProcessor(template, {}, options);
    let done;
    let latch = new Promise(resolve => done = resolve);
    let callNums = 0;
    let snapshot;
    tp.setDataChangeCallback('/count', async (data, jsonPtr)=>{
        callNums++;
        if(callNums === 2){ //will call once when count is set to 2
            snapshot = await tp.snapshot();
        }
        if(callNums === 10){ //release latch
            done();
        }
    })
    await tp.initialize();
    await latch;

    expect(tp.output.count).toBe(10);

    const snapshotObject = JSON.parse(snapshot);
    expect(snapshotObject).toStrictEqual({
        "template": {
            "counter": "${ function(){($set('/count', $$.count+1); $$.count)} }",
            "count": 0,
            "rapidCaller": "${ $setInterval(counter, 100)}",
            "stop": "${ count>=10?($clearInterval($$.rapidCaller);'done'):'not done' }"
        },
        "output": {
            "count": 2,
            "counter": "{function:}",
            "rapidCaller": "--interval/timeout--",
            "stop": "not done"
        },
        "options": {
            "foo": {
                "bar": "baz"
            }
        },
        "mvcc": [
            {
                "forkId": "ROOT",
                "output": {
                    "counter": "{function:}",
                    "count": 2,
                    "rapidCaller": "--interval/timeout--",
                    "stop": "not done"
                }
            }
        ],
        "metaInfoByJsonPointer": {
            "/": [
                {
                    "materialized__": true,
                    "jsonPointer__": "",
                    "dependees__": [],
                    "dependencies__": [],
                    "absoluteDependencies__": [],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprTargetJsonPointer__": ""
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/count",
                    "dependees__": [
                        "/counter",
                        "/stop"
                    ],
                    "dependencies__": [],
                    "absoluteDependencies__": [],
                    "treeHasExpressions__": false,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprTargetJsonPointer__": "",
                    "data__": 2
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/counter",
                    "dependees__": [
                        "/rapidCaller"
                    ],
                    "dependencies__": [
                        "/count",
                        "/count"
                    ],
                    "absoluteDependencies__": [
                        "/count"
                    ],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprRootPath__": null,
                    "expr__": " function(){($set('/count', $$.count+1); $$.count)} ",
                    "exprTargetJsonPointer__": "",
                    "compiledExpr__": "--compiled expression--",
                    "isFunction__": true,
                    "data__": "{function:}"
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/rapidCaller",
                    "dependees__": [
                        "/stop"
                    ],
                    "dependencies__": [
                        "/counter"
                    ],
                    "absoluteDependencies__": [
                        "/counter"
                    ],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprRootPath__": null,
                    "expr__": " $setInterval(counter, 100)",
                    "exprTargetJsonPointer__": "",
                    "compiledExpr__": "--compiled expression--",
                    "data__": "--interval/timeout--"
                },
                {
                    "materialized__": true,
                    "jsonPointer__": "/stop",
                    "dependees__": [],
                    "dependencies__": [
                        "/count",
                        "/rapidCaller"
                    ],
                    "absoluteDependencies__": [
                        "/count",
                        "/rapidCaller"
                    ],
                    "treeHasExpressions__": true,
                    "tags__": [],
                    "parent__": "",
                    "temp__": false,
                    "exprRootPath__": null,
                    "expr__": " count>=10?($clearInterval($$.rapidCaller);'done'):'not done' ",
                    "exprTargetJsonPointer__": "",
                    "compiledExpr__": "--compiled expression--",
                    "data__": "not done"
                }
            ]
        },
        "plans": [
            {
                "forkId": "ROOT",
                "forkStack": [],
                "lastCompletedStep": "/count",
                "sortedJsonPtrs": [
                    "/count",
                    "/stop"
                ],
                "op": "set",
                "data": 2
            }
        ]
    });


    // reset latch promise and callNums
    latch = new Promise(resolve => done = resolve);
    callNums = 0;
    // await TemplateProcessor.prepareSnapshotInPlace(snapshotObject);
    const tp2 = new TemplateProcessor();
    tp2.setDataChangeCallback('/count', (data, jsonPtr)=>{
        callNums++;
        if(callNums === 8){ //TemplateProcessor restores from count=2 and should continue to count=10
            done();
        }
    })
    await tp2.initializeFromExecutionStatusString(snapshot);
    await latch;

    // TemplateProcessor restored from snapshot should arrive to the same state as the original
    expect(tp2.output.count).toBe(10);
});



// This test validates that multiple callbacks can be set or removed from root or non-root json pointers
test("data change callbacks", async () => {
    let template = {
        "counter": "${ function(){($set('/count', $$.count+1); $$.count)} }",
        "count": 0,
        "rapidCaller": "${ $setInterval(counter, 10)}",
        "stop": "${ count=10?($clearInterval($$.rapidCaller);'done'):'not done' }"
    };
    const tp = new TemplateProcessor(template);
    let cbCount1 = 0;
    let cbCount2 = 0;
    let cbCount3 = 0;
    const cbf1 = (data, jsonPtr)=> {
        cbCount1++;
        if (cbCount1 == 7){
            tp.removeDataChangeCallback('/', cbf1);
        }
    }
    const cbf2 = (data, jsonPtr)=> {
        cbCount2++;
        if (cbCount2 == 5){
            tp.removeDataChangeCallback('/count', cbf2);
        }
    }
    const cbf3 = (data, jsonPtr)=> {
        cbCount3++;
        if (cbCount3 == 3){
            tp.removeDataChangeCallback('/', cbf3);
        }
    }
    tp.setDataChangeCallback('/',cbf1);
    tp.setDataChangeCallback('/count',cbf2);
    tp.setDataChangeCallback('/',cbf3);
    await tp.initialize();
    while(tp.output.count < 10) {
        await new Promise(resolve => setTimeout(resolve, 50));

    }
    expect(tp.output.count).toBe(10);
    expect(cbCount1).toBe(7);
    expect(cbCount2).toBe(5);
    expect(cbCount3).toBe(3);
});

test("data change on array append (/foo/-)", async () => {
    let template = {
        "appendFoo": "${ $set('/foo/-', 4) }",
        "foo": [1,2,3]
    };
    const tp = new TemplateProcessor(template);
    let cbCount1 = 0;
    let cbCount2 = 0;
    let latch1;
    new Promise((resolve)=>{latch1=resolve;})
    const cbf1 = (data, jsonPtr)=> {
        cbCount1++;
        latch1();
    }

    let latch2;
    new Promise((resolve)=>{latch2=resolve;})
    const cbf2 = (data, jsonPtr)=> {
        cbCount2++;
        if(cbCount2 === 2) {
            latch2();
        };
    }

    tp.setDataChangeCallback('/',cbf2);
    tp.setDataChangeCallback('/foo',cbf1);
    await tp.initialize();
    await Promise.all([latch1, latch2]);

    expect(cbCount2).toBe(2);
    expect(cbCount1).toBe(1);
});

test("dataChangeCallback on delete op", async () => {
    const tp = new TemplateProcessor({"foo": "bar"});
    let done;
    let latch = new Promise(resolve => done = resolve);
    tp.setDataChangeCallback('/foo', (data, jsonPtr, removed)=>{
        if(removed){
            done();
        }
    });
    await tp.initialize();
    tp.setData("/foo", undefined, "delete");
    await latch;
    expect(tp.output.foo).toBeUndefined();
})

/**
 * validates that a template restored from a snapshot contains injected fields, and that
 * fields with functions are callable.
 */
test("snapshot contains injected fields", async () => {
    const tp = new TemplateProcessor({
        "a": "${function(){'yo'}}",
        "b": {"c": {"d":"${'hello'}"}, "e":42}
    });
    await tp.initialize();
    await tp.setData("/f","XXX");
    await tp.setData("/b/c/g","YYY");
    const snapshotStr = await tp.snapshot();
    const tpRestored = await TemplateProcessor.fromExecutionStatusString(snapshotStr);
    expect(await tpRestored.output.a()).toBe('yo');
    expect(tpRestored.output.b.c.d).toBe('hello');
    expect(tpRestored.output.b.e).toBe(42);
    expect(tpRestored.output.f).toBe("XXX");
    expect(tpRestored.output.b.c.g).toBe('YYY');
})

test("forked1", async () => {
    const tp = new TemplateProcessor({
        "vals": "${[1..10].($forked('/val', $))}",
        "val": 0,
        "val1": "${{'val':val, 'val1':val}}",
        "val2": "${val1 ~>|$|{'val2':$$.val1.val1&':hello'}|}",
        "onVal": "${ $joined('/acc/-', $$.val2 ~>|$|{'done':true}|) }",
        "acc":[],
        "accSort": "${acc^($.val)}",
        "done" : "${$count(acc)=11}"
    });
    let latch;
    const latchPromise = new Promise((resolve)=>{latch = resolve})
    tp.setDataChangeCallback("/done", (done)=>{
        if(done===true) {
            latch();
        }
    })
    await tp.initialize();
    await latchPromise;
    expect(await tp.output.accSort).toStrictEqual([
        {
            "done": true,
            "val": 0,
            "val1": 0,
            "val2": "0:hello"
        },
        {
            "done": true,
            "val": 1,
            "val1": 1,
            "val2": "1:hello"
        },
        {
            "done": true,
            "val": 2,
            "val1": 2,
            "val2": "2:hello"
        },
        {
            "done": true,
            "val": 3,
            "val1": 3,
            "val2": "3:hello"
        },
        {
            "done": true,
            "val": 4,
            "val1": 4,
            "val2": "4:hello"
        },
        {
            "done": true,
            "val": 5,
            "val1": 5,
            "val2": "5:hello"
        },
        {
            "done": true,
            "val": 6,
            "val1": 6,
            "val2": "6:hello"
        },
        {
            "done": true,
            "val": 7,
            "val1": 7,
            "val2": "7:hello"
        },
        {
            "done": true,
            "val": 8,
            "val1": 8,
            "val2": "8:hello"
        },
        {
            "done": true,
            "val": 9,
            "val1": 9,
            "val2": "9:hello"
        },
        {
            "done": true,
            "val": 10,
            "val1": 10,
            "val2": "10:hello"
        }
    ]);
})

test("forked homeworlds", async () => {
    let savedState;
    let latch;
    const latchSaveCommand = new Promise(resolve => {latch=resolve});
    const tp = TemplateProcessor.fromString(`
    data: \${['luke', 'han', 'leia', 'chewbacca', 'Lando'].($forked('/name',$))}
    name: null
    personDetails: \${ (name!=null?$fetch('https://swapi.tech/api/people/?name='&name).json().result[0]:null) ~>$save}
    homeworldURL: \${ personDetails!=null?personDetails.properties.homeworld:null }
    homeworldDetails: \${ homeworldURL!=null?$fetch(homeworldURL).json().result:null}
    homeworldName: \${ homeworldDetails!=null?$joined('/homeworlds/-', homeworldDetails.properties.name):null }
    homeworlds: []`,
        {save:(o)=>{
            savedState = tp.executionStatus.toJsonObject();
            if (savedState.mvcc.length === 6){
                latch();
            }
            return o;
        }}
    );
    let latchHomeworlds;
    const homeworldsPromise = new Promise(resolve=>{latchHomeworlds = resolve});
    tp.setDataChangeCallback('/homeworlds', (homeworlds)=>{
        if(homeworlds.length === 5){
            latchHomeworlds();
        }
    })
    await tp.initialize();
    await homeworldsPromise;
    const expectedHomeworlds = [
        "Corellia",
        "Tatooine",
        "Alderaan",
        "Socorro",
        "Kashyyyk"
    ];
    const homeworlds = tp.output.homeworlds;
    // Ensure the array contains all the expected elements (we cannot expec them to be in a particular order
    //due to the async nature of $forked
    expect(expectedHomeworlds.every(element => homeworlds.includes(element))).toBe(true);

    // Ensure the array does not contain any elements not expected
    expect(homeworlds.every(element => expectedHomeworlds.includes(element))).toBe(true);

    // Ensure the array is exactly the same length as the expected array
    expect(homeworlds).toHaveLength(expectedHomeworlds.length);
    if (savedState.mvcc.length !== 6) {
        throw new Error(`Expected savedState.mvcc.length to be 6. SavedState.mvcc is \n ${JSON.stringify(savedState.mvcc, null, 2)}`);
    }
    expect(savedState.mvcc.length).toEqual(6); //5 names + 1 initialization of null name
    expect(savedState.plans.length).toEqual(5); //5 forks. Initial value of 'name' is not from a fork
},5000);


test("performance test with 100 data injections", async () => {
    const tp = new TemplateProcessor({
        "data": {
            "cpu_usage": [],
            "memory_usage": [],
            "disk_io": []
        },
        "health_rules": {
            "cpu_rule": "/${$average(data.cpu_usage) > 80 ? 'alert' : 'normal'}",
            "mem_rule": "/${$average(data.memory_usage) > 80 ? 'alert' : 'normal'}",
            "io_rule": "/${$max(data.disk_io) > 400 ? 'alert' : 'normal'}",
        }
    });

    await tp.initialize();
    let startTime = Date.now();
    for (let i = 0; i < 10000; i++) {
        const newData = {
            cpu_usage: Array.from({ length: 1000 }, () => Math.random() * 100),
            memory_usage: Array.from({ length: 1000 }, () => Math.random() * 100),
            disk_io: Array.from({ length: 1000 }, () => Math.random() * 500)
        };
        await tp.setData("/data", newData);
    }
    let endTime = Date.now();
    console.log(`Total execution time for 10000 data sets: ${endTime - startTime} ms`);
    console.log(`rules per second: ${10000/((endTime - startTime)/1000)}`);

});

test("test that circular reference does not blow up", async () => {

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const yamlFilePath = path.join(__dirname, '..','..','example','experimental', 'product_workflow.sw.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    const template = yaml.load(templateYaml);
    const tp = new TemplateProcessor(template, {sys:{solutionId:"foosolution"}});
    tp.tagSet.add("INSTALL")
    await tp.initialize();
    expect(tp.output.states[2].data.productEntityType).toBe("foosolution:product")
    expect(tp.output.states[2].data.cartMetricType).toBe("foosolution:cart.products.total")
});

/**
 * This test restores from execution status snapshot template started from homeworlds-forked.yaml. It expects that the
 * plans in snapshot will be restored and template converges to the desired result.
 */
test("forked homeworlds snapshots", async () => {

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const filePath = path.join(__dirname, '..', '..', 'example', 'executionStatus.json');
    let executionStatusStr = fs.readFileSync(filePath, 'utf8');

    let savedState; // save state of the template processor
    let saveCalls = 0; // number of calls

    let latchSave;
    const savePromise = new Promise(resolve => {
        latchSave = resolve
    });
    const tp = new TemplateProcessor({},
        // sets some functions needed for test validation
        {
            save: (o) => {
                saveCalls++;
                savedState = tp.executionStatus.toJsonObject();
                // we validate that all 5 forks and one root plan are executed to the save function
                if (saveCalls === 6 && savedState.mvcc.length === 6) {
                    latchSave();
                }
                return o;
            },
            snapshot: async (o) => {
                return o;
            }
        });
    let latchHomeworlds;
    const homeworldsPromise = new Promise(resolve => {
        latchHomeworlds = resolve
    });

    tp.setDataChangeCallback('/homeworlds', (homeworlds) => {
        if (homeworlds.length === 5) {
            latchHomeworlds();
        }
    });
    try {
        await tp.initializeFromExecutionStatusString(executionStatusStr);
        await savePromise;
        const executionStatus = tp.executionStatus.toJsonObject();
        const expectedExecutionStatus = JSON.parse(executionStatusStr);

        for (let i = 0; i < 6; i++) {
            expect(executionStatus.mvcc.includes(expectedExecutionStatus.mvcc[i]));
            // expect(executionStatus.plans[i]).toStrictEqual(expectedExecutionStatus.plans[i]);

        }
        // expect(tp.executionStatus.toJsonString()).toEqual(executionStatusStr);

        tp.setDataChangeCallback('/homeworlds', (homeworlds) => {
            if (homeworlds.length === 5) {
                latchHomeworlds();
            }
        })

        await homeworldsPromise;
        const expectedHomeworlds = [
            "Corellia",
            "Tatooine",
            "Alderaan",
            "Socorro",
            "Kashyyyk"
        ];
        const homeworlds = tp.output.homeworlds;
        // Ensure the array contains all the expected elements (we cannot expec them to be in a particular order
        //due to the async nature of $forked
        // const expectedHomeworlds = {};
        expect(expectedHomeworlds.every(element => homeworlds.includes(element))).toBe(true);
        //
        // // Ensure the array does not contain any elements not expected
        expect(homeworlds.every(element => expectedHomeworlds.includes(element))).toBe(true);
        //
        // // Ensure the array is exactly the same length as the expected array
        expect(homeworlds).toHaveLength(expectedHomeworlds.length);
        if (savedState.mvcc.length !== 6) {
            throw new Error(`Expected savedState.mvcc.length to be 6. SavedState.mvcc is \n ${JSON.stringify(savedState.mvcc, null, 2)}`);
        }
        expect(savedState.mvcc.length).toEqual(6); //5 names + 1 initialization of null name
        expect(savedState.plans.length).toEqual(5); //5 forks. Initial value of 'name' is not from a fork
    } finally {
        tp.close();
    }
},30000);