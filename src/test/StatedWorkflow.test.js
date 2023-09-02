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


class EnhancedPrintFunc {
    static isWorkflowId(value) {
        const pattern = /^\d{4}-\d{2}-\d{2}-\d{13}-[a-z0-9]{4,6}$/;
        const matched = pattern.test(value);
        return matched;
    }

    static isTimestamp(value) {
        // This will check for a 13 digit number, typical of a JavaScript timestamp
        return /^\d{13}$/.test(value.toString());
    }

    static printFunc(key, value) {
        const originalValue = stated.printFunc(key, value);

        // If stated.printFunc already handled and transformed the value, no need to check again
        if (originalValue !== value) {
            return originalValue;
        }

        if (EnhancedPrintFunc.isWorkflowId(value)) {
            return "--ignore--";
        }

        if (EnhancedPrintFunc.isTimestamp(value)) {
            return "--timestamp--";
        }

        return value;
    }

}

function sortLogs(output, workflowName) {
    const nozzleWorkLog = output.log[workflowName];
    const instanceExecutionLogs = [];
    const entries = Object.entries(nozzleWorkLog);
    entries.reduce((acc, [key, instanceExecutionLog]) => {
        acc.push(instanceExecutionLog);
        return acc;
    },instanceExecutionLogs);
    return instanceExecutionLogs.sort((a, b) => {
        let aOrder = a.execution[0].args[0].order;
        let bOrder = b.execution[0].args[0].order;
        return aOrder - bOrder;
    });
}


test("workflow logs", async () => {

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../','../','example', 'experimental', 'wf.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');

    // Parse the YAML
    var template = yaml.load(templateYaml);

    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    const sortedLog = sortLogs(tp.output, 'nozzleWork')
    const removeUncomparableTimestamps = JSON.parse(JSON.stringify(sortedLog,EnhancedPrintFunc.printFunc));
    const expectedLog = [
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 1
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 1,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 1,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 1,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 2
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 2,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 2,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 2,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 3
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 3,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 3,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 3,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 4
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 4,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 4,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 4,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 5
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 5,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 5,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 5,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 6
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 6,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 6,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 6,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 7
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 7,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 7,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 7,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 8
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 8,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 8,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 8,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 9
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 9,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 9,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 9,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        },
        {
            "execution": [
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 10
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 10,
                        "primed": true
                    },
                    "start": "--timestamp--",
                    "step": "primeTheNozzle"
                },
                {
                    "args": [
                        {
                            "name": "nozzleTime",
                            "order": 10,
                            "primed": true
                        }
                    ],
                    "end": "--timestamp--",
                    "out": {
                        "name": "nozzleTime",
                        "order": 10,
                        "primed": true,
                        "sprayed": true
                    },
                    "start": "--timestamp--",
                    "step": "sprayTheNozzle"
                }
            ],
            "info": {
                "end": "--timestamp--",
                "start": "--timestamp--",
                "status": "succeeded"
            }
        }
    ];
    expect(removeUncomparableTimestamps).toEqual(expectedLog);
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


