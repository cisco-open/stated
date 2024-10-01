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
import minimist from "minimist";
import parseArgsStringToArgv from 'string-argv';
import {Levels, LOG_LEVELS} from "./ConsoleLogger.js";
import VizGraph from "./VizGraph.js";
import { exec } from 'child_process';
import  http from  'http';
import * as child_process from "child_process";
import os from "os";

/**
 * Base class for building CLIs. By itself can be used for a CLI that does not support the tail command. Tail command
 * uses Node repl class that is not implemented in other JS runtimes such as Bun. CliCoreBase should run in Bun.
 */
export class CliCoreBase {
    protected templateProcessor: TemplateProcessor;
    private logLevel: keyof typeof LOG_LEVELS;
    protected currentDirectory:string;
    //@ts-ignore
    private server: http.Server; //http server to serve SVG images
    public onInit: () => Promise<void>|void;

    constructor(templateProcessor: TemplateProcessor) {
        this.templateProcessor = templateProcessor;
        this.logLevel = "info";
        this.currentDirectory = process.cwd();
        this.onInit = ()=>{};
    }
    public async close(){
        if(this.templateProcessor){
            await this.templateProcessor.close();
        }
        if(this.server){
            this.server.close();
        }
    }


    static minimistArgs(replCmdInputStr:string) {
        const args = parseArgsStringToArgv(replCmdInputStr);
        return minimist(args);

    }
    static parseInitArgs(replCmdInputStr:string){

        const parsed = CliCoreBase.minimistArgs(replCmdInputStr);
        let {_:bareArgs ,f:filepath, o:oneshot,options="{}", ctx={}} = parsed;
        let tags:any = parsed.tags ||"";
        if(tags === true){ //weird case of --tags with no arguments
            tags = "";
        }
        if(tags===""){
            tags=[];
        }else {
            tags = tags.split(',').map((s:string) => s.trim()); //tags are provided as JSON array
        }
        try {
            options = JSON.parse(options);
        }catch(e:any){
            console.error("failed to parse --options json: " + e.message);
            throw e;
        }

        filepath = filepath?filepath:bareArgs[0];
        oneshot = oneshot===true?oneshot:bareArgs.length > 0;
        const processedArgs = {filepath, tags, oneshot, options, ctx};
        return {...parsed, ...processedArgs}; //spread the processedArgs back into what was parsed
    }

    async readFileAndParse(filepath:string, importPath?:string) {
        const fileExtension = path.extname(filepath).toLowerCase().replace(/\W/g, '');
        if (fileExtension === 'js' || fileExtension === 'mjs') {
            return await import(CliCoreBase.resolveImportPath(filepath, importPath));
        }

        const fileContent = await fs.promises.readFile(filepath, 'utf8');

        if (fileExtension === 'yaml' || fileExtension === 'yml') {
            return yaml.load(fileContent);
        }else if (fileExtension === 'text' || fileExtension === 'txt') {
            return fileContent;
        }else {
            return JSON.parse(fileContent);
        }
    }

    static isNodeEnvironment() {
        return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
    }


    static resolveImportPath(filepath: any, importPath: any): string {
        if (!filepath) throw new Error("filepath is required");

        // can't do any path resolution in browser
        if (!CliCoreBase.isNodeEnvironment()) return filepath;

        if (importPath) {
            if (filepath && filepath.startsWith("~")) throw new Error("Cannot use file path starting with '~' with importPath");
            if (filepath && filepath.startsWith("/")) throw new Error("Cannot use file path starting with '/' with importPath");
            if (importPath.startsWith("/")) return path.resolve(path.join(importPath, filepath))

            if (importPath.startsWith("~")) return path.resolve(path.join(importPath.replace("~", os.homedir()), filepath));

            //relative path
            return path.resolve(path.join(importPath, filepath));
        }

        if (filepath && filepath.includes("~")) return path.normalize(path.resolve(filepath.replace("~", os.homedir())));
        if (filepath && filepath.startsWith("/")) return path.normalize(filepath);
        return path.join(process.cwd(), filepath);
    }

    //replCmdInoutStr like:  -f "defaultSnapshot.json"

    /**
     * replCmdInoutStr example:  -f "example/restoreSnapshot.json" --tags=["PEACE"] --xf=example/myEnv.json
     * @param replCmdInputStr - the command line string that will be parsed into arguments
     */
    async restore(replCmdInputStr: string) {
        return this.init(replCmdInputStr, true);

    }

