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

import {default as jp} from './JsonPointer.js';
import isEqual from "lodash-es/isEqual.js";
import merge from 'lodash-es/merge.js';
import yaml from 'js-yaml';
import MetaInfoProducer, {JsonPointerString, JsonPointerStructureArray, MetaInfo} from './MetaInfoProducer.js';
import DependencyFinder from './DependencyFinder.js';
import path from 'path';
import fs from 'fs';
import ConsoleLogger, {Levels, LOG_LEVELS, StatedLogger} from "./ConsoleLogger.js";
import FancyLogger from "./FancyLogger.js";
import {TimerManager} from "./TimerManager.js";
import {stringifyTemplateJSON} from './utils/stringify.js';
import {debounce} from "./utils/debounce.js"
import {rateLimit} from "./utils/rateLimit.js"
import {ExecutionStatus} from "./ExecutionStatus.js";
import {Sleep} from "./utils/Sleep.js";
import {saferFetch} from "./utils/FetchWrapper.js";
import * as jsonata from "jsonata";
import StatedREPL from "./StatedREPL.js";

declare const BUILD_TARGET: string | undefined;

export type MetaInfoMap = Record<JsonPointerString, MetaInfo[]>;
export type Snapshot = {template:object, output: any, options:{}, mvcc: any, metaInfoByJsonPointer: any, plans: any}
export type StatedError = {
    error: {
        message: string;
        name?: string;
        stack?: string | null;
    };
};
export type Op = "set"|"delete"|"forceSetInternal";
export type Fork = {forkId:string, output:object};
export type Plan = {
    sortedJsonPtrs:JsonPointerString[],
    restoreJsonPtrs:JsonPointerString[], //this is dependencies (functions and intervals/timeouts) we need to initialize on restore from a snapshot before we can evaluate the plan
    didUpdate: boolean[] //peers with sortedJsonPointers, tells us which of those locations in output actually updated
    data?:any, op?:Op, //if present and op="set", the data is applied to first json pointer
    output:object,
    forkId:string,
    forkStack:Fork[] //allows us to have nested execution contexts that cen restored by popping this stack onto output
    lastCompletedStep?:PlanStep,
};
type SnapshotPlan = {//a plan that simply dumps a snapshot
    op:"snapshot",
    generatedSnapshot: string
};
export type PlanStep = {
    jsonPtr:JsonPointerString,
    data?:any,
    op?:Op,
    output:object,
    forkStack:Fork[],
    forkId:string,
    didUpdate:boolean
}
/**
 * a FunctionGenerator is used to generate functions that need the context of which expression they were called from
 * which is made available to them in the MetaInf
 */
export type FunctionGenerator = (metaInfo: MetaInfo, templateProcessor: TemplateProcessor) => (Promise<(arg: any) => Promise<any>>);

/**
 * defines the function signature for data change callbacks, called when data at the ptr changes
 */
export type DataChangeCallback = (data:any, ptr:JsonPointerString, removed?:boolean)=>void



/**
 * This is the main TemplateProcessor class.
 *
 * @remarks
 * The TemplateProcessor class is responsible for processing templates and interfacing with your program that may
 * provide changing inputs over time and react to changes with callbacks. Many examples can be found in
 * `src/test/TemplateProcessor.test.js`
 *
 * @example Initialize a simple template stored in local object 'o'
 * ```
 * //initialize a simple template stored in local object 'o'
 * test("test 6", async () => {
 *     const o = {
 *         "a": 10,
 *         "b": [
 *             "../${a}",
 *         ]
 *     };
 *     const tp = new TemplateProcessor(o);
 *     await tp.initialize();
 *     expect(o).toEqual({
 *         "a": 10,
 *         "b": [10]
 *     });
 * });
 * ```
 * @example Pass the TemplateProcessor a context containing a function named `nozzle` and a variable named `ZOINK`
 * ```
 * //Pass the TemplateProcessor a context containing a function named `nozzle` and a variable named `ZOINK`
 * test("context", async () => {
 *     const nozzle = (something) => "nozzle got some " + something;
 *     const context = {"nozzle": nozzle, "ZOINK": "ZOINK"}
 *     const tp = new TemplateProcessor({
 *         "a": "${$nozzle($ZOINK)}"
 *     }, context);
 *     await tp.initialize();
 *     expect(tp.output).toEqual(
 *         {
 *             "a": "nozzle got some ZOINK",
 *         }
 *     );
 * });
 * ```
 * @example Parse template from JSON or YAML
 * ```
 *     it('should correctly identify and parse JSON string', async () => {
 *         const jsonString = '{"key": "value"}';
 *         const instance = TemplateProcessor.fromString(jsonString);
 *         await instance.initialize();
 *         expect(instance).toBeInstanceOf(TemplateProcessor);
 *         expect(instance.output).toEqual({ key: "value" });  // Assuming parsedObject is publicly accessible
 *     });
 *
 *     it('should correctly identify and parse YAML string using ---', async () => {
 *         const yamlString = `---
 * key: value`;
 *         const instance = TemplateProcessor.fromString(yamlString);
 *         await instance.initialize();
 *         expect(instance).toBeInstanceOf(TemplateProcessor);
 *         expect(instance.output).toEqual({ key: "value" });
 *     });
 *  ```
 *  @example React to changes using data change callbacks on various locations in the template
 *  ```
 *  test("test 1", async () => {
 *     const tp = new TemplateProcessor({
 *         "a": "aaa",
 *         "b": "${a}"
 *     });
 *     await tp.initialize();
 *     const received = [];
 *     tp.setDataChangeCallback("/a", (data, jsonPtr) => {
 *         received.push({data, jsonPtr})
 *     });
 *     tp.setDataChangeCallback("/b", (data, jsonPtr) => {
 *         received.push({data, jsonPtr})
 *     });
 *     tp.setDataChangeCallback("/", (data, jsonPtr) => {
 *         received.push({data, jsonPtr})
 *     });
 *     await tp.setData("/a", 42);
 *     expect(received).toEqual([
 *         {
 *             "data": 42,
 *             "jsonPtr": "/a"
 *         },
 *         {
 *             "data": 42,
 *             "jsonPtr": "/b"
 *         },
 *         {
 *             "data": {
 *                 "a": 42,
 *                 "b": 42
 *             },
 *             "jsonPtr": [
 *                 "/a",
 *                 "/b"
 *             ]
 *         }
 *     ]);
 * });
 * ```
 */

export default class TemplateProcessor {
    /**
     * Loads a template and initializes a new template processor instance.
     *
     * @static
     * @param {Object} template - The template data to be processed.
     * @param {Object} [context={}] - Optional context data for the template.
     * @returns {Promise<TemplateProcessor>} Returns an initialized instance of `TemplateProcessor`.
     */
    static async load(template:object, context = {}):Promise<TemplateProcessor> {
        const t = new TemplateProcessor(template, context);
        await t.initialize();
        return t;
    }

    /**
     * Default set of functions provided for the template processor.
     *
     * @remarks
     * These functions are commonly used utilities available for
     * usage within the template processor's context. You can replace set this to
     * determine which functions are available from templates
     *
     * @static
     * @type {{
     *   fetch: typeof fetch,
     *   setInterval: typeof setInterval,
     *   clearInterval: typeof clearInterval,
     *   setTimeout: typeof setTimeout,
     *   console: Console
     * }}
     */
    static DEFAULT_FUNCTIONS = {
        fetch:saferFetch,
        setTimeout,
        console,
        debounce,
        Date,
        rateLimit
    }

    private static _isNodeJS = typeof process !== 'undefined' && process.release && process.release.name === 'node';

    /** Represents the logger used within the template processor. */
    logger: StatedLogger;

    /** Contextual data for the template processing. */
    context: any;

    /** Contains the processed output after template processing. */
    output: {}={};

    /** Represents the raw input for the template processor. */
    input: any;

    /** This object mirrors the template output in structure but where the output contains actual data,
     * this object contains MetaInfo nodes that track metadata on the actual nodes */
    templateMeta: any;

    /** List of warnings generated during template processing. */
    warnings: any[] = [];

    /** Maps JSON pointers of import paths to their associated meta information. */
    metaInfoByJsonPointer: MetaInfoMap={};

    /** A set of tags associated with the template. */
    tagSet: Set<string>;

    /** Configuration options for the template processor. */
    options: any = {};

    /** Debugger utility for the template processor. */
    debugger: any;

    /** Contains any errors encountered during template processing. */
    errorReport: {[key: JsonPointerString]:any}={};

    /** Execution plans 'from' a given JSON Pointer. So key is JSON Pointer and value is array of JSON
     * pointers (a plan) */
    private executionPlans: { [key: JsonPointerString]: JsonPointerString[] }={};

    /** A queue of execution plans awaiting processing. */
    private readonly executionQueue:(Plan|SnapshotPlan)[] = [];

    /** function generators can be provided by a caller when functions need to be
     *  created in such a way that they are somehow 'responsive' or dependent on their
     *  location inside the template. Both the generator function, and the function
     *  it generates are asynchronous functions (ie they return a promise).
     *  $import is an example of this kind of behavior.
     *  When $import('http://mytemplate.com/foo.json') is called, the import function
     *  is actually genrated on the fly, using knowledge of the json path that it was
     *  called at, to replace the content of the template at that path with the downloaded
     *  content.*/
    functionGenerators: Map<string, FunctionGenerator>;

    /** for every json pointer, we have multiple callbacks that are stored in a Set
     * @private
     */
    private changeCallbacks:Map<JsonPointerString, Set<DataChangeCallback>>;

    /** Flag indicating if the template processor is currently initializing. */
    private isInitializing: boolean;

    /** A unique identifier for the template processor instance. */
    private readonly uniqueId;

    private tempVars:JsonPointerString[]=[];

    private timerManager:TimerManager;

    /** Allows caller to set a callback to propagate initialization into their framework */
    public readonly onInitialize: Map<string,() => Promise<void>|void>;

