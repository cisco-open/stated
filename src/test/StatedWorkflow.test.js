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
import {StatedWorkflow} from '../StatedWorkflow.js';
import fs from 'fs';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import path from 'path';
import StatedREPL from "../StatedREPL.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        const originalValue = StatedREPL.printFunc(key, value);

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

test("pubsub", async () => {

    // Load the YAML from the file

    const yamlFilePath = path.join(__dirname, '../', '../', 'example', 'experimental', 'pubsub.yaml');
    // const yamlFilePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../', '../', 'example', 'experimental', 'pubsub.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    var template = yaml.load(templateYaml);
    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    while(tp.output.stop$ === 'still going'){
        await new Promise(resolve => setTimeout(resolve, 50)); // Poll every 50ms
    }
    expect(tp.output.rxLog.length).toBe(20);
}, 8000);

test("correlate", async () => {

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../', '../', 'example', 'experimental', 'correlate.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    var template = yaml.load(templateYaml);
    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    while(tp.output.state !== 'RECEIVED_RESPONSE'){
        await new Promise(resolve => setTimeout(resolve, 50)); // Poll every 50ms
    }
    expect(tp.output.state).toBe("RECEIVED_RESPONSE");
}, 8000);

test("workflow logs", async () => {

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../','../','example', 'experimental', 'wf.yaml');
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');

    // Parse the YAML
    var template = yaml.load(templateYaml);

    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    const {step1, step2} = tp.output;
    //correlate each workflowInvocation from step1's log to step2's log
    Object.keys(step1.log).forEach(workflowInvocation=> {
            const removeUncomparableTimestamps = JSON.parse(StatedREPL.stringify(step2.log[workflowInvocation], EnhancedPrintFunc.printFunc));
            expect(removeUncomparableTimestamps).toMatchObject({
                "start": {
                    "args": {
                        "name": "nozzleTime",
                        "primed": true
                        //order: 1 ...note we don't test for order because we can't guarantee which workflowInvocation contains 1 or 2
                    },
                    "timestamp": "--timestamp--"
                },
                "end": {
                    "out": {
                        "name": "nozzleTime",
                        "primed": true,
                        "sprayed": true
                    },
                    "timestamp": "--timestamp--"
                }
            })
        }
    );

    const expectedOutput = {
        "log": {
            "retention": {
                "maxWorkflowLogs": 100
            }
        },
        "myWorkflow$": "{function:}",
        "name": "nozzleWork",
        "start$": null,
        "step1": {
            "function": "{function:}",
            "log": {
                "1697347459331-9nhaf": {
                    "end": {
                        "out": {
                            "name": "nozzleTime",
                            "order": 1,
                            "primed": true
                        },
                        "timestamp": "--timestamp--"
                    },
                    "start": {
                        "args": {
                            "name": "nozzleTime",
                            "order": 1
                        },
                        "timestamp": "--timestamp--"
                    }
                },
                "1697347459331-fb9gc": {
                    "end": {
                        "out": {
                            "name": "nozzleTime",
                            "order": 2,
                            "primed": true
                        },
                        "timestamp": "--timestamp--"
                    },
                    "start": {
                        "args": {
                            "name": "nozzleTime",
                            "order": 2
                        },
                        "timestamp": "--timestamp--"
                    }
                }
            },
            "name": "primeTheNozzle"
        },
        "step2": {
            "function": "{function:}",
            "log": {
                "1697347459331-9nhaf": {
                    "end": {
                        "out": {
                            "name": "nozzleTime",
                            "order": 1,
                            "primed": true,
                            "sprayed": true
                        },
                        "timestamp": "--timestamp--"
                    },
                    "start": {
                        "args": {
                            "name": "nozzleTime",
                            "order": 1,
                            "primed": true
                        },
                        "timestamp": "--timestamp--"
                    }
                },
                "1697347459331-fb9gc": {
                    "end": {
                        "out": {
                            "name": "nozzleTime",
                            "order": 2,
                            "primed": true,
                            "sprayed": true
                        },
                        "timestamp": "--timestamp--"
                    },
                    "start": {
                        "args": {
                            "name": "nozzleTime",
                            "order": 2,
                            "primed": true
                        },
                        "timestamp": "--timestamp--"
                    }
                }
            },
            "name": "sprayTheNozzle"
        },
        "subscribeParams": {
            "filter$": "{function:}",
            "parallelism": 2,
            "source": "cloudEvent",
            "subscriberId": "nozzleWork",
            "testData": [
                {
                    "name": "nozzleTime",
                    "order": 1
                },
                {
                    "name": "nozzleTime",
                    "order": 2
                }
            ],
            "to": "{function:}",
            "type": "my-topic"
        }
    };
}, 10000);

