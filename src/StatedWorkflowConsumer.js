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

//This class is a wrapper around the TemplateProcessor class that provides workflow functionality
class StatedWorkflowConsumer {

    constructor(subscriptionParams) {
        this.subscriptionParams = subscriptionParams;
    }

    async initialize() {
        await this.templateProcessor.initialize();
    }

    //This function is called by the template processor to execute an array of stages in serial
    async serial(initialInput, stages) {
        let results = [];
        let currentInput = initialInput;
        for (let stage of stages) {
            if (stage.output.results.length > 0 || stage.output.errors.length > 0) {
                //if we have already run this stage, skip it
                console.log("Skipping stage " + stage.name)
                continue;
            }
            const result = await stage.function.apply(this, [currentInput]);
            stage.output.results.push(result);
            currentInput = result;
            results.push(result);
        }
        return results;
    }

    //This function is called by the template processor to execute an array of stages in parallel
    async parallel(initialInput, stages) {
        let promises = [];

        for (let stage of stages) {
            if (stage.output.results.length > 0 || stage.output.errors.length > 0) {
                //if we have already run this stage, skip it
                continue;
            }

            const promise = stage.function.apply(this, [initialInput])
                .then(result => {
                    stage.output.results.push(result);
                    return result;
                })
                .catch(error => {
                    stage.output.errors.push(error);
                    return error;
                });

            promises.push(promise);
        }

        return await Promise.all(promises);
    }
}

module.exports = StatedWorkflowConsumer;
