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
import jsonata from "jsonata";


export default class CliCore {
    private templateProcessor: TemplateProcessor;
    private logLevel: keyof typeof LOG_LEVELS;
    private currentDirectory:string;
    replServer:repl.REPLServer;

    constructor(templateProcessor: TemplateProcessor = null) {
        this.templateProcessor = templateProcessor;
        this.logLevel = "info";
        this.currentDirectory = process.cwd();
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

    async readFileAndParse(filepath, importPath?) {
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
        const input = await this.openFile(filepath);
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
        this.templateProcessor.context["open"] = this.openFile.bind(this); //$open('foo.json') is supported by the CLI adding $open function. It is not part of core TemplateProcessor as that would be security hole
        try {
            let tailPromise;
            if(tail !== undefined){
                tailPromise = this.tail(tail);
            }
            await this.templateProcessor.initialize(input);
            if(tail !== undefined){
                return tailPromise;
            }
            if (oneshot === true) {
                return this.templateProcessor.output;
            }
            return this.templateProcessor.input;

        } catch (error) {
            return {
                name: error.name,
                message: error.message
            };
        }

    }

    private async openFile(fname:string){
        let _filepath = fname;
        if(this.currentDirectory){
            _filepath = path.join(this.currentDirectory, _filepath);
        }
        return await this.readFileAndParse(_filepath);
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

    private extractArgsInfo(args) {
        // Define the regex patterns
        const jsonPointerNumberPattern = /^(?<jsonPointer>\/[^\s]*)(?:\s+(?<number>\d+))?$/;
        const untilJsonataPattern = /^(?<jsonPointer>\/[^\s]*)\s+until\s+(?<jsonataExpression>[^\n]+)$/;

        // Try to match the args string against both patterns
        const matchNumberFormat = args.match(jsonPointerNumberPattern);
        const matchUntilJsonataFormat = args.match(untilJsonataPattern);

        // Check which format was matched
        if (matchNumberFormat) {
            // Extracted information for <jsonPointer><spaces><integer> format
            const { jsonPointer, number } = matchNumberFormat.groups || {};
            if (jsonPointer) {
                return { format: "Number", jsonPointer, number: parseInt(number, 10) };
            }
        } else if (matchUntilJsonataFormat) {
            // Extracted information for <jsonPointer><spaces><until><spaces><jsonataExpression> format
            const { jsonPointer, jsonataExpression } = matchUntilJsonataFormat.groups || {};
            if (jsonPointer) {
                return { format: "UntilJsonata", jsonPointer, jsonataExpression };
            }
        }

        throw new Error(`invalid --tail args: ${args}`);
    }



    public async tail(args: string): Promise<any> {
        console.log("Started tailing... Press Ctrl+C to stop.")
        let {format, jsonPointer, number:countDown=NaN, jsonataExpression="false"} = this.extractArgsInfo(args);
        const compiledExpr = jsonata(jsonataExpression);

        let currentOutputLines = 0;

        // SIGINT listener to handle Ctrl+C press in REPL
        const onSigInt = () => {
            unplug();
        };

        // If this.replServer is defined (not in tests), register the SIGINT listener
        if (this.replServer) {
            this.replServer.on('SIGINT', onSigInt);
        }

        let resolve; //resolve function that will act as a latch to cause tail to return when the 'until' criterion is met
        // Function to stop tailing
        const unplug = () => {
            // Stop tailing without clearing the screen to keep the exit message
            this.templateProcessor.removeDataChangeCallback(jsonPointer);

            // If this.replServer is defined (not in tests), display the prompt and remove the SIGINT listener
            if (this.replServer) {
                this.replServer.removeListener('SIGINT', onSigInt);
            }
        };

        let _data;
        let done = false;
        // Data change callback
        const onDataChanged = async (data: any) => {
            if(done){
                return; //just ignore any latent callbacks
            }
            // Convert data to a string
            const output = StatedREPL.stringify(data);
            _data = JSON.parse(output); //save data so we can return the final value from the promise. It is important to return a snapshot via reparsing from string so that returned objects don't continue to 'evolve' and make testing impossible
            const outputLines = output.split('\n');


            // If in overwrite mode and output lines exist, move cursor up to clear previous lines
            for (let i = 0; i < currentOutputLines; i++) {
                //when we are running tests like from README.md autogenerated tests, there is no repl server
                //so we must check to make sure it exists before we write it
                this.replServer && this.replServer.output.write('\x1B[1A\x1B[K'); // Clear the line
            }


            if(isNaN(countDown) || countDown > 0) { //since the last value will be returned from this method and written by the REPL, we should not print it to screen
                // Write new data to the output
                this.replServer && this.replServer.output.write(output + '\n');
                // Update the current output lines count for the next change
                currentOutputLines = outputLines.length;
            }

            if(!isNaN(countDown)){
                countDown--;
            }

            if(countDown === 0 || await compiledExpr.evaluate(data)===true){
                done = true;
                unplug();
                resolve(); //resolve the latch promise
            }
        };


        // If countDown is greater than zero, return the Promise that resolves when countDown is zero
        const latch = new Promise<void>((_resolve) => {
                resolve = _resolve; //we assign our resolve variable that is declared outside this promise so that our onDataChange callbacks can use  it
        });

        // Register the onDataChanged callback with the templateProcessor
        this.templateProcessor.setDataChangeCallback(jsonPointer, onDataChanged);

        await latch; //waits for a onDataChanged callback to resolve the latch.

        return {
            "__tailed": true,
            "data":_data
        }; //the last result tailed to the screen is what this command returns
    }



    public async open(directory: string = this.currentDirectory) {
    if(directory === ""){
        directory = this.currentDirectory;
    }

    let files: string[] = undefined;
    try {
        // Read all files from the directory
        files = await fs.promises.readdir(directory);
    } catch (error) {
        console.log(`Error reading directory ${directory}: ${error}`);
        console.log('Changed directory with .cd or .open an/existing/directory');
        this.replServer.displayPrompt();
        return {error: `Error reading directory ${directory}: ${error}`};
    }
    // Filter out only .json and .yaml files
    const templateFiles: string[] = files.filter(file => file.endsWith('.json') || file.endsWith('.yaml'));

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
            const filepath = templateFiles[fileIndex];
            try {
                const result = await this.init(`-f "${filepath}"`);
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