    /**
     * This Cli core command may be invoked directly from the REPL init command or from restore command
     *
     *  - fromSnapshot=false, replCmdInoutStr example:  -f "example/ex23.json" --tags=["PEACE"] --xf=example/myEnv.json
     *  - fromSnapshot=true, replCmdInoutStr example:  -f "example/restoreSnapshot.json" --tags=["PEACE"] --xf=example/myEnv.json
     *
     * @param replCmdInputStr
     * @param fromSnapshot - when set to true, template processor will treat input as a snapshot of a previous
     * templateProcessor state
     */
    async init(replCmdInputStr:string, fromSnapshot: boolean=false) {
        if(this.templateProcessor){
            this.templateProcessor.close();
        }
        const parsed:any = CliCoreBase.parseInitArgs(replCmdInputStr);
        const {filepath, tags,oneshot, options, xf:contextFilePath, importPath=this.currentDirectory, tail, ctx={}} = parsed;
        if(filepath===undefined){
            return undefined;
        }
        const input = await this.openFile(filepath);
        let contextData = contextFilePath ? await this.readFileAndParse(contextFilePath, importPath) : {};
        contextData = {...contextData, ...ctx} //--ctx.foo=bar creates ctx={foo:bar}. The dot argument syntax is built into minimist
        options.importPath = importPath; //path is where local imports will be sourced from. We sneak path in with the options
        // if we initialize for the first time, we need to create a new instance of TemplateProcessor
        if (!this.templateProcessor && !fromSnapshot) {
            this.templateProcessor = new TemplateProcessor(input, contextData, options);
        } else if (!this.templateProcessor && fromSnapshot) {
            this.templateProcessor = TemplateProcessor.constructFromSnapshotObject(input, contextData);
        } else { // if we are re-initializing, we need to reset the tagSet and options, if provided
            this.templateProcessor.tagSet = new Set();
            this.templateProcessor.options = options;
            if (contextData && Object.keys(contextData).length > 0) {
                this.templateProcessor.setupContext(contextData);
            }
        }
        this.templateProcessor.onInitialize.set("CLI",this.onInit);
        tags.forEach((a:string) => this.templateProcessor.tagSet.add(a));
        // set options
        this.templateProcessor.logger.level = this.logLevel;
        this.templateProcessor.logger.debug(`arguments: ${JSON.stringify(parsed)}`);
        this.templateProcessor.context["open"] = this.openFile.bind(this); //$open('foo.json') is supported by the CLI adding $open function. It is not part of core TemplateProcessor as that would be security hole
        try {
            let tailPromise;
            if(tail !== undefined){
                tailPromise = this.tail(tail);
            }
            if (fromSnapshot) { // restore from a snapshot
                await this.templateProcessor.initialize(undefined, "/", input);
            } else {
                await this.templateProcessor.initialize(input);
            }
            const {__init} = contextData;
            __init && __init(this.templateProcessor); //if a function named __init is found in the --xf, said context function is run
            if(tail !== undefined){
                return tailPromise;
            }
            if (oneshot === true) {
                return this.templateProcessor.output;
            }
            return this.templateProcessor.input;

        } catch (error:any) {
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


    async set(args:string) {
        const options:any = args.match(/(?:[^\s"]+|"[^"]*")+/g);
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

    out(replCmdInputStr:string) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const parsed = CliCoreBase.minimistArgs(replCmdInputStr === undefined ? "" : replCmdInputStr)
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

    from(args:string) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const [jsonPtr, option] = args.split(' ');
        return option === '--shallow' ? this.templateProcessor.getDependents(jsonPtr) : this.templateProcessor.from(jsonPtr);
    }

    to(args:string) {
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

    log(level:Levels) {
        this.logLevel = level;
        if(this.templateProcessor){
            this.templateProcessor.logger.level = level;
        }
        return {"log level":level};
    }

    note(){
        return "=============================================================";
    }

    async debug(replCmdInputStr:string) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const parsed = CliCoreBase.minimistArgs(replCmdInputStr)
        return this.templateProcessor.debugger.processCommands(parsed);
    }

    async errors() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.errorReport;
    }

    protected extractArgsInfo(args:string) {
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

    public svg(replCmdInputStr:string):string {
        const {port=3000} = CliCoreBase.minimistArgs(replCmdInputStr);

        const startServer = () => {
            this.server = http.createServer((req, res) => {
                // Check for a specific URL path or request method if needed

                // Execute 'dot' to convert the DOT code to SVG
                const dotProcess:child_process.ChildProcess = exec(`dot -Tsvg`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error converting DOT to SVG: ${error.message}`);
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Internal Server Error');
                        return;
                    }

                    if (stderr) {
                        console.error(`dot stderr: ${stderr}`);
                    }

                    // Set the response headers for SVG content
                    res.writeHead(200, {
                        'Content-Type': 'image/svg+xml',
                    });

                    // Send the SVG data as the HTTP response
                    res.end(stdout);
                });
                if(this.templateProcessor && dotProcess) {
                    const dot = VizGraph.dot(this.templateProcessor);
                    // Pipe the DOT code string to the 'dot' process
                    dotProcess.stdin?.write(dot);
                    dotProcess.stdin?.end();
                }
            });

            this.server.on('error', (error:any) => {
                if (error.code === 'EADDRINUSE') {
                    console.error(`Port ${port} is already in use.`);
                } else {
                    console.error(`Server error: ${error.message}`);
                }
            });

            this.server.listen(port, () => {
                console.log(`Server is running on port ${port}`);
            });
        };

        if (this.server) {
            // Server is already running, return its URL
            return `http://localhost:${port}`;
        } else {
            // Start the server and return its URL
            startServer();
            return `http://localhost:${port}`;
        }
    }

    /**
     * this method is just here as a stub to allow tests to pass. Color is in reality handled only by StatedRepl,
     * it is not something that is possible to 'see' from the CLI since CLI returns pure JSON which has no concept
     * of terminal colors.
     */
    color(){
        return;
    }

    getTemplateProcessor() {
        return this.templateProcessor;
    }

    public async tail(args: string): Promise<any> {
        throw new Error('tail command is not implemented in CliCoreBase');
    }
}