    /**
     * Allows a caller to receive a callback after the template is evaluated, but before any temporary variables are
     * removed. This function is slated to be replaced with a map of functions like onInitialize
     * @deprecated
     */
    public postInitialize: ()=> Promise<void> = async () =>{};

    public executionStatus: ExecutionStatus;





    public static fromString(template:string, context = {}, options={} ):TemplateProcessor{
            let inferredType: "JSON" | "YAML" | "UNKNOWN" = "UNKNOWN";

            // Check for JSON
            if (template.trim().startsWith('{') || template.trim().startsWith('[')) {
                inferredType = "JSON";
            }
            // Check for YAML
            else if (template.includes('---') || /[^":]\s*:\s*[^"]/g.test(template)) {
                inferredType = "YAML";
            }

            let parsedObject;

            // Based on the inferred type, parse the string
            if (inferredType === "JSON") {
                parsedObject = JSON.parse(template);
            } else if (inferredType === "YAML") {
                parsedObject = yaml.load(template);
            } else {
                throw new Error("Unknown format");
            }

            // Return an instance of TemplateProcessor with the parsed object
            return new TemplateProcessor(parsedObject, context, options);
    }

    constructor(template={}, context = {}, options={}) {
        this.timerManager = new TimerManager(this); //prevent leaks from $setTimeout and $setInterval
        this.uniqueId = Math.random()*1e6;
        this.setData = this.setData.bind(this); // Bind template-accessible functions like setData and import
        this.import = this.import.bind(this); // allows clients to directly call import on this TemplateProcessor
        this.logger = new ConsoleLogger("info");
        this.setupContext(context);
        this.resetTemplate(template);
        this.options = options;
        this.isInitializing = false;
        this.changeCallbacks = new Map();
        this.functionGenerators = new Map();
        this.tagSet = new Set();
        this.onInitialize = new Map();
        this.executionStatus = new ExecutionStatus(this);
    }

    // resetting template means that we are resetting all data holders and set up new template
    private resetTemplate(template:object) {
        this.input = JSON.parse(JSON.stringify(template));
        this.output = template; //initial output is input template
        this.templateMeta = JSON.parse(JSON.stringify(template));// Copy the given template to `initialize the templateMeta
        this.warnings = [];
        this.metaInfoByJsonPointer = {}; //there will be one key "/" for the root and one additional key for each import statement in the template
        this.errorReport = {}
        this.tempVars = [];
    }

    setupContext(context: {}) {
        this.context = merge(
            {},
            TemplateProcessor.DEFAULT_FUNCTIONS,
            {"save": (output:object)=>{ //default implementation of save just logs the execution status
                    if (this.isEnabled("debug")){
                        console.debug(this.executionStatus.toJsonString());
                    }
                    return output;
            }}, //note that save is before context, by design, so context can override save as needed
            context,
            {"set": this.setData},
            {"sleep": new Sleep(this.timerManager).sleep}
        );
        const safe = this.withErrorHandling.bind(this);
        for (const key in this.context) {
            if (typeof this.context[key] === 'function') {
                if (key === "setTimeout" || key === "setInterval") {
                    //replace with wrappers that allow us to ensure we kill all prior timers when template re-inits
                    // this.context[key] = this.timerManager[key].bind(this.timerManager);
                    //TODO: remove it after migrating to generated function
                } else {
                    this.context[key] = safe(this.context[key]);
                }
            }
        }
    }


    /**
     * Template processor initialize can be called from 2 major use cases
     *   1. initialize a new importedSubtemplate processor importedSubtemplate
     *   2. $import a new importedSubtemplate for an existing importedSubtemplate processor
     *   in the second case we need to reset the importedSubtemplate processor data holders
     * @param importedSubtemplate - the object representing the importedSubtemplate
     * @param jsonPtr - defaults to "/" which is to say, this importedSubtemplate is the root importedSubtemplate. When we $import a importedSubtemplate inside an existing importedSubtemplate, then we must provide a path other than root to import into. Typically, we would use the json pointer of the expression where the $import function is used.
     * @param snapshottedOutput - if provided, output is set to this initial value
     *
     */
    public async initialize(importedSubtemplate: {}|undefined = undefined, jsonPtr: string = "/", executionStatusSnapshot: {}|undefined = undefined):Promise<void> {
        if(jsonPtr === "/"){
            this.timerManager.clearAll();
            this.executionStatus.clear();
        }

        // if initialize is called with a importedSubtemplate and root json pointer (which is "/" b default)
        // we need to reset the importedSubtemplate. Otherwise, we rely on the one provided in the constructor
        if (importedSubtemplate !== undefined && jsonPtr === "/") {
            this.resetTemplate(importedSubtemplate)
        }
        if (executionStatusSnapshot !== undefined) {
            this.executionStatus = ExecutionStatus.createExecutionStatusFromJson(this, executionStatusSnapshot);
            // here we restore metaInfoByJsonPointer from the executionStatus
            this.templateMeta = {};

            // compiles jsonata expressions and recreates templateMeta
            this.executionStatus.metaInfoByJsonPointer["/"]?.forEach(
                (metaInfo) => {
                    if (metaInfo.expr__ !== undefined) {
                        metaInfo.compiledExpr__ = jsonata.default(metaInfo.expr__ as string);
                    }

                    jp.set(this.templateMeta, metaInfo.jsonPointer__ === "" ? "/" : metaInfo.jsonPointer__, metaInfo);

                });
        }

        if (jsonPtr === "/" && this.isInitializing) {
            console.error("-----Initialization '/' is already in progress. Ignoring concurrent call to initialize!!!! Strongly consider checking your JS code for errors.-----");
            return;
        }

        // Set the lock
        this.isInitializing = true;
        //run all initialization plugins
        for (const [name, task] of this.onInitialize) {
            this.logger.debug(`Running onInitialize plugin '${name}'...`);
            await task();
        }
        try {
            if (jsonPtr === "/") {
                this.errorReport = {}; //clear the error report when we initialize a root importedSubtemplate
            }

            if (typeof BUILD_TARGET !== 'undefined' && BUILD_TARGET !== 'web') {
                const _level = this.logger.level; //carry the ConsoleLogger level over to the fancy logger
                this.logger = await FancyLogger.getLogger() as StatedLogger;
                this.logger.level = _level;
            }

            this.logger.verbose(`initializing (uid=${this.uniqueId})...`);
            this.logger.debug(`tags: ${JSON.stringify(Array.from(this.tagSet))}`);
            if (executionStatusSnapshot === undefined) {
                this.executionPlans = {}; //clear execution plans
            }
            let parsedJsonPtr:JsonPointerStructureArray = jp.parse(jsonPtr);
            parsedJsonPtr = parsedJsonPtr.filter(e=>e!=="");//isEqual(parsedJsonPtr, [""]) ? [] : parsedJsonPtr; //correct [""] to []
            let compilationTarget;
            if(jsonPtr === "/"){ //this is the root, not an imported sub-importedSubtemplate
                compilationTarget = this.input; //standard case
            }else{
                compilationTarget = importedSubtemplate; //the case where we already initialized once, and now we are initializing an imported sub-template
            }
            // Recretaing the meta info if execution status is not provided
            if (executionStatusSnapshot === undefined) {
                const metaInfos = await this.createMetaInfos(compilationTarget , parsedJsonPtr);
                this.metaInfoByJsonPointer[jsonPtr] = metaInfos; //dictionary for importedSubtemplate meta info, by import path (jsonPtr)
                this.sortMetaInfos(metaInfos);
                this.populateTemplateMeta(metaInfos);
                this.setupDependees(metaInfos); //dependency <-> dependee is now bidirectional
                this.propagateTags(metaInfos);
                this.tempVars = [...this.tempVars, ...this.cacheTmpVarLocations(metaInfos)];
                await this.evaluateInitialPlan(jsonPtr);
            } else {
                await this.executionStatus.restore(this);
            }
            await this.postInitialize();
            this.removeTemporaryVariables(this.tempVars, jsonPtr);
            this.logger.verbose("initialization complete...");
            this.logOutput(this.output);
        }finally {
            this.isInitializing = false;
        }
    }

    close():void{
        this.timerManager.clearAll();
        this.changeCallbacks.clear();
        this.executionStatus.clear();
    }

    private async evaluateInitialPlan(jsonPtr:JsonPointerString) {
        const startTime = Date.now(); // Capture start time
        this.logger.verbose(`evaluating template (uid=${this.uniqueId})...`);
        await this.evaluateInitialPlanDependencies(this.metaInfoByJsonPointer[jsonPtr]);
        const endTime = Date.now(); // Capture end time

        this.logger.verbose(`evaluation complete in ${endTime - startTime} ms...`);

        //the commented out approach below us necessary if we want to push in imports. It has the unsolved problem
        //that if the existing template has dependencies on the to-be-imported template, and we are not forcing it
        //in externally but rather the import is written as part of the template that the things that depend on the
        //import will be executed twice.
        /*
        const rootMetaInfos = this.metaInfoByJsonPointer["/"];
        if (jsonPtr === "/") { //<-- root/parent template
            await this.evaluateInitialPlanDependencies(rootMetaInfos);
        } else {  //<-- child/imported template
            //this is the case of an import. Imports target something other than root
            const importedMetaInfos = this.metaInfoByJsonPointer[jsonPtr];
            await this.evaluateInitialPlanDependencies([
                ...TemplateProcessor.dependsOnImportedTemplate(rootMetaInfos, jsonPtr),
                ...importedMetaInfos
            ]);
        }

         */
    }

