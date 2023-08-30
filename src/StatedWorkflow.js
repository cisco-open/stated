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
const fs = require('fs');
const path = require('path');
const TemplateProcessor = require('./TemplateProcessor');
const yaml = require('js-yaml');
const minimist = require('minimist');
const stringArgv = require('string-argv');

class StatedWorkflow {

    constructor(template) {
        this.context = {
            "serial": this.serial.bind(this),
            "parallel": this.parallel.bind(this)
        };
        this.templateProcessor = new TemplateProcessor(template, this.context);
        this.logLevel = "debug";
    }

    async initialize() {
        await this.templateProcessor.initialize();
    }

    async serial(stages) {
        const results = [];
        for (let stage of stages) {
            const result = await stage.apply(this, []);
            results.push(result);
        }
        return results;
    }

    async parallel(stages) {
        const promises = stages.map(stage => stage());
        return Promise.all(promises);
    }
}

module.exports = StatedWorkflow;

//if we run this file directly from the command line, it has no parent, and it means we want to
//fire it up. This allows us to import it in other places to get the stringify method without triggering this
if (!module.parent) {
    (async () => {
        const statedWorkflow = new StatedWorkflow();
        await statedWorkflow.initialize();
    })();
}
