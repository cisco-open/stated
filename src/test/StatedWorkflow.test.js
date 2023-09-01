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

test ("workflow logs", async () => {
    var template = {
        "testData": ['a', 'b', 'c'],
        "start$": "$nextCloudEvent(subscribeParams)",
        "subscriptionParams": {
            "type": "testdata:${ $testData }",
            "filter$": "function($e){ $e.name='nozzleTime' }",
            "to": "myWorkflow$",
            "parallelism": 2
        },
        "myWorkflow$": "function($e){$e ~> $serial([step1, step2], {name:nozzleWork})}",
        "step1": {
            "name": "primeTheNozzle",
            "function$": "function($e){ $e~>|$|{'primed':true}|  }"
        },
        "step2": {
            "name": "sprayTheNozzle",
            "function$": "function($e){ $e~>|$|{'sprayed':true}|  }"
        },
        "log": {
            "retention": {
                "maxRecords": 100,
                "maxDuration": "24h"
            },
            "nozzleWork": [
                [
                    {
                        "context": "nozzleWork-132494877",
                        "function": "primeTheNozzle",
                        "start": "30-aug-20203 02:45:02.124 PST",
                        "error": {
                            "timestamp": "30-aug-20203 02:45:02.359 PST",
                            "message": "unknown bingis fail"
                        },
                        "args": [
                            {
                                "name:nozzleTime": null,
                                "primed:false": null
                            }
                        ]
                    }
                ],
                [
                    {
                        "context": "nozzleWork-230838937",
                        "start": "30-aug-20203 05:22:02.124 PST",
                        "finish": "30-aug-20203 05:22:02.359 PST",
                        "out": {
                            "name:nozzleTime": null,
                            "primed:true": null
                        },
                        "args": [
                            {
                                "name:nozzleTime": null,
                                "primed:false": null
                            }
                        ]
                    },
                    {
                        "context": "nozzleWork-230838937",
                        "start": "30-aug-20203 05:22:02.124 PST",
                        "finish": "30-aug-20203 05:22:02.359 PST",
                        "out": {
                            "name:nozzleTime": null,
                            "primed:true": null,
                            "sprayed:true": null
                        },
                        "args": [
                            {
                                "name:nozzleTime": null,
                                "primed:true": null
                            }
                        ]
                    }
                ]
            ]
        }
    };
    const statedWorkflow = new StatedWorkflow(template);

    await statedWorkflow.initialize();
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