    //this is used to wrap all functions that we expose to jsonata expressions so that
    //they do not throw exceptions, but instead return {"error":{...the error...}}
    private withErrorHandling<T extends any[]>(fn:(...args:T)=>any) {
        return (...args:T) => {
            try {
                const result = fn(...args);
                if (result instanceof Promise) {
                    return result.catch(error => {
                        this.logger.error(error.toString());

                        let {
                            message = 'no message available',
                            name = 'no name available',
                            stack = 'no stack available',
                        } = error;
                        if (error.cause) {
                            const {
                                message: causeMessage = 'no message available',
                                name: causeName = 'no name available',
                                stack: causeStack = 'no stack available',
                            } = error.cause;
                            if (causeMessage) message = `${message}: ${causeMessage}`;
                            if (causeName) name = `${name}: ${causeName}`;
                        }
                        return {
                            "error": {message, name, stack}
                        };
                    });
                }
                return result;
            } catch (error:any) {
                this.logger.error(error.toString());
                return {
                    "error": {
                        message: error.message,
                        name: error.name,
                        stack: error.stack,
                    }
                };
            }
        };
    };

    /**
     * allows direct injection of ${expression} into template at given jsonPointer.
     * @param expression
     * @param jsonPointer
     */
    async setExpression(expression:string, jsonPointer:JsonPointerString){
        if(!MetaInfoProducer.EMBEDDED_EXPR_REGEX.test(expression)){
            throw new Error("Not a valid stated exprssion (MetaInfoProducer.EMBEDDED_EXPR_REGEX test did not pass): " + expression);
        }
        await this.import(expression, jsonPointer);
    }

    async import(template:object|string, jsonPtrImportPath:JsonPointerString) {
        jp.set(this.output, jsonPtrImportPath, template);
        await this.initialize(template, jsonPtrImportPath);
    }

    public static NOOP = Symbol('NOOP');

    private getImport(metaInfo: MetaInfo):(templateToImport:string)=>Promise<symbol> { //we provide the JSON Pointer that targets where the imported content will go
        //import the template to the location pointed to by jsonPtr
        return async (importMe) => {
            let resp;
            const parsedUrl = this.parseURL(importMe);
            if (parsedUrl) { //remote download
                this.logger.debug(`Attempting to fetch imported URL '${importMe}'`);
                resp = await this.fetchFromURL(parsedUrl);
                resp = this.extractFragmentIfNeeded(resp, parsedUrl);
            } else if(MetaInfoProducer.EMBEDDED_EXPR_REGEX.test(importMe)){ //this is the case of importing an expression string
                resp = importMe; //literally a direction expression like '/${foo}'
            }else {
                this.logger.debug(`Attempting local file import of '${importMe}'`);
                try {
                    if (TemplateProcessor._isNodeJS || (typeof BUILD_TARGET !== 'undefined' && BUILD_TARGET !== 'web')) {
                        resp = await this.localImport(importMe);
                    }
                }catch (error){
                    this.logger.debug("argument to import doesn't seem to be a file path");
                }


                if(resp === undefined){
                    this.logger.debug(`Attempting literal import of object '${importMe}'`);
                    resp = this.validateAsJSON(importMe);
                }
            }
            if(resp === undefined){
                throw new Error(`Import failed for '${importMe}' at '${metaInfo.jsonPointer__}'`);
            }
            await this.setContentInTemplate(resp, metaInfo);
            return TemplateProcessor.NOOP;
        }
    }
    private parseURL(input:string):URL|false {
        try {
            return new URL(input);
        } catch (e) {
            return false;
        }
    }

    private async fetchFromURL(url:URL) {
        try {
            this.logger.debug(`fetching ${url}`);
            const resp = await fetch(url);
            if (!resp.ok) return resp;

            // Determine content type from headers or URL
            const contentType = resp.headers.get("content-type");
            let format;

            if (contentType) {
                if (contentType.includes("application/json")) {
                    format = 'json';
                } else if (contentType.includes("text/yaml")) {
                    format = 'yaml';
                }
            } //we can still encounter incorrect conetnt-type like text/plain for json or yaml on various hosting sites like github raw
            if(!format){
                // If content-type is not available, check the URL file extension
                const fileExtension = url.pathname.split('.').pop();
                if (fileExtension === 'json') {
                    format = 'json';
                } else if (fileExtension === 'yaml' || fileExtension === 'yml') {
                    format = 'yaml';
                }
            }

            switch (format) {
                case 'json':
                    return await resp.json();
                case 'yaml':
                    const text = await resp.text();
                    return yaml.load(text);
                default:
                    throw new Error(`Cannot determine response format for URL: ${url}`);
            }

        } catch (e) {
            const msg = `error fetching ${url}`;
            this.logger.error(e);
            throw new Error(msg);
        }
    }

    private extractFragmentIfNeeded(response:any, url:URL) {
        const jsonPointer = url.hash && url.hash.substring(1);
        if (jsonPointer && jp.has(response, jsonPointer)) {
            this.logger.debug(`Extracting fragment at ${jsonPointer}`);
            return jp.get(response, jsonPointer);
        } else if (jsonPointer) {
            throw new Error(`fragment ${jsonPointer} does not exist in JSON received from ${url}`);
        }
        return response;
    }

    private validateAsJSON(obj:string) {
        try {
            const jsonString = JSON.stringify(obj);
            const parsedObject = JSON.parse(jsonString);
            const isEqual = JSON.stringify(obj) === JSON.stringify(parsedObject);
            if(!isEqual || typeof obj !== "object"){
                return undefined
            }
            return obj;
        } catch (e) {
            return undefined;
        }
    }

    private async setContentInTemplate(literalTemplateToImport:any, metaInfo: MetaInfo):Promise<void> {
        const jsonPtrIntoTemplate:string = metaInfo.jsonPointer__ as string;
        jp.set(this.output, jsonPtrIntoTemplate, literalTemplateToImport);
        await this.initialize(literalTemplateToImport, jsonPtrIntoTemplate); //, jp.parse(metaInfo.exprTargetJsonPointer__)
    }