test("recover completed workflow - should do nothing", async () => {

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../','../','example', 'experimental', 'wf-recover.yaml');
    const templateYaml =
    `
    recover$: $recover(step0)
    name: nozzleWork
    step0:
      name: entrypoint
      function: /\${  function($e){$e ~> $serial([step1, step2])}  }
      "log": {
            "1697402819332-9q6gg": {
              "start": {
                "timestamp": 1697402819332,
                "args": {
                  "name": "nozzleTime",
                  "order": 1
                }
              },
              "end": {
                "timestamp": 1697402826805,
                "out": {
                  "name": "nozzleTime",
                  "order": 1,
                  "primed": true,
                  "sprayed": true
                }
              }
            }
          }
    step1:
      name: primeTheNozzle
      function: \${   function($e){ $e~>|$|{'primed':true}|}  }
    step2:
      name: sprayTheNozzle
      function: \${function($e){ $e~>|$|{'sprayed':true}|  }}
`

    // Parse the YAML
    var template = yaml.load(templateYaml);

    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    const {step0, step1, step2} = tp.output;
    expect(step1.log).isUndefined;
    expect(step2.log).isUndefined;
    expect(step0.log).toEqual({ //the entry point log is completed (it has a start and an end) - so we don't do anything
        "1697402819332-9q6gg": {
            "start": {
                "timestamp": 1697402819332,
                "args": {
                    "name": "nozzleTime",
                    "order": 1
                }
            },
            "end": {
                "timestamp": 1697402826805,
                "out": {
                    "name": "nozzleTime",
                    "order": 1,
                    "primed": true,
                    "sprayed": true
                }
            }
        }
    });
}, 10000);

test("recover incomplete workflow - should rerun all steps", async () => {

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../','../','example', 'experimental', 'wf-recover.yaml');
    const templateYaml =
        `
    recover$: $recover(step0)
    name: nozzleWork
    step0:
      name: entrypoint
      function: /\${  function($e, $context){$e ~> $serial([step1, step2], $context)}  }
      "log": {
            "1697402819332-9q6gg": {
              "start": {
                "timestamp": 1697402819332,
                "args": {
                  "name": "nozzleTime",
                  "order": 1
                }
              }
          }
      }
    step1:
      name: primeTheNozzle
      function: \${   function($e){ $e~>|$|{'primed':true}|}  }
    step2:
      name: sprayTheNozzle
      function: \${function($e){ $e~>|$|{'sprayed':true}|  }}
`

    // Parse the YAML
    var template = yaml.load(templateYaml);

    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    const {step0, step1, step2} = tp.output;
    expect(step0.log['1697402819332-9q6gg'].end).exists;
    expect(step1.log['1697402819332-9q6gg'].start).exists;
    expect(step1.log['1697402819332-9q6gg'].end).exists;
    expect(step2.log['1697402819332-9q6gg'].start).exists;
    expect(step2.log['1697402819332-9q6gg'].end).exists;
    expect(step2.log['1697402819332-9q6gg'].end.out).toMatchObject({
        "name": "nozzleTime",
        "primed": true,
        "sprayed": true
    })
}, 10000);

