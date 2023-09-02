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
const StatedWorkflow = require('../StatedWorkflow');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const stated = require('../../stated');


function isTimestamp(value) {
    // This checks if the value is a valid timestamp (can be refined further)
    return !isNaN(new Date(value).getTime());
}
const visited = new WeakMap();

function deepCheck(expected, actual) {
    if (expected === null) {
        expect(actual).toBeNull();
        return;
    }


    // If expected has a timestamp placeholder, check if actual is a valid timestamp
    if (expected === '--timestamp--') {
        expect(isTimestamp(actual)).toBeTruthy();
        return;
    }

    if (expected === '--ignore--') return;

    // Handle primitives
    if (typeof expected !== 'object') {
        expect(actual).toEqual(expected);
        return;
    }

    // Detect circular references in expected
    if (visited.get(expected)) {
        throw new Error('Circular reference detected in expected object.');
    }
    visited.set(expected, true);

    const keysExpected = Object.keys(expected);
    const keysActual = Object.keys(actual);
    let idx = 0;
    for (const key of keysExpected) {
        if(key==="--ignore" || expected[key]==="--ignore--"){
            continue;
        }
        if(key==="--use-corresponding--"){
            deepCheck(expected[key], actual[keysActual[idx]]);
        }else {
            deepCheck(expected[key], actual[key]);
        }
        idx++;
    }


}
test("workflow logs", async () => {

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../','../','example', 'experimental', 'wf.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');

    // Parse the YAML
    var template = yaml.load(templateYaml);

    const tp = await StatedWorkflow.newWorkflow(template);

    // Assertions

    // 1. Existence of Log
    expect(tp.output).toHaveProperty('log');

    // 2. Log Retention Defaults
    const expectedRetention = {
        maxWorkflowLogs: 100
    };
    expect(tp.output.log.retention).toEqual(expectedRetention);

    // 3. Log Structure
    expect(tp.output.log).toHaveProperty('nozzleWork');
    if (tp.output.log.nozzleWork) {
        const workflowLogs = tp.output.log.nozzleWork;

        Object.keys(workflowLogs).forEach(logKey => {
            const logEntry = workflowLogs[logKey];
            if(logEntry.step === 'primeTheNozzle') {
                // Validate arguments for primeTheNozzle
                expect(logEntry.args).toEqual([{ name: 'nozzleTime', primed: false }]);

                // Validate output for primeTheNozzle
                expect(logEntry.out).toEqual({ name: 'nozzleTime', primed: true });
            } else if(logEntry.step === 'sprayTheNozzle') {
                // Validate arguments for sprayTheNozzle
                expect(logEntry.args).toEqual([{ name: 'nozzleTime', primed: true }]);

                // Validate output for sprayTheNozzle
                expect(logEntry.out).toEqual({ name: 'nozzleTime', primed: true, sprayed: true });
            }
        });
    }
    const fullExpectedOutput =    {
        "start$": null,
        "name": "nozzleWork",
        "subscribeParams": {
            "testData": [
                {
                    "name": "nozzleTime"
                }
            ],
            "type": "sys:cron",
            "filter$": "{function:}",
            "to": "{function:}",
            "parallelism": 2
        },
        "myWorkflow$": "{function:}",
        "step1": {
            "name": "primeTheNozzle",
            "function": "{function:}"
        },
        "step2": {
            "name": "sprayTheNozzle",
            "function": "{function:}"
        },
        "log": {
            "retention": {
                "maxWorkflowLogs": 100
            },
            "nozzleWork": {
                "--use-corresponding--": {
                    "info": {
                        "start": "--timestamp--",
                        "status": "succeeded",
                        "end": "--timestamp--"
                    },
                    "execution": [
                        {
                            "step": "primeTheNozzle",
                            "start": "--timestamp--",
                            "args": [
                                {
                                    "name": "nozzleTime"
                                }
                            ],
                            "end": "--timestamp--",
                            "out": {
                                "name": "nozzleTime",
                                "primed": true
                            }
                        },
                        {
                            "step": "sprayTheNozzle",
                            "start": "--timestamp--",
                            "args": [
                                {
                                    "name": "nozzleTime",
                                    "primed": true
                                }
                            ],
                            "end": "--timestamp--",
                            "out": {
                                "name": "nozzleTime",
                                "primed": true,
                                "sprayed": true
                            }
                        }
                    ]
                }
            }
        }
    };
    deepCheck(fullExpectedOutput, JSON.parse(JSON.stringify(tp.output, stated.printFunc)));
});
/*
test("test all", async () => {
    const tp = await StatedWorkflow.newWorkflow({
        "startEven": "tada",
        // a,b,c,d are workflow stages, which include a callable stated expression, and an output object to
        // store the results of the expression and any errors that occur
        // it will allow workflow stages to be skipped if they have already been run or stop processing next
        // stages if the current stage fails.
        "a": {
            "function": "${ function($in) { ( $console.log($in); [$in, 'a'] ~> $join('->') )} }",
            "output": {
                "results": [],
                "errors": {}
            }
        },
        "b": {
            "function": "${ function($in) { [$in, 'b'] ~> $join('->') } }",
            "output": {
                "results": [],
                "errors": {}
            }
        },
        "c": {
            "function": "${ function($in) { ( $console.log($in); [$in, 'c'] ~> $join('->') )} }",
            "output": {
                "results": [],
                "errors": {}
            }
        },
        "d": {
            "function": "${ function($in) { ( $console.log($in); [$in, 'd'] ~> $join('->') )} }",
            "output": {
                "results": [],
                "errors": {}
            }
        },
        "workflow1": "${ startEven ~> $serial([a, b]) }",
        "workflow2": "${ startEven ~> $parallel([c,d]) }"
    });
    expect(tp.output.workflow1)
        .toEqual(['tada->a','tada->a->b']);
    expect(tp.output.workflow2)
        .toEqual(expect.arrayContaining(['tada->c', 'tada->d']));
});
*/


