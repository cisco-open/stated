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


function compareIgnoringDatesAndFunctions(obj1, obj2) {
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
        return obj1 === obj2;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
        return false;
    }

    for (const key of keys1) {
        if (!keys2.includes(key)) {
            return false;
        }

        if (typeof obj1[key] === 'number' && typeof obj2[key] === 'number') {
            // Assuming it's a date timestamp
            continue;
        } else if (obj1[key] === "{function:}" && typeof obj2[key] === 'function') {
            continue;
        } else if (!compareIgnoringDatesAndFunctions(obj1[key], obj2[key])) {
            return false;
        }
    }

    return true;
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
    
});

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



