// Copyright 2022 Cisco Systems, Inc.
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

class CliCore {
    constructor() {
        this.templateProcessor = null;
        this.logLevel = "info";
    }
    //oneShot is used when we don't want a REPL session and we just render the output
    async oneShot(filePath) {
        try {
            const fileContent = await fs.promises.readFile(filePath, 'utf8');
            //get the file extension and kill off any non word chars including quotes that may have surrounded it
            const fileExtension = path.extname(filePath).toLowerCase().replace(/\W/g, '');
            let input;
            if (fileExtension === 'yaml' || fileExtension === 'yml') {
                input = yaml.load(fileContent); // Parse YAML file
            } else {
                input = JSON.parse(fileContent); // Parse JSON file
            }
            this.templateProcessor = new TemplateProcessor(input);
            this.templateProcessor.logger.level = this.logLevel;
            await this.templateProcessor.initialize();
            return this.templateProcessor.output;
        } catch (error) {
            console.error(error);
        }
    }
    async init(args) {
        const options = args.match(/(?:[^\s"]+|"[^"]*")+/g);
        const [flag, templateOrFilePath] = options;
        let input;

        if (flag === '-f') {
            const fileContent = await fs.promises.readFile(templateOrFilePath.slice(1, -1), 'utf8');
            //get the file extension and kill off any non word chars including quotes that may have surrounded it
            const fileExtension = path.extname(templateOrFilePath).toLowerCase().replace(/\W/g, '');

            if (fileExtension === 'yaml' || fileExtension === 'yml') {
                input = yaml.load(fileContent); // Parse YAML file
            } else {
                input = JSON.parse(fileContent); // Parse JSON file
            }
        } else {
            input = JSON.parse(templateOrFilePath); // Parse JSON template
        }

        this.templateProcessor = new TemplateProcessor(input);
        this.templateProcessor.logger.level = this.logLevel;
        await this.templateProcessor.initialize();
        return this.templateProcessor.input;
    }

    async set(args) {
        const options = args.match(/(?:[^\s"]+|"[^"]*")+/g);
        let [path, data] = options;
        let jsonPtr = path;
        if (path === '-f') {
            try {
                // Read file
                const fileContent = await fs.promises.readFile(data, 'utf8');
                const tmp = JSON.parse(fileContent);
                jsonPtr = tmp.path; // Assumes the file contains an object with 'path' and 'data' properties
                data = tmp.data;
            } catch (err) {
                console.error('Error reading file:', err);
                throw err;
            }
        }

        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        try {
            data = JSON.parse(data);
        } catch (err) {
            console.error('Error parsing JSON data:', err);
            throw err;
        }

        await this.templateProcessor.setData(jsonPtr, data);
        return this.templateProcessor.output;
    }

    in() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.input;
    }

    out() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.output;
    }

    state() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.templateMeta;
    }

    from(args) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const [jsonPtr, option] = args.split(' ');
        return option === '--shallow' ? this.templateProcessor.getDependents(jsonPtr) : this.templateProcessor.getDependentsTransitiveExecutionPlan(jsonPtr);
    }

    to(args) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const [jsonPtr, option] = args.split(' ');
        return option === '--shallow' ? this.templateProcessor.getDependencies(jsonPtr) : this.templateProcessor.getDependenciesTransitiveExecutionPlan(jsonPtr);
    }

    async plan() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return await this.templateProcessor.getEvaluationPlan();
    }

    log(level) {
        this.logLevel = level;
        if(this.templateProcessor){
            this.templateProcessor.logger.level = level;
        }
        return undefined;
    }

    note(note){
        return "=============================================================";
    }
}

module.exports = CliCore;
