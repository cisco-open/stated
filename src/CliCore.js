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

class CliCore {
    constructor() {
        this.templateProcessor = null;
        this.logLevel = "info";
    }

    static minimistArgs(replCmdInputStr) {
        const args = stringArgv.parseArgsStringToArgv(replCmdInputStr);
        return minimist(args);

    }
    static parseInitArgs(replCmdInputStr){

        const parsed = CliCore.minimistArgs(replCmdInputStr);
        let {_:bareArgs ,f:filepath, tags = "", o:oneshot,options="{}"} = parsed;
        if(tags === true){ //weird case of --tags with no arguments
            tags = "";
        }
        if(tags===""){
            tags=[];
        }else {
            tags = tags.split(',').map(s => s.trim()); //tags are provided as JSON array
        }
        options = JSON.parse(options);

        filepath = filepath?filepath:bareArgs[0];
        oneshot = oneshot===true?oneshot:bareArgs.length > 0;
        const processedArgs = {filepath, tags, oneshot, options};
        return {...parsed, ...processedArgs}; //spread the processedArgs back into what was parsed
    }

    async readFileAndParse(filepath) {
        const fileContent = await fs.promises.readFile(filepath, 'utf8');
        const fileExtension = path.extname(filepath).toLowerCase().replace(/\W/g, '');

        if (fileExtension === 'yaml' || fileExtension === 'yml') {
            return yaml.load(fileContent);
        } else {
            return JSON.parse(fileContent);
        }
    }

    //replCmdInoutStr like:  -f "example/ex23.json" --tags=["PEACE"] --xf=example/myEnv.json
    async init(replCmdInputStr) {
        const parsed = CliCore.parseInitArgs(replCmdInputStr);
        const {filepath, tags,oneshot, options, xf:contextFilePath} = parsed;
        if(filepath===undefined){
            return undefined;
        }
        const input = await this.readFileAndParse(filepath);
        const contextData = contextFilePath ? await this.readFileAndParse(contextFilePath) : {};

        this.templateProcessor = new TemplateProcessor(input, contextData, options);
        tags.forEach(a => this.templateProcessor.tagSet.add(a));
        this.templateProcessor.logger.level = this.logLevel;
        this.templateProcessor.logger.debug(`arguments: ${JSON.stringify(parsed)}`);

        if (oneshot === true) {
            await this.templateProcessor.initialize();
            return this.templateProcessor.output;
        } else {
            try {
                await this.templateProcessor.initialize();
                return this.templateProcessor.input;
            } catch (error) {
                return {
                    name: error.name,
                    message: error.message
                };
            }
        }
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

    out(replCmdInputStr) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const parsed = CliCore.minimistArgs(replCmdInputStr)
        let {_:jsonPointer=""} = parsed;
        if(Array.isArray(jsonPointer)){
            jsonPointer = jsonPointer[0];
            if(jsonPointer===undefined){
                jsonPointer = "";
            }
        }
        return this.templateProcessor.out(jsonPointer);
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

    async debug(replCmdInputStr) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const parsed = CliCore.minimistArgs(replCmdInputStr)
        return this.templateProcessor.debugger.processCommands(parsed);
    }
}

module.exports = CliCore;
