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
import fs from 'fs';
import path from 'path';
import TemplateProcessor from './TemplateProcessor.js';
import yaml from 'js-yaml';
import minimist from 'minimist';
import {parseArgsStringToArgv} from 'string-argv';
import {LOG_LEVELS} from "./ConsoleLogger.js";
import repl from 'repl';
import StatedREPL from "./StatedREPL.js";


export default class CliCore {
    private templateProcessor: TemplateProcessor;
    private logLevel: keyof typeof LOG_LEVELS;
    private currentDirectory:string;
    replServer:repl.REPLServer;

    constructor(templateProcessor: TemplateProcessor = null) {
        this.templateProcessor = templateProcessor;
        this.logLevel = "info";
        this.currentDirectory = path.join(process.cwd(), 'example'); // Default to cwd/example
    }
    public close(){
        if(this.templateProcessor){
            this.templateProcessor.close();
        }
    }
    public onInit: () => Promise<void>;

    static minimistArgs(replCmdInputStr) {
        const args = parseArgsStringToArgv(replCmdInputStr);
        return minimist(args);

    }
    static parseInitArgs(replCmdInputStr){

        const parsed = CliCore.minimistArgs(replCmdInputStr);
        let {_:bareArgs ,f:filepath, tags = "", o:oneshot,options="{}", tail} = parsed;
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

    async readFileAndParse(filepath, importPath) {
        const fileExtension = path.extname(filepath).toLowerCase().replace(/\W/g, '');
        if (fileExtension === 'js' || fileExtension === 'mjs') {
            return await import(CliCore.resolveImportPath(filepath, importPath));
        }

        const fileContent = await fs.promises.readFile(filepath, 'utf8');

        if (fileExtension === 'yaml' || fileExtension === 'yml') {
            return yaml.load(fileContent);
        } else {
            return JSON.parse(fileContent);
        }
    }

    static isNodeEnvironment() {
        return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
    }


    static resolveImportPath(filepath: any, importPath: any): string {
        if (!filepath) throw new Error("filepath is required");

        // can't do any path resolution in browser
        if (!CliCore.isNodeEnvironment()) return filepath;

        if (importPath) {
            if (filepath && filepath.startsWith("~")) throw new Error("Cannot use file path starting with '~' with importPath");
            if (filepath && filepath.startsWith("/")) throw new Error("Cannot use file path starting with '/' with importPath");
            if (importPath.startsWith("/")) return path.resolve(path.join(importPath, filepath))

            if (importPath.startsWith("~")) return path.resolve(path.join(importPath.replace("~", process.env.HOME), filepath));

            //relative path
            return path.resolve(path.join(process.cwd(), importPath, filepath));
        }

        if (filepath && filepath.includes("~")) return path.resolve(filepath.replace("~", process.env.HOME));
        if (filepath && filepath.startsWith("/")) return filepath;
        return path.join(process.cwd(), filepath);
    }

    //replCmdInoutStr like:  -f "example/ex23.json" --tags=["PEACE"] --xf=example/myEnv.json
    async init(replCmdInputStr) {
        if(this.templateProcessor){
            this.templateProcessor.close();
        }
        const parsed = CliCore.parseInitArgs(replCmdInputStr);
        const {filepath, tags,oneshot, options, xf:contextFilePath, importPath, tail} = parsed;
        if(filepath===undefined){
            return undefined;
        }
        const input = await this.readFileAndParse(filepath, importPath);
        const contextData = contextFilePath ? await this.readFileAndParse(contextFilePath, importPath) : {};
        options.importPath = importPath; //path is where local imports will be sourced from. We sneak path in with the options
        // if we initialize for the first time, we need to create a new instance of TemplateProcessor
        if (!this.templateProcessor) {
            this.templateProcessor = new TemplateProcessor(input, contextData, options);
        } else { // if we are re-initializing, we need to reset the tagSet and options, if provided
            this.templateProcessor.tagSet = new Set();
            this.templateProcessor.options = options;
            if (contextData) {
                this.templateProcessor.setupContext(contextData);
            }
        }
        if(this.replServer){
            //make variable called 'template' accessible in REPL
            this.replServer.context.template = this.templateProcessor;
        }
        this.templateProcessor.onInitialize = this.onInit;
        tags.forEach(a => this.templateProcessor.tagSet.add(a));
        // set options
        this.templateProcessor.logger.level = this.logLevel;
        this.templateProcessor.logger.debug(`arguments: ${JSON.stringify(parsed)}`);

        try {
            await this.templateProcessor.initialize(input);
            if (oneshot === true) {
                return this.templateProcessor.output;
            }
            if(tail !== undefined){
                return this.tail(tail);
            }
            return this.templateProcessor.input;

        } catch (error) {
            return {
                name: error.name,
                message: error.message
            };
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
        const parsed = CliCore.minimistArgs(replCmdInputStr === undefined ? "" : replCmdInputStr)
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
        return option === '--shallow' ? this.templateProcessor.getDependents(jsonPtr) : this.templateProcessor.from(jsonPtr);
    }

    to(args) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const [jsonPtr, option] = args.split(' ');
        return option === '--shallow' ? this.templateProcessor.getDependencies(jsonPtr) : this.templateProcessor.to(jsonPtr);
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
        return {"log level":level};
    }

    note(){
        return "=============================================================";
    }

    async debug(replCmdInputStr) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const parsed = CliCore.minimistArgs(replCmdInputStr)
        return this.templateProcessor.debugger.processCommands(parsed);
    }