test("recover incomplete workflow - step 1 is incomplete - should rerun steps 1 and 2", async () => {

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../','../','example', 'experimental', 'wf-recover.yaml');
    const templateYaml =
        `
    recover$: $recover(step0)
    name: nozzleWork
    step0:
      name: entrypoint
      function: /\${  function($e, $context){$e ~> $serial([step1, step2], $context)}  }
      "log": {
            "1697402819332-9q6gg": {
              "start": {
                "timestamp": 1697402819332,
                "args": {
                  "name": "nozzleTime",
                  "order": 1
                }
              }
          }
      }
    step1:
      name: primeTheNozzle
      function: \${   function($e){ $e~>|$|{'primed':true}|}  }
      "log": {
            "1697402819332-9q6gg": {
              "start": {
                "timestamp": 1697402819336,
                "args": {
                  "name": "nozzleTime",
                  "order": 1
                }
              }
          }
      }      
    step2:
      name: sprayTheNozzle
      function: \${function($e){ $e~>|$|{'sprayed':true}|  }}
`

    // Parse the YAML
    var template = yaml.load(templateYaml);

    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    const {step0, step1, step2} = tp.output;
    expect(step0.log['1697402819332-9q6gg'].end).exists;
    expect(step1.log['1697402819332-9q6gg'].start).exists;
    expect(step1.log['1697402819332-9q6gg'].end).exists;
    expect(step2.log['1697402819332-9q6gg'].start).exists;
    expect(step2.log['1697402819332-9q6gg'].end).exists;
    expect(step2.log['1697402819332-9q6gg'].end.out).toMatchObject({
        "name": "nozzleTime",
        "primed": true,
        "sprayed": true
    })
}, 10000);

test("workflow perf", async () => {
    console.time("workflow perf total time"); // Start the timer with a label

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../', '../', 'example', 'experimental', 'wfPerf01.yaml');
    console.time("Read YAML file"); // Start the timer for reading the file
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    console.timeEnd("Read YAML file"); // End the timer for reading the file

    // Parse the YAML
    console.time("Parse YAML"); // Start the timer for parsing the YAML
    var template = yaml.load(templateYaml);
    console.timeEnd("Parse YAML"); // End the timer for parsing the YAML

    // Initialize the template
    console.time("Initialize workflow"); // Start the timer for initializing the workflow
    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    console.timeEnd("Initialize workflow"); // End the timer for initializing the workflow

    console.timeEnd("workflow perf total time"); // End the total time timer
});


test("webserver", async () => {
    console.time("workflow perf total time"); // Start the timer with a label

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../', '../', 'example', 'experimental', 'wfHttp01.yaml');
    console.time("Read YAML file"); // Start the timer for reading the file
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    console.timeEnd("Read YAML file"); // End the timer for reading the file

    // Parse the YAML
    console.time("Parse YAML"); // Start the timer for parsing the YAML
    var template = yaml.load(templateYaml);
    console.timeEnd("Parse YAML"); // End the timer for parsing the YAML

    // Initialize the template
    console.time("Initialize workflow"); // Start the timer for initializing the workflow
    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    console.timeEnd("Initialize workflow"); // End the timer for initializing the workflow

    console.timeEnd("workflow perf total time"); // End the total time timer
});

test("downloaders", async () => {
    console.time("workflow perf total time"); // Start the timer with a label

    // Load the YAML from the file
    const yamlFilePath = path.join(__dirname, '../', '../', 'example', 'experimental', 'wfDownloads.yaml');
    console.time("Read YAML file"); // Start the timer for reading the file
    const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
    console.timeEnd("Read YAML file"); // End the timer for reading the file

    // Parse the YAML
    console.time("Parse YAML"); // Start the timer for parsing the YAML
    var template = yaml.load(templateYaml);
    console.timeEnd("Parse YAML"); // End the timer for parsing the YAML

    // Initialize the template
    console.time("Initialize workflow"); // Start the timer for initializing the workflow
    const tp = StatedWorkflow.newWorkflow(template);
    await tp.initialize();
    console.timeEnd("Initialize workflow"); // End the timer for initializing the workflow

    console.timeEnd("workflow perf total time"); // End the total time timer
}, 10000);




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