    private async createMetaInfos(template:object, rootJsonPtr:JsonPointerStructureArray = []) {
        let initialMetaInfos = await MetaInfoProducer.getMetaInfos(template);

        return initialMetaInfos.reduce((acc: MetaInfo[], metaInfo) => {
            metaInfo.jsonPointer__ = [...rootJsonPtr, ...metaInfo.jsonPointer__];
            metaInfo.exprTargetJsonPointer__ = metaInfo.jsonPointer__.slice(0, -1);
            const cdUpPath = metaInfo.exprRootPath__;
            if (cdUpPath) {
                const cdUpParts = cdUpPath.match(/\.\.\//g);
                if (cdUpParts) { // ../../{...}
                    metaInfo.exprTargetJsonPointer__ = metaInfo.exprTargetJsonPointer__.slice(0, -cdUpParts.length);
                } else if (cdUpPath.match(/^\/$/g)) { // /${...}
                    metaInfo.exprTargetJsonPointer__ = this.adjustRootForSimpleExpressionImports(template, rootJsonPtr);
                } else if (cdUpPath.match(/^\/\/$/g)) { // //${...}
                    metaInfo.exprTargetJsonPointer__ = []; //absolute root
                } else {
                    const jsonPtr = jp.compile(metaInfo.jsonPointer__);
                    const msg = `unexpected 'path' expression '${cdUpPath} (see https://github.com/cisco-open/stated#rerooting-expressions)`;
                    const errorObject = {name: 'invalidExpRoot', message: msg}
                    this.errorReport[jsonPtr as string] = {error: errorObject};
                    this.logger.error(msg);
                }
            }

            if (metaInfo.expr__ !== undefined) {
                try {
                    const depFinder = new DependencyFinder(metaInfo.expr__);
                    metaInfo.compiledExpr__ = depFinder.compiledExpression;
                    //we have to filter out "" from the dependencies as these are akin to 'no-op' path steps
                    metaInfo.dependencies__ = depFinder.findDependencies().map(depArray => depArray.filter(pathPart => pathPart !== ""));
                    acc.push(metaInfo);
                } catch (e) {
                    this.logger.error(JSON.stringify(e));
                    const jsonPtr = jp.compile(metaInfo.jsonPointer__);
                    const msg = `problem analysing expression : ${metaInfo.expr__}`;
                    const errorObject = {name: "badJSONata", message: msg}
                    this.errorReport[jsonPtr] = {error: errorObject};
                    this.logger.error(msg);
                }
            } else {
                acc.push(metaInfo);
            }

            return acc;
        }, []);
    }

    private sortMetaInfos(metaInfos:MetaInfo[]) {
        metaInfos.sort((a, b) => a.jsonPointer__ < b.jsonPointer__ ? -1 : (a.jsonPointer__ > b.jsonPointer__ ? 1 : 0));
    }

    private populateTemplateMeta(metaInfos:MetaInfo[]) {
        metaInfos.forEach(meta => {
            const initialDependenciesPathParts:JsonPointerStructureArray[] = this.removeLeadingDollarsFromDependencies(meta);
            meta.absoluteDependencies__ = this.makeDepsAbsolute(meta.exprTargetJsonPointer__ as JsonPointerStructureArray, initialDependenciesPathParts);
            meta.dependencies__ = initialDependenciesPathParts;
            //so if we will never allow replacement of the entire root document. But modulo that if-statement we can setup the templateMeta
            if (meta.jsonPointer__.length > 0) {
                //if we are here then the templateMetaData can be set to the meta we just populated
                jp.set(this.templateMeta, meta.jsonPointer__, meta);
            }
            TemplateProcessor.compileToJsonPointer(meta);
        });
    }

    //mutates all the pieces of metaInf that are path parts and turns them into JSON Pointer syntax
    private static compileToJsonPointer(meta:MetaInfo) {
        meta.absoluteDependencies__ = [...new Set((meta.absoluteDependencies__ as JsonPointerStructureArray[]).map(jp.compile))];
        meta.dependencies__ = (meta.dependencies__ as JsonPointerStructureArray[]).map(jp.compile);
        meta.exprTargetJsonPointer__ = jp.compile(meta.exprTargetJsonPointer__ as JsonPointerStructureArray);
        meta.jsonPointer__ = jp.compile(meta.jsonPointer__ as JsonPointerStructureArray);
        meta.parent__ = jp.compile(meta.parent__ as JsonPointerStructureArray);
    }

    private setupDependees(metaInfos:MetaInfo[]) {
        metaInfos.forEach(i => {
            (i.absoluteDependencies__ as JsonPointerString[])?.forEach((ptr:JsonPointerString) => {
                if (!jp.has(this.templateMeta, ptr)) {
                    const parent = jp.parent(ptr);
                    const  nonMaterialized = {
                        "materialized__": false,
                        "jsonPointer__": ptr,
                        "dependees__": [], //a non-materialized node has a dependency on the parent node
                        "dependencies__": [], //we are passed the phase where dependencies have been converted to absolute so we can skip populating this
                        "absoluteDependencies__": [], //parent.length===0?[]:[parent], //empty parent is root document; tracking dep's on root is silly
                        "tags__": new Set<string>(),
                        "treeHasExpressions__": false,
                        parent__: parent
                    };
                    jp.set(this.templateMeta, ptr, nonMaterialized);
                    metaInfos.push(nonMaterialized); //create metaInfos node for non-materialized node

                }
                const meta = jp.get(this.templateMeta, ptr) as MetaInfo;
                //so there is still the possibility that the node in the templateMeta existed, but it was just created
                //as an empty object or array node when a "deeper" json pointer was set. Like /view/0/0/0/name would
                //result in 2 empty intermediate array objects. And then someone can have a dependency on /view/0 or
                ///view/0/0 neither of which would have had their metadata properly defaulted
                if(meta.jsonPointer__ === undefined){
                    const parent = jp.parent(ptr);
                    const  nonMaterialized = {
                        "materialized__": false,
                        "jsonPointer__": ptr,
                        "dependees__": [],
                        "dependencies__": [],
                        "absoluteDependencies__": [], //parent.length===0?[]:[parent],
                        "tags__": new Set<string>(),
                        "treeHasExpressions__": false,
                        parent__: parent
                    };
                    merge(meta, nonMaterialized);
                }

                (meta.dependees__ as JsonPointerString[]).push(i.jsonPointer__ as JsonPointerString);
            });
        });
    }

    public async evaluateInitialPlanDependencies(metaInfos:MetaInfo[]) {
        const evaluationPlan = this.topologicalSort(metaInfos, true);//we want the execution plan to only be a list of nodes containing expressions (expr=true)
        return await this.executePlan({
            sortedJsonPtrs:evaluationPlan,
            restoreJsonPtrs: [],
            data: TemplateProcessor.NOOP,
            output:this.output,
            forkStack:[],
            forkId:"ROOT",
            didUpdate:[]
        });
    }

    private makeDepsAbsolute(parentJsonPtr:JsonPointerStructureArray, localJsonPtrs:JsonPointerStructureArray[]) {
        return localJsonPtrs.map(localJsonPtr => { //both parentJsonPtr and localJsonPtr are like ["a", "b", "c"] (array of parts)
            return [...parentJsonPtr, ...localJsonPtr]
        })
    }

    private removeLeadingDollarsFromDependencies(metaInfo:MetaInfo):JsonPointerStructureArray[] {
        // Extract dependencies__ and jsonPointer__ from metaInfo
        const {dependencies__} = metaInfo;
        // Iterate through each depsArray in dependencies__ using reduce function
        dependencies__.forEach(depsArray => {
            const root = depsArray[0];
            if (root === "" || root === "$") {
                (depsArray as JsonPointerStructureArray).shift();
            }
        });
        return dependencies__ as JsonPointerStructureArray[];
    }

    private propagateTags(metaInfos:MetaInfo[]) {
        // Set of visited nodes to avoid infinite loops
        const visited = new Set();

        // Recursive function for DFS
        const dfs = (node:MetaInfo)=> {
            if (node.jsonPointer__==undefined || visited.has(node.jsonPointer__)) return;
            visited.add(node.jsonPointer__);
            // Iterate through the node's dependencies
            node.absoluteDependencies__?.forEach(jsonPtr => {
                const dependency: MetaInfo = jp.get(this.templateMeta, jsonPtr) as MetaInfo;
                // Recurse on the dependency to ensure we collect all its tags
                dfs(dependency);
                // Propagate tags from the dependency to the node
                dependency.tags__?.forEach(tag => node.tags__.add(tag));
            });
        }

        // Start DFS from all nodes in metaInfos
        metaInfos.forEach(node => dfs(node));
    }

    /**
     * temp vars are in scope if all tags are present OR the expression's fieldname ends in !, which makes
     * it an absolutely temporary variable since.
     * @param metaInfo
     * @private
     */
    private isTempVarInScope(metaInfo: MetaInfo){
        return metaInfo.temp__ === true
            && (
                (metaInfo.jsonPointer__ as JsonPointerString).endsWith("!")
                ||
                this.allTagsPresent(metaInfo.tags__)
            )
    }

    private cacheTmpVarLocations(metaInfos:MetaInfo[]):JsonPointerString[]{
        const tmpVars:JsonPointerString[] = [];
        metaInfos.forEach(metaInfo => { //var must also be in scope of tags
            if (this.isTempVarInScope(metaInfo)) {
                tmpVars.push(metaInfo.jsonPointer__ as JsonPointerString);
            }
        })
        return tmpVars
    }

    private removeTemporaryVariables(tmpVars:JsonPointerString[], jsonPtrOfTemplate:JsonPointerString): void{
        //only remove temp variables after all imports are finished and we are finishing render of the root template
        if(jsonPtrOfTemplate === "/") {
            tmpVars.forEach(jsonPtr => {
                if (jp.has(this.output, jsonPtr)) {
                    const current = jp.get(this.output, jsonPtr);
                    jp.remove(this.output, jsonPtr);
                    this.callDataChangeCallbacks(current, jsonPtr, true)
                }
            });
        }
    }


    private topologicalSort(metaInfos:MetaInfo[], exprsOnly = true, fanout=true):JsonPointerString[] {
        const visited = new Set();
        const recursionStack:Set<JsonPointerString> = new Set(); //for circular dependency detection
        const orderedJsonPointers:Set<string> = new Set();
        const templateMeta = this.templateMeta;

        //--------------- utility sub-functions follow ----------------//

        const listDependencies = (metaInfo:MetaInfo) => {
            markAsVisited(metaInfo); //visited tells us 'globally' is a node has ever been visited
            //...however, we also need to track the traversal of dependencies that is 'local' to a single
            //originating node/expression. Circularity of references is limited to this "local" Scope. If we
            //detected circularity with the global 'visited' list, it would mean that circularity was somehow
            //a property of the entire template, which it is not. Circularity is a property of individual expression
            //fanouts, '.from' a given expression/node
            addToScope(metaInfo);

            followDependencies(metaInfo);
            emit(metaInfo);
            followChildren(metaInfo);

            removeFromScope(metaInfo); //...and clear that 'local' scope now that we finished processing the node
        }

        const hasJsonPointer = (metaInfo:MetaInfo) => {
            return metaInfo.jsonPointer__ !== undefined;
        }

        const markAsVisited = (metaInfo:MetaInfo) => {
            visited.add(metaInfo.jsonPointer__);
        }

        const addToScope = (metaInfo:MetaInfo) => {
            recursionStack.add(metaInfo.jsonPointer__ as JsonPointerString);
        }

        const removeFromScope = (metaInfo:MetaInfo) => {
            recursionStack.delete(metaInfo.jsonPointer__ as JsonPointerString);
        }
        /**
         * Used to detect a condition where like "data:${data.foo}" which essentially declares a dependency on the
         * expression itself. This is inherently circular. You cannot say "use that thing in this expression, where
         * that thing is a product of evaluating this expression". You also cannot say "use that thing in this
         * expression where that thing is a direct ancestor of this expression" as that is also circular, implying that
         * the expression tries to reference an ancestor node, whose descendent includes this very node.
         * @param exprNode
         * @param dependency
         */
        const isCommonPrefix = (exprNode:JsonPointerString, dependency:JsonPointerString):boolean=>{
            return exprNode.startsWith(dependency) || dependency.startsWith(exprNode);

        }

        //metaInfo gets arranged into a tree. The fields that end with "__" are part of the meta info about the
        //template. Fields that don't end in "__" are children of the given object in the template
        const followChildren = (metaInfoNode:any) => {
            for (const childKey in metaInfoNode) {
                if (!childKey.endsWith("__")) { //ignore metadata fields
                    const child = metaInfoNode[childKey];
                    if (!visited.has(child.jsonPointer__)) {
                        listDependencies(child);
                    }
                }
            }
        }

        const searchUpForExpression = (childNode:MetaInfo):MetaInfo|undefined=> {
            let pathParts = jp.parse(childNode.jsonPointer__ as JsonPointerString);
            /*
            const directParent = jp.compile(pathParts.slice(0, -1));
            //if a dependency of an expression is rooted in the expression itself, such as "data:${data.foo}" then this is a circular dependency
            if (visited.has(directParent) && (jp.get(this.templateMeta, directParent) as MetaInfo).expr__) {
                logCircularDependency(childNode.jsonPointer__ as JsonPointerString);
                return undefined;
            }

             */
            while (pathParts.length > 1) {
                pathParts = pathParts.slice(0, -1); //get the parent expression
                const jsonPtr = jp.compile(pathParts);
                const ancestorNode = jp.get(this.templateMeta, jsonPtr) as MetaInfo;
                if (ancestorNode.materialized__ === true) {
                    return ancestorNode;
                }
            }
            return undefined;

        }

        const followDependencies = (metaInfo:MetaInfo) => {
            if (!metaInfo.absoluteDependencies__) return;

            for (const dependency of metaInfo.absoluteDependencies__) {

                if (recursionStack.has(dependency as JsonPointerString)
                    || isCommonPrefix(metaInfo.jsonPointer__ as JsonPointerString, dependency as JsonPointerString)) {
                    logCircularDependency(dependency as JsonPointerString);
                    continue; //do not follow circular dependencies
                }

                if (visited.has(dependency)) continue;
                const dependencyNode = jp.get(templateMeta, dependency) as MetaInfo;
                processUnmaterializedDependency(dependencyNode);
                listDependencies(dependencyNode);
            }
        }

        const logCircularDependency = (dependency:JsonPointerString) => {
            const e = '🔃 Circular dependency  ' + Array.from(recursionStack).join(' → ') + " → " + dependency;
            this.warnings.push(e);
            this.logger.log('warn', e);
        }

        const processUnmaterializedDependency = (dependencyNode:MetaInfo) => {
            if (!dependencyNode.materialized__) {
                const ancestor = searchUpForExpression(dependencyNode);
                if (ancestor) {
                    listDependencies(ancestor);
                }
            }
        }

        const emit = (metaInfo:MetaInfo) => {
            if (exprsOnly && !metaInfo.expr__) return;
            orderedJsonPointers.add(metaInfo.jsonPointer__ as JsonPointerString);
        }

        const removeExtraneous = (orderedJsonPointers:Set<string>):JsonPointerString[]=>{
            const desiredToRetain:Set<JsonPointerString> = new Set();
            metaInfos.forEach(m=>{
                desiredToRetain.add(m.jsonPointer__ as JsonPointerString);
            });
            return [...orderedJsonPointers].reduce((acc:JsonPointerString[], jsonPtr)=>{
                if(desiredToRetain.has(jsonPtr)){
                    acc.push(jsonPtr as JsonPointerString);
                }
                return acc;
            }, []);
        }
        //-------- end utility sub functions -------------//

        if (!(metaInfos instanceof Set || Array.isArray(metaInfos))) {
            metaInfos = [metaInfos];
        }
        // Perform topological sort
        metaInfos.forEach(node => {
            if (!visited.has(node.jsonPointer__)) {
                listDependencies(node);
            }
        });
        if(!fanout) {
            //when the input metaInfos has come via ".from()" then we are just trying to ensure that any
            //dependencies *within* that set of metaInfos gets topologically sorted. We don't want to fan
            //out to any other dependencies
            return removeExtraneous(orderedJsonPointers);
        }else{
            return [...orderedJsonPointers];
        }
    }


    /**
     * Sets or deletes data based on the specified operation.
     * @async
     * @param {string} jsonPtr - The JSON pointer indicating where to apply the operation.
     * @param {*} [data=null] - The data to be used with the set or setDeferred operation.
     * @param {"set"|"delete"|"setDeferred"} [op="set"] - The operation to perform - setDeferred is for internal use
     * @returns {Promise<<JsonPointerString[]>} A promise with the list of json pointers touched by the plan
     */
    async setData(jsonPtr:JsonPointerString, data:any=null, op:Op="set"):Promise<JsonPointerString[]> {
        this.isEnabled("debug") && this.logger.debug(`setData on ${jsonPtr} for TemplateProcessor uid=${this.uniqueId}`)
        //get all the jsonPtrs we need to update, including this one, to percolate the change
        const fromPlan = [...this.from(jsonPtr)]; //defensive copy
        const plan:Plan = {sortedJsonPtrs: fromPlan, restoreJsonPtrs: [], data, op, output:this.output, forkStack:[], forkId:"ROOT", didUpdate:[]}
        this.executionQueue.push(plan);
        if(this.isEnabled("debug")) {
            this.logger.debug(`execution plan (uid=${this.uniqueId}): ${StatedREPL.stringify(plan)}`);
            this.logger.debug(`execution plan queue (uid=${this.uniqueId}): ${StatedREPL.stringify(this.executionQueue)}`);
        }
        if(this.executionQueue.length>1){
            return fromPlan; //if there is a plan in front of ours in the executionQueue it will be handled by the already-awaited drainQueue
        }

        await this.drainExecutionQueue();
        this.logOutput(this.output); //execution of plan is over, any forked plans should have joined, so we can just log the main output
        return fromPlan;

    }

    /**
     * Calling setDataForked allows the mutation and its reaction (fromPlan) to begin executing immediately without
     * queuing/seriealizing/blocking on other plans. This is possible because a forked planStep contains a write-safe
     * copy of this.output (essentially a 'snapshot' in MVCC terminology) and therefore the mutation and propagation
     * of the fromPlan are isolated, just like snapshot isolation levels on Postres or other MVCC databases. So, do not
     * await this method. Just let 'er rip.
     * @param planStep
     */
    public async setDataForked(planStep:PlanStep):Promise<JsonPointerString[]>{
        const {jsonPtr} = planStep;
        this.isEnabled("debug") && this.logger.debug(`setData on ${jsonPtr} for TemplateProcessor uid=${this.uniqueId}`)
        const fromPlan = [...this.from(jsonPtr)]; //defensive copy
        const mutationPlan = {...planStep, sortedJsonPtrs:fromPlan, restoreJsonPtrs: [], didUpdate:[]};
        await this.executePlan(mutationPlan as Plan);
        return fromPlan;
    }

    private async drainExecutionQueue(){
        while (this.executionQueue.length > 0) {
            try {
                const plan: Plan | SnapshotPlan = this.executionQueue[0];
                if (plan.op === "snapshot") {
                    (plan as SnapshotPlan).generatedSnapshot = this.executionStatus.toJsonString();;
                } else {
                    await this.executePlan(plan);
                }
                this.removeTemporaryVariables(this.tempVars, "/");
            }finally {
                this.executionQueue.shift();
            }
        }
    }

    private isEnabled(logLevel:Levels):boolean{
        return LOG_LEVELS[this.logger.level] >= LOG_LEVELS[logLevel];
    }

    private logOutput(output:any) {
        if (this.isEnabled("debug")) {
            this.logger.debug(`----------------TEMPLATE OUTPUT (${this.uniqueId})-----------------`)
            this.logger.debug(stringifyTemplateJSON(output));
        }
    }

    /**
     * This method is used to compile and evaluate function expressions and their dependencies.
     *
     * Based on the metadata, we should identify all functions, and their dependencies
     * @param plan
     */
    public async evaluateIntializationPlan(plan:Plan) {
        try {
            let {output, forkStack, forkId, didUpdate:updatesArray,restoreJsonPtrs: dependencies} = plan;
            const {lastCompletedStep} = plan; //this will tell us if we can skip ahead because some of the plan is already completed, which happens when restoring a persisted plan
            const startIndex = lastCompletedStep?dependencies.indexOf(lastCompletedStep.jsonPtr)+1:0
            for (let i = startIndex; i < dependencies.length; i++) {
                const jsonPtr = dependencies[i];
                const planStep:PlanStep = {jsonPtr, output, forkStack, forkId, didUpdate:false}; //pick up the output and forkStack from the prior step
                planStep.didUpdate = await this.evaluateNode(planStep);
                output = planStep.output; // forked/joined will change the output so we have to record it to pass to next step
            }
        } finally {
            console.log("evaluated initialization plan", plan.restoreJsonPtrs);
        }
    }

    /**
     * Create an initialization plan from the execution plan
     * @param plan
     */
    public async createRestorePlan(plan:Plan) {
        try {
            let intervals: MetaInfo[] = this.metaInfoByJsonPointer["/"]?.filter(metaInfo => metaInfo.data__ === '--interval/timeout--');
            const expressions: MetaInfo[] = this.metaInfoByJsonPointer["/"]?.filter(metaInfo => metaInfo.expr__ !== undefined);
            const functions: MetaInfo[] = this.metaInfoByJsonPointer["/"]
                ?.filter(metaInfo => metaInfo.expr__ !== undefined)
                .filter(metaInfo => metaInfo.isFunction__ === true);
            expressions.forEach(metaInfo => {
                metaInfo.compiledExpr__ = jsonata.default(metaInfo.expr__ as string);
            });

            for (const expression of functions) {
                const jsonPtrStr = Array.isArray(expression.jsonPointer__) ? expression.jsonPointer__[0] as JsonPointerString: expression.jsonPointer__ as JsonPointerString;

               if (!plan.restoreJsonPtrs.includes(jsonPtrStr)) {
                   plan.restoreJsonPtrs.push(jsonPtrStr);
               }
            }
            functions.forEach(metaInfo => {
                jp.set(plan.output, metaInfo.jsonPointer__, metaInfo.compiledExpr__);
            })
            for (const expression of intervals) {
                const jsonPtrStr = Array.isArray(expression.jsonPointer__) ? expression.jsonPointer__[0] as JsonPointerString: expression.jsonPointer__ as JsonPointerString;
                if (!plan.restoreJsonPtrs.includes(jsonPtrStr)) {
                    plan.restoreJsonPtrs.push(jsonPtrStr);
                }
            }
            await this.evaluateIntializationPlan(plan);
            this.output = plan.output;
        } catch (error) {
            this.logger.error("plan functions evaluation failed");
            throw error;
        }
    }

    public async executePlan(plan:Plan){
        try {
            const {data} = plan;
            let shouldRunDependentExpressions = true;
            if (data !== TemplateProcessor.NOOP) { //this plan begins with setting data
                shouldRunDependentExpressions = await this.applyMutationToFirstJsonPointerOfPlan(plan);
            }
            // if the plan caused an initial mutation, then continue with the plan's transitive dependencies
            shouldRunDependentExpressions && await this.executeDependentExpressions(plan);
            await this.executeDataChangeCallbacks(plan);
        }catch(error){
            this.logger.error("plan execution failed for plan " + JSON.stringify(plan.sortedJsonPtrs));
            throw error;
        }
    }

    private async executeDependentExpressions(plan: Plan) {
        this.executionStatus.begin(plan);
        try {
            let {output, forkStack, forkId, didUpdate:updatesArray,sortedJsonPtrs: dependencies} = plan;
            const {lastCompletedStep} = plan; //this will tell us if we can skip ahead because some of the plan is already completed, which happens when restoring a persisted plan
            const startIndex = lastCompletedStep?dependencies.indexOf(lastCompletedStep.jsonPtr)+1:0
            for (let i = startIndex; i < dependencies.length; i++) {
                const jsonPtr = dependencies[i];
                const planStep:PlanStep = {jsonPtr, output, forkStack, forkId, didUpdate:false}; //pick up the output and forkStack from the prior step
                planStep.didUpdate = await this.evaluateNode(planStep);
                plan.lastCompletedStep = planStep;
                output = planStep.output; // forked/joined will change the output so we have to record it to pass to next step
                updatesArray[i] = planStep.didUpdate;
            }
        }finally {
            this.executionStatus.end(plan);
        }
    }

    private async executeDataChangeCallbacks(plan:Plan) {
        let anyUpdates = false;
        const {receiveNoOpCallbacksOnRoot:everything = false} = this.options;
        let jsonPtrArray = plan.sortedJsonPtrs;
        const onlyWhatChanged = (plan:Plan)=>{
            return  plan.didUpdate.reduce((acc:JsonPointerString[],didUpdate,i)=>{
                if(didUpdate){
                    acc.push(plan.sortedJsonPtrs[i]);
                    anyUpdates = true;
                }
                return acc;
            }, []);
        }
        if(!everything){
            jsonPtrArray = onlyWhatChanged(plan);
        }

        if (anyUpdates || everything) {
            // current callback APIs are not interested in deferred updates, so we reduce op to boolean "removed"
            const removed = plan.op==="delete";
            //admittedly this structure of this common callback is disgusting. Essentially if you are using the
            //common callback you don't want to get passed any data that changed because you are saying in essence
            //"I don't care what changed".
            await this.callDataChangeCallbacks(plan.output, jsonPtrArray, removed);
        }
    }

    private async applyMutationToFirstJsonPointerOfPlan(plan:Plan):Promise<boolean> {
        if(plan.lastCompletedStep){
            return plan.lastCompletedStep?plan.sortedJsonPtrs.indexOf(plan.lastCompletedStep.jsonPtr)< plan.sortedJsonPtrs.length:false
        }
        this.executionStatus.begin(plan);
        let theStep:PlanStep|undefined;
        try {
            const {sortedJsonPtrs} = plan;
            const jsonPtr = sortedJsonPtrs[0];
            theStep = {jsonPtr, ...plan, didUpdate:false}
            const didUpdate =  await this.mutate(theStep);
            plan.didUpdate.push(didUpdate);
            return didUpdate;
        }finally {
            if(theStep){
                plan.lastCompletedStep = theStep;
            } //completed self
            this.executionStatus.end(plan)
        }
    }

    private async mutate(planStep: PlanStep):Promise<boolean> {
        try {
            const {jsonPtr: entryPoint, data, op} = planStep;
            if (!jp.has(this.output, entryPoint)) { //node doesn't exist yet, so just create it
                return  await this.evaluateNode(planStep);
            } else {
                // Check if the node contains an expression. If so, print a warning and return.
                const firstMeta = jp.get(this.templateMeta, entryPoint) as MetaInfo;
                if (firstMeta.expr__ !== undefined && op !== "forceSetInternal") { //setDeferred allows $defer('/foo') to 'self replace' with a value
                    this.logger.log('warn', `Attempted to replace expressions with data under ${entryPoint}. This operation is ignored.`);
                    return false;
                } else {
                    planStep.didUpdate = await this.evaluateNode(planStep); // Evaluate the node provided with the data provided
                    if (!planStep.didUpdate) {
                        this.logger.verbose(`data did not change for ${entryPoint}, short circuiting dependents.`);
                    }
                    return planStep.didUpdate;
                }
            }
        }catch(error:any){
            this.logger.error(`mutation failed: ${planStep.jsonPtr} with error msg '${error.message}'`);
            throw error;
        }
    }

    private async evaluateNode(step:PlanStep):Promise<boolean> {
        const {jsonPtr, data=undefined, op="set", output} = step;
        const {templateMeta} = this;

        //an untracked json pointer is one that we have no metadata about. It's just a request out of the blue to
        //set /foo when /foo does not exist yet
        const isUntracked = !jp.has(templateMeta, jsonPtr);
        if (isUntracked) {
            return this.setUntrackedLocation(step);
        }

        const hasDataToSet = data !== undefined && data !== TemplateProcessor.NOOP;
        if (hasDataToSet) {
            return this.setDataIntoTrackedLocation(templateMeta, step);
        }

        return this._evaluateExpression(step);

    }

    private async _evaluateExpression(planStep:PlanStep) {
        const startTime = Date.now(); // Capture start time
        const {jsonPtr, output} = planStep;

        const {templateMeta} = this;
        let data;
        const metaInfo = jp.get(templateMeta, jsonPtr) as MetaInfo;
        const {expr__, tags__} = metaInfo;
        let success = false;
        if (expr__ !== undefined) {
            if(this.allTagsPresent(tags__)) {
                try {
                    this._strictChecks(metaInfo);
                    data = await this._evaluateExprNode(planStep); //run the jsonata expression
                    success = true;
                }catch(error: any){
                    const errorObject = {name:error.name, message: error.message}
                    data = {error:errorObject}; //errors get placed into the template output
                    this.errorReport[jsonPtr] = errorObject;
                }
                this._setData({...planStep, data});
            } else {
                this.logger.debug(`Skipping execution of expression at ${jsonPtr}, because none of required tags (${Array.from(tags__)}) were set with --tags`);
                return false;
            }
        } else {
            try {
                data = jp.get(output, jsonPtr);
            } catch (error) {
                this.logger.log('error', `The reference with json pointer ${jsonPtr} does not exist`);
                data = undefined;
            }
        }

        jp.set(templateMeta, jsonPtr + "/data__", data); //saving the data__ in the templateMeta is just for debugging
        jp.set(templateMeta, jsonPtr + "/materialized__", true);

        const endTime = Date.now(); // Capture end time
        this.logger.verbose(`_evaluateExpression at ${jsonPtr} completed in ${endTime - startTime} ms.`);  // Log the time taken

        return success; //true means that the data was new/fresh/changed and that subsequent updates must be propagated
    }

    private _strictChecks(metaInfo:MetaInfo) {
        const {strict} = this.options;
        if (strict?.refs) {
            metaInfo.absoluteDependencies__?.forEach(ptr => {
                if ((jp.get(this.templateMeta, ptr) as MetaInfo).materialized__ === false) {
                    const msg = `${ptr} does not exist, referenced from ${metaInfo.jsonPointer__} (strict.refs option enabled)`;
                    this.logger.error(msg);
                    const error = new Error(msg);
                    error.name = "strict.refs"
                    throw error;
                }
            });
        }
    }

    private setDataIntoTrackedLocation(templateMeta:MetaInfo, planStep:PlanStep ) {
        const {jsonPtr, data=undefined, op="set"} = planStep;
        const {treeHasExpressions__} = jp.get(templateMeta, jsonPtr) as MetaInfo;
        if (treeHasExpressions__ && op !== 'forceSetInternal') {
            this.logger.log('warn', `nodes containing expressions cannot be overwritten: ${jsonPtr}`);
            return false;
        }
        let didSet = this._setData(planStep);
        if (didSet) {
            jp.set(templateMeta, jsonPtr + "/data__", data); //saving the data__ in the templateMeta is just for debugging
            jp.set(templateMeta, jsonPtr + "/materialized__", true);
        }
        return didSet; //true means that the data was new/fresh/changed and that subsequent updates must be propagated
    }

    private async setUntrackedLocation(planStep:PlanStep) {
        const {output, jsonPtr, data, op="set"} = planStep;
        if(op==="delete"){
            if(!jp.has(this.output, jsonPtr)){
                return false; // we are being asked to remove something that isn't here
            }
        }
        jp.set(output, jsonPtr, data); //this is just the weird case of setting something into the template that has no effect on any expressions
        jp.set(this.templateMeta, jsonPtr, {
                "materialized__": true,
                "jsonPointer__": jsonPtr,
                "dependees__": [],
                "dependencies__": [],
                "absoluteDependencies__": [],
                "data__": data,
                "materialized": true
            }
        );
        await this.callDataChangeCallbacks(data, jsonPtr);
        return true;
    }

    private async _evaluateExprNode(planStep: PlanStep) {
        const {jsonPtr, output} = planStep;
        let evaluated;
        const metaInfo = jp.get(this.templateMeta, jsonPtr) as MetaInfo;
        const {compiledExpr__, exprTargetJsonPointer__, expr__} = metaInfo;
        let target;
        try {
            target = jp.get(output, exprTargetJsonPointer__ as JsonPointerString); //an expression is always relative to a target
            const safe =  this.withErrorHandling.bind(this);
            const jittedFunctions: { [key: string]: (arg: any) => Promise<any> } = {};
            for (const k of this.functionGenerators.keys()) {
                const generator: FunctionGenerator|undefined = this.functionGenerators.get(k);
                if (generator) { // Check if generator is not undefined
                    try {
                        jittedFunctions[k] = await safe(await generator(metaInfo, this));
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : "Unknown error";
                        const msg = `Function generator '${k}' failed to generate a function and erred with:"${errorMessage}"`;
                        this.logger.error(msg);
                        throw new Error(msg);
                    }
                } else {
                    // Optionally handle the case where generator is undefined
                    const msg = `Function generator for key '${k}' is undefined.`;
                    this.logger.error(msg);
                    throw new Error(msg);
                }
            }

            const context ={...this.context,
            ...{"errorReport": this.generateErrorReportFunction(metaInfo)},
            ...{"defer": safe(this.generateDeferFunction(metaInfo))},
            ...{"import": safe(this.getImport(metaInfo))},
            ...{"forked": safe(this.generateForked(planStep))},
            ...{"joined": safe(this.generateJoined(planStep))},
            ...{"set": safe(this.generateSet(planStep))},
            ...{"setInterval": safe(this.timerManager.generateSetInterval(planStep))},
            ...{"clearInterval": safe(this.timerManager.generateClearInterval(planStep))},
            ...jittedFunctions
            };
            evaluated = await compiledExpr__?.evaluate(
                target,
                context
            );
            if(evaluated?._jsonata_lambda){
                evaluated = this.wrapInOrdinaryFunction(evaluated);
                metaInfo.isFunction__ = true;
            }
        } catch (error:any) {
            this.logger.error(`Error evaluating expression at ${jsonPtr}`);
            this.logger.error(error);
            this.logger.debug(`Expression: ${expr__}`);
            this.logger.debug(`Target: ${stringifyTemplateJSON(target)}`);
            this.logger.debug(`Target: ${stringifyTemplateJSON(target)}`);
            this.logger.debug(`Result: ${stringifyTemplateJSON(evaluated)}`);
            const _error = new Error(error.message);
            _error.name = "JSONata evaluation exception";
            throw _error;
        }
        return evaluated;
    }

    private allTagsPresent(tagSetOnTheExpression:Set<string>) {
        if(tagSetOnTheExpression.size === 0 && this.tagSet.size > 0){
            return false;
        }
        return Array.from(tagSetOnTheExpression).every(tag => this.tagSet.has(tag));
    }

    private _setData(planStep: PlanStep):boolean {
        const {jsonPtr, data=undefined, op="set", output} = planStep;
        if (data === TemplateProcessor.NOOP) { //a No-Op is used as the return from 'import' where we don't actually need to make the assignment as init has already dont it
            return false;
        }

        if(op === 'delete'){
            if(jp.has(output, jsonPtr)) {
                jp.remove(output, jsonPtr);
                this.callDataChangeCallbacks(data, jsonPtr, true);
                return true;
            }
            return false;
        }
        let existingData;
        if (jp.has(output, jsonPtr)) {
            existingData = jp.get(output, jsonPtr);
        }
        if (!isEqual(existingData, data)) {
            jp.set(output, jsonPtr, data);
            this.callDataChangeCallbacks(data, jsonPtr, false);
            return true;
        } else {
            if (this.isEnabled("verbose"))this.logger.verbose(`data to be set at ${jsonPtr} did not change, ignored. `);
            return false;
        }

    }

    from(jsonPtr:JsonPointerString) {
        //check execution plan cache
        if (this.executionPlans[jsonPtr] === undefined) {
            const affectedNodesSet:MetaInfo[] = this.getDependentsBFS(jsonPtr);
            const topoSortedPlan:JsonPointerString[] = this.topologicalSort(affectedNodesSet, true, false);
            this.executionPlans[jsonPtr] = [jsonPtr, ...topoSortedPlan];
        }
        return this.executionPlans[jsonPtr];
    }

    getDependents(jsonPtr:JsonPointerString) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            return (jp.get(this.templateMeta, jsonPtr) as MetaInfo).dependees__
        } else {
            return [];
        }
    }

    private getDependentsBFS(jsonPtr:JsonPointerString) : MetaInfo[] {


        const dependents:MetaInfo[] = [];
        const queue:JsonPointerString[] = [jsonPtr];
        const visited:Set<JsonPointerString> = new Set();
        const origin = jsonPtr;

        //----------------- utility functions ----------------//

        const isInterval = (metaInf:MetaInfo): boolean =>{
            const {data__} = metaInf;
            return data__ && this.timerManager.isInterval(data__);
        }

        const isFunction = (jsonPointer:JsonPointerString)=>{

            if(!jp.has(this.templateMeta, jsonPointer)){
                return false;
            }
            const metaInf = jp.get(this.templateMeta, jsonPointer) as MetaInfo;
            //treat intervals same as immutable functions. Changes should not propagate through an interval causing
            //interval re-evaluation
            if(isInterval(metaInf)){
                return true;
            }
            return !!metaInf.isFunction__;
        }

        const queueParent = (jsonPtr:JsonPointerString)=>{
            //search "up" from this currentPtr to find any dependees of the ancestors of currentPtr
            const parentPointer = jp.parent(jsonPtr) as JsonPointerString;
            if (parentPointer !== '' && !visited.has(parentPointer)) {
                !isFunction(parentPointer) && queue.push(parentPointer);
                visited.add(parentPointer);
            }
        }

        const queueDependees = (metaInf: MetaInfo)=>{
            if (metaInf.dependees__) {
                metaInf.dependees__.forEach(dependee => {
                    if (!visited.has(dependee as JsonPointerString)) {
                        !isFunction(dependee as JsonPointerString) && queue.push(dependee as JsonPointerString);
                        visited.add(dependee as JsonPointerString);
                    }
                });
            }
        }

        const queueDescendents = (metaInf:MetaInfo, currentPtr:JsonPointerString)=>{
            // Recursively traverse into children nodes.
            for (let key in metaInf) {
                // Skip fields that end in "__" and non-object children
                if (key.endsWith('__') || typeof (metaInf as any)[key] !== 'object') {
                    continue;
                }
                // Generate json pointer for child
                let childPtr = `${currentPtr}/${key}`;
                if (!visited.has(childPtr)) {
                    !isFunction(childPtr) && queue.push(childPtr);
                    visited.add(childPtr);
                }
            }
        }
        //----------------- end utility functions ------------------------//
        //----------------- BFS Dependee Search Algorithm ----------------//

        while (queue.length > 0) {
            const currentPtr = queue.shift();
            queueParent(currentPtr as JsonPointerString); //these are IMPLICIT dependees
            //calling queueParent before the templateMeta existence check allows us to find ancestors of
            //a jsonPointer like '/rxLog/-'. Which means "last element of rxLog". queueParent() allows us to
            //pickup the /rxLog array as being an implicit dependency of its array elements. So if an element
            //is added or removed, we will recognize anyone who depends on /rxLog as a dependent
            //@ts-ignore
            if (!jp.has(this.templateMeta, currentPtr)){
                continue;
            }
            //@ts-ignore
            const metaInf = jp.get(this.templateMeta, currentPtr) as MetaInfo;
            if(metaInf.isFunction__){
                continue; //function never gets re-evaluated
            }
            if(currentPtr !== origin && metaInf.expr__ !== undefined){
                dependents.push(metaInf);
            }
            queueDependees(metaInf); //these are EXPLICIT dependees
            queueDescendents(metaInf, currentPtr as JsonPointerString); //these are IMPLICIT dependees
        }

        return dependents;
    }


    getDependencies(jsonPtr:JsonPointerString) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            return (jp.get(this.templateMeta, jsonPtr) as MetaInfo).dependencies__
        }
        return [];

    }

    //this is the .to repl
    to(jsonPtr:JsonPointerString) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            const node = jp.get(this.templateMeta, jsonPtr) as MetaInfo;
            return this.topologicalSort([node], false); //for the repl "to" command we want to see all the dependencies, not just expressions (so exprsOnly=false)
        }
        return [];
    }

    /**
     * Sets a data change callback function that will be called whenever the value at the json pointer has changed
     * @param jsonPtr
     * @param cbFn of form (data, ptr:JsonPointerString, removed?:boolean)=>void
     */
    setDataChangeCallback(jsonPtr:JsonPointerString, cbFn:DataChangeCallback){
        this.logger.debug(`data change callback set on ${jsonPtr} `)
        let callbacks = this.changeCallbacks.get(jsonPtr);
        if(!callbacks){
            callbacks = new Set();
            this.changeCallbacks.set(jsonPtr, callbacks);
        }
        callbacks.add(cbFn);
    }


    removeDataChangeCallback(jsonPtr:JsonPointerString, cbFn?:DataChangeCallback) {
        this.logger.debug(`data change callback removed on ${jsonPtr} `)
        if(cbFn){
            const callbacks = this.changeCallbacks.get(jsonPtr);
            if(callbacks){
                callbacks.delete(cbFn);
            }
        }else{
            this.changeCallbacks.delete(jsonPtr);
        }
    }

    // TODO: change it to pass the plan
    private async callDataChangeCallbacks(data: any, jsonPointer: JsonPointerString|JsonPointerString[], removed: boolean = false) {
        let _jsonPointer:JsonPointerString;
        if(Array.isArray(jsonPointer)){
            _jsonPointer = "/"; //when an array of pointers is provided, it means it was a change callback on "/"
        }else{
            if(jsonPointer.endsWith("/-")){ //happens when we patch an array like /foo/myarray/- indicating "append"
                _jsonPointer = jsonPointer.split("/-")[0]; //ditch the trailing /-
                data = jp.get(this.output, _jsonPointer); //this may be somewhat of a hack, but /foo/myarray/- is not an actual json pointer. It is the array itself that is the changed data
            }else {
                _jsonPointer = jsonPointer;
            }
        }
        const callbacks = this.changeCallbacks.get(_jsonPointer);
        if (callbacks) {
            const promises = Array.from(callbacks).map(cbFn =>
                Promise.resolve().then(() => {
                    cbFn(data, jsonPointer as JsonPointerString, removed)
                }) //works with cbFn that is either sync or async by wrapping in promise
            );

            try {
                await Promise.all(promises);
            } catch (error:any) {
                this.logger.error(`Error in dataChangeCallback at ${jsonPointer}: ${error.message}`);
            }
        }
    }


    //returns the evaluation plan for evaluating the entire template
    async getEvaluationPlan() {
        return this.topologicalSort(this.metaInfoByJsonPointer["/"], true);
    }


    //when importing a template we must only evaluate expressions in the enclosing root template
    //that have dependencies to something inside the target template. Otherwise we will get looping
    //where the expression in the enclosing root template that performs the import gets re-evaluated
    //upon import
    private static dependsOnImportedTemplate(metaInfos:MetaInfo[], importPathJsonPtr:JsonPointerString) {
        return metaInfos.filter(metaInof => metaInof.absoluteDependencies__.some(dep => (dep as JsonPointerString).startsWith(importPathJsonPtr)));
    }

    out(jsonPointer:JsonPointerString){
        if(jp.has(this.output, jsonPointer)){
            return jp.get(this.output, jsonPointer)
        }
        return null;
    }

    private async localImport(filePathInPackage:string) {
        // Resolve the package path
        const {importPath} = this.options;
        let fullPath = filePathInPackage;
        let content;
        if (importPath) {
            // Construct the full file path
            fullPath = path.join(importPath, filePathInPackage);
        }
        try{
            const fileExtension = path.extname(fullPath).toLowerCase();
            // Read the file
            content =  await fs.promises.readFile(fullPath, 'utf8');
            if(fileExtension === ".json") {
                return JSON.parse(content);
            }else if (fileExtension === '.yaml' || fileExtension === '.yml') {
                return yaml.load(content);
            }else if (fileExtension === '.js' || fileExtension === '.mjs') {
                throw new Error('js and mjs imports not implemented yet');
             }else{
                throw new Error('import file extension must be .json or .yaml or .yml');
            }
        } catch(e) {
            this.logger.debug('import was not a local file');
        }
        return content;
    }

    private wrapInOrdinaryFunction(jsonataLambda:any) {
        const wrappedFunction = (...args:any[])=> {
            // Call the 'apply' method of jsonataLambda with the captured arguments
            return jsonataLambda.apply(jsonataLambda, args);
        };
        //mark so it will get properly handled by StatedRepl.printFunc
        wrappedFunction._stated_function__ = true;

        //preserve backward compatibility with code that may be expecting to call the jsonata apply function
        wrappedFunction.apply = (_this:any, args:any[])=>{
            return jsonataLambda.apply(_this, args);
        }
        return wrappedFunction;
    }

    private async generateErrorReportFunction(metaInfo: MetaInfo){
        return async (message:string, name?:string, stack?:any):Promise<StatedError>=>{
            const error:StatedError =  {
                error: {
                    message,
                    ...(name !== undefined && { name }), // Include 'name' property conditionally,
                    ...(stack !== undefined && { stack }), // Include 'stack' property conditionally
                }
            }
            const key = metaInfo.jsonPointer__ as string;
            if(this.errorReport[key] === undefined){
                this.errorReport[key] = error;
            }else if (Array.isArray(this.errorReport[key])){
                this.errorReport[key].push(error);
            }else{ //if here, we have to take the single existing error and replace it with an array having the existing error and the new one
                const tmp = this.errorReport[key];
                this.errorReport[key] = [tmp]; //stuff tmp into array
                this.errorReport[key].push(error); //append error to array
            }

            return error;
        }
    }



    private generateDeferFunction(metaInfo: any) {
        const deferFunc =  (jsonPointer:JsonPointerString, timeoutMs:number)=>{

            if(jp.has(this.output, jsonPointer)){
                const dataChangeCallback =  debounce(async (data)=>{
                    this.setData(metaInfo.jsonPointer__, data, "forceSetInternal"); //sets the value into the location in the template where the $defer() call is made
                }, timeoutMs);
                this.setDataChangeCallback(jsonPointer, dataChangeCallback);
                return jp.get(this.output, jsonPointer); //returns the current value of the location $defer is called on
            }
            throw new Error(`$defer called on non-existant field: ${jsonPointer}`);
        }
        return deferFunc;
    }

    /**
     * Creates a stringified snapshot of the current state of the TemplateProcessor instance,
     * including its execution status, input, output, and options.
     *
     * @returns {string} A JSON string representing the snapshot of the TemplateProcessor's
     *                   current state, including template input, processed output, and options.
     *
     * @example
     * const tp = new TemplateProcessor(template, context, options);
     * const snapshotString = await tp.snapshot();
     * // snapshotString contains a JSON string with the execution plans, mvcc, template, output, and options of the
     * TemplateProcessor
     */
    public async snapshot():Promise<string> {
        const snapshotPlan:SnapshotPlan = {op:"snapshot", generatedSnapshot:"replace me"}; //generatedSnapshot gets filled in
        this.executionQueue.push(snapshotPlan);
        await this.drainExecutionQueue();
        const {generatedSnapshot} = snapshotPlan;
        return generatedSnapshot;
    }

    public static async fromExecutionStatusString(snapshot: string, context: {} = {}) {
        const tp = new TemplateProcessor({}, context);
        await tp.initializeFromExecutionStatusString(snapshot);
        return tp;
    }

    /**
     * Constructs a new TemplateProcessor instance from a given snapshot object, but does NOT initialize it.
     * This method allows the caller the opportunity to register dataChangeCallbacks and so forth before
     * template evaluation begins, providing more control over the initialization process.
     *
     * @param {object} snapshot - A snapshot object containing template, options, and output data for initializing the TemplateProcessor.
     * @param {object} [context={}] - An optional context object to be used by the TemplateProcessor.
     * @returns {TemplateProcessor} A new TemplateProcessor instance constructed from the snapshot data, not yet initialized.
     *
     * @example
     * const snapshot = {"template":"...", "options":{}, "output":"..."};
     * const tp = TemplateProcessor.constructFromSnapshot(snapshot);
     * // Register callbacks or perform other setup operations here
     * await tp.initialize();
     */
    public static constructFromSnapshotObject(snapshot: Snapshot, context: {} = {}): TemplateProcessor {
        const {template, options} = snapshot;
        return new TemplateProcessor(template, context, options);
    }

    public async initializeFromExecutionStatusString(exectuionStatusStr: string):Promise<void> {
        const exectuionStatus = JSON.parse(exectuionStatusStr);
        return await this.initialize(undefined, "/", exectuionStatus);
    }

    /**
     * When $forked is called, it must push the current output onto the forkStack so it can be restored on
     * $joined, and it must replace the output with a copy of the output.
     * @private
     * @param planStep
     */
    public generateForked(planStep: PlanStep) {
        return async (jsonPtr:JsonPointerString, data:any, op:Op='set')=>{
            const {output=this.output, forkStack, forkId} = planStep; //defaulting output to this.output is important for when this call is used by ExecutionStatus to restore
            const mvccSnapshot = TemplateProcessor.deepCopy(output); //every call to $forked creates a new planStep with its own output copy
            const mvccForkstack:Fork[] = TemplateProcessor.deepCopy(forkStack); //every call to $forked creates a new planStep with its own forkStack that is a copy if current forkstack
            mvccForkstack.push({output, forkId});
            const mvccSnapshotPlanStep:PlanStep = {
                ...planStep,jsonPtr,
                data,
                output:mvccSnapshot ,
                forkStack:mvccForkstack,
                forkId: TemplateProcessor.simpleUniqueId()
            };
            //do not await setData...$forked runs async
            this.setDataForked (mvccSnapshotPlanStep);
        }
    }

    private static simpleUniqueId():string {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    /**
     * The $set(/foo, data) command may be operating inside the context of a $forked. If this is the case
     * then $setData is intercepted here and we use the setDataForked function which applies changes to
     * forked output
     * @param planStep
     * @private
     */
    private generateSet(planStep: PlanStep) {
        const isInsideFork = planStep.forkStack.length > 0;
        if(!isInsideFork){
            return this.setData
        }
        return async (jsonPtr: JsonPointerString, data:any, op:Op='set')=>{
            this.setDataForked(planStep); //behaves like setData, except operates on the forked output
        }
    }

    /**
     * The $joined(/foo, data) function pops the forkstack and can return us to ordinary
     * non-forked operation if the pop operation empties the fork stack
     * @param planStep
     * @private
     */
    private generateJoined(planStep: PlanStep) {
        return async (jsonPtr:JsonPointerString, data:any, op:Op='set')=>{
            const {output, forkId} = planStep.forkStack.pop() || {output:this.output, forkId:"ROOT"};
            if(forkId === "ROOT"){
                this.setData(jsonPtr, data, op); //return to 'normal' non-forked operation
            }else{
                this.setDataForked( {...planStep, output, data, forkId}); //still in a nested fork
            }
        }
    }

    /**
     * this function is used to make a deep copy of the output so that when we $fork we are operating
     * on a copy of the output, not co-mutating the original
     * @param output
     */
    private static deepCopy(output:object):any {
        // Check if the value is a primitive or a function, in which case return it directly.
        if (output === null || typeof output !== "object") {
            return output;
        }

        // If the value is an Array, create a new array and copy every element recursively.
        if (Array.isArray(output)) {
            return output.reduce((arr, item, i) => {
                arr[i] = TemplateProcessor.deepCopy(item);
                return arr;
            }, []);
        }

        // If the value is an Object, create a new object and copy every property recursively.
        const copiedObj:any = {};
        for (const [key, value] of Object.entries(output)) {
            copiedObj[key] = TemplateProcessor.deepCopy(value);
        }

        return copiedObj;
    }

    /**
     * Sometimes we need to import a simple expression string that is not nested in an object.
     * for example if we {"msg":"$import('${'hello ' & to }')"), then we are importing an expression directly
     * into the parent, not nesting in an object. In this case we must slice off the last element of the
     * rootJsonPointer, because to not slice it off would imply that the target of the expression is inside
     * the msg field, but the intention when we import a simple expression is target the parent object which
     * holds the msg field.
     * @param template
     * @param rootJsonPtr
     * @returns either the original rootJsonPointer, or one that has been trimmed to point to the parent of rootJsonPtr
     * @private
     */
    private adjustRootForSimpleExpressionImports(template:any, rootJsonPtr: any[]) {
        if(typeof template === 'string' || template instanceof String){ //
            return rootJsonPtr.slice(0,-1);
        }
        return rootJsonPtr;
    }
}

