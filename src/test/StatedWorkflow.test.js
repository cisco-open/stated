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

test("test all", async () => {
    const statedWorkflow = new StatedWorkflow({
        "a": "${ function() { 'a' } }",
        "b": "${ function() { 'b' } }",
        "workflow1": "${ $serial([a,b]) }",
        "workflow2": "${ $parallel([a,b]) }"
    });
    await statedWorkflow.initialize();
    expect(statedWorkflow.templateProcessor.output.workflow1).toEqual(['a','b'])
    expect(statedWorkflow.templateProcessor.output.workflow2).toContain('a')
    expect(statedWorkflow.templateProcessor.output.workflow2).toContain('b')
});