    async errors() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.errorReport;
    }

    public tail(args: string): string {
        const [jsonPointer, changeCountArg] = args.split(' ');
        let changeCount = changeCountArg!==undefined ? parseInt(changeCountArg, 10) : undefined;

        // Determine if we are in overwrite mode based on changeCount being 0
        const overwriteMode = changeCount === 0;
        let currentOutputLines = 0;
        // SIGINT listener to handle Ctrl+C press in REPL
        const onSigInt = () => {
            unplug();
        };
        if(this.replServer) { //tests would not provide replServer
            this.replServer.on('SIGINT', onSigInt);
        }
        const unplug = ()=>{
            // Stop tailing without clearing the screen to keep the exit message
            this.templateProcessor.removeDataChangeCallback(jsonPointer);
            currentOutputLines = 0;
            if(this.replServer){
                this.replServer.displayPrompt();
                this.replServer.removeListener('SIGINT', onSigInt);
            }
        }

        // Data change callback
        const onDataChanged = (data: any) => {
            const output = StatedREPL.stringify(data); // Use the actual implementation of stringify
            const outputLines = output.split('\n');
            if (overwriteMode && currentOutputLines > 0) {
                // Move cursor up by the number of lines previously outputted
                for (let i = 0; i < currentOutputLines; i++) {
                    this.replServer.output.write('\x1B[1A\x1B[K'); // Clear the line
                }
            }

            // Write new data
            this.replServer.output.write(output + '\n');

            // Update the current output lines count for the next change
            currentOutputLines = overwriteMode ? outputLines.length : 0;
            //if we are in regularTail mode, and we counted down to zero the number of changes
            //then unplug
            if(!overwriteMode && --changeCount==0){
                unplug();
            }

        };

        // Register the onDataChanged callback with the templateProcessor
        this.templateProcessor.setDataChangeCallback(jsonPointer, onDataChanged);
        return "Started tailing... Press Ctrl+C to stop.";
    }



public async open(directory: string = this.currentDirectory) {
    if(directory === ""){
        directory = this.currentDirectory;
    }
    // Read all files from the directory
    const files = await fs.promises.readdir(directory);
    // Filter out only .json and .yaml files
    const templateFiles = files.filter(file => file.endsWith('.json') || file.endsWith('.yaml'));

    // Display the list of files to the user
    templateFiles.forEach((file, index) => {
        console.log(`${index + 1}: ${file}`);
    });

    // Create an instance of AbortController
    const ac = new AbortController();
    const { signal } = ac; // Get the AbortSignal from the controller

    // Ask the user to choose a file
    this.replServer.question('Enter the number of the file to open (or type "abort" to cancel): ', { signal }, async (answer) => {
        // Check if the operation was aborted
        if (signal.aborted) {
            console.log('File open operation was aborted.');
            this.replServer.displayPrompt();
            return;
        }

        const fileIndex = parseInt(answer, 10) - 1; // Convert to zero-based index
        if (fileIndex >= 0 && fileIndex < templateFiles.length) {
            // User has entered a valid file number; initialize with this file
            const filepath = path.join(directory, templateFiles[fileIndex]);
            try {
                const result = await this.init(`-f "${filepath}"`); // Adjust this call as per your init method's expected format
                console.log(StatedREPL.stringify(result));
                console.log("...try '.out' or 'template.output' to see evaluated template")
            } catch (error) {
                console.log('Error loading file:', error);
            }
        } else {
            console.log('Invalid file number.');
        }

        this.replServer.displayPrompt();
    });

    // Allow the user to type "abort" to cancel the file open operation
    this.replServer.once('SIGINT', () => {
        ac.abort();
    });

    return "open... (type 'abort' to cancel)";
}


    public cd(newDirectory: string) {
        // Resolve the new path against the current directory to support relative paths
        const resolvedNewDirectory = path.resolve(this.currentDirectory, newDirectory);

        // Check if the resolved new directory path is valid
        if (fs.existsSync(resolvedNewDirectory) && fs.lstatSync(resolvedNewDirectory).isDirectory()) {
            this.currentDirectory = resolvedNewDirectory;
            return `Current directory changed to: ${this.currentDirectory}`;
        } else {
            return `Invalid directory: ${newDirectory}`;
        }
    }



}

