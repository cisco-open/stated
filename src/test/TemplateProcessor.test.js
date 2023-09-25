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
import { fileURLToPath } from 'url';
import { dirname } from 'path';


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
    tp.setDataChangeCallback("/", (data, jsonPtr) => {
        received.push({data, jsonPtr})
    });
    await tp.setData("/a", 42);
    expect(received).toEqual([
        {"data": 42, "jsonPtr": "/a"},
        {"data": 42, "jsonPtr": "/a"},
        {"data": 42, "jsonPtr": "/b"},
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
    const deps = tp.getDependenciesTransitiveExecutionPlan("/tmp/provider");
    expect(deps).toEqual(
        [
            "/providerName",
            "/count",
            "/tmp/provider"
        ]
    );

});


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
                    "/data/a/b/c/boom"
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
        "a":42,
        "b":"@DEV ${'if we are developing, then ' & a}",
        "c":"${a}", //no @DEV tag so this won't execute,
        "d":"  @DING    ${b}"
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
        "a":42,
        "msg":"I am env1",
        "tag": "env1"
    };

    const env2 = {
        "a":24,
        "msg":"I am env2",
        "tag": "env2"
    };
    const envs = [env1, env2];
    //randomly choose one of them
    const indexToUse = Math.floor(Math.random()*2);
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
    if(indexToUse === 0){
        expected = {
            "somethingAtInstallTime": "I am env1",
            "somethingDependsOnInstall": "I am env1...sure",
            "somethingElseAtInstallTime": "I am env1...somethingElseAtInstallTime",
            "somethingInCodex": "@CODEX ${'hi from codex'}",
            "somethingInDashboard": "@DASHBOARD ${'hi from dashboards'}"
        }
    }else{
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
});

test("shadow DEFAULT_FUNCTIONS fetch with hello", async () => {
    let template = {"fetchFunctionBecomesHello": "${$fetch('https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/foobar.json')}"};
    TemplateProcessor.DEFAULT_FUNCTIONS['fetch'] = ()=>'hello';
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    expect(tp.output).toStrictEqual({
        "fetchFunctionBecomesHello": "hello"
    })
});

test("replace DEFAULT_FUNCTIONS fetch with hello", async () => {
    let template = {"fetchFunctionBecomesHello": "${$fetch('https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/foobar.json')}"};
    const tp = new TemplateProcessor(template, {fetch:()=>"hello"});
    await tp.initialize();
    expect(tp.output).toStrictEqual({
        "fetchFunctionBecomesHello": "hello"
    })
});

test("strict.refs", async () => {
    let template = {
        "a":42,
        "b":"${a}",
        "c": "${z}",
        "d$":"c + a"
    };
    const tp = new TemplateProcessor(template, {}, {strict:{refs:true}});
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
        "a":42,
        "b":{
            "b1":10,
            "b2":"!${b1}",
        },
        "c":"!${a}"
    };
    const tp = new TemplateProcessor(template, {});
    await tp.initialize()
    expect(tp.output).toEqual({
        "a": 42,
        "b": {
            "b1": 10
        }
    })
});
test("remove temp vars", async () => {
    let template = {
        "a":42,
        "b":{
            "b1":10,
            "b2":"!${b1}",
            "b3": "!${b2+10}",
            "b4":{
                "b5":"!../${b3+10}",
                "b6":"  !  /${b.b3+10}",
                "b7":"  !/${b.b3+b.b2}",
                "b8":" !  ../${b3+b2}",
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
    expect(tp.getDependenciesTransitiveExecutionPlan('/view/0/2/0/1/warning')).toEqual([
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
    const importPath = path.join(__dirname, '../','../', 'example');
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
    const tp = new TemplateProcessor(template, {}, {importPath:'example'});
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




/*
leaving these two import tests commented out because unclear if programatically pushing in imports is what we want
test("import 2", async () => {
    const tp = new TemplateProcessor({
        "a": "${'hello A'}",
        "b": "${ c }"
    });
    await tp.initialize();
    await tp.import("${ 'hello from C' }", "/c")
    expect(tp.output).toEqual(
        {
            "a": "hello A",
            "b": "hello from C",
            "c": "hello from C"
        }
    );
});

test("import 3", async () => {
    const tp = new TemplateProcessor({
        "a": "${'hello A'}",
        "b": "${ c.c2 }",
        "x": "${ c.c3[1]}",
        "y": "${ c.c3 }"
    });
    await tp.initialize();
    await tp.import({
            "c2": "${ 'hello from c2' }",
            "c3": ["bing", "bang", "boom"],
        }, "/c")
    expect(tp.output).toEqual(
        {
            "a": "hello A",
            "b": "hello from c2",
            "c": {
                "c2": "hello from c2",
                "c3": [
                    "bing",
                    "bang",
                    "boom"
                ]
            },
            "x": "bang",
            "y": [
                "bing",
                "bang",
                "boom"
            ]
        }
    );
});

 */






