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
import {stringifyTemplateJSON as stringify} from './utils/stringify.js';
import {debounce} from "./utils/debounce.js"
import {rateLimit} from "./utils/rateLimit.js"
import {ExecutionStatus} from "./ExecutionStatus.js";
import {Sleep} from "./utils/Sleep.js";
import {saferFetch} from "./utils/FetchWrapper.js";
import {env} from "./utils/env.js"
import * as jsonata from "jsonata";
import {GeneratorManager} from "./utils/GeneratorManager.js";
import {LifecycleOwner, LifecycleState} from "./Lifecycle.js";
import {LifecycleManager} from "./LifecycleManager.js";
import {accumulate} from "./utils/accumulate.js";
import {defaulter} from "./utils/default.js";
import {CliCoreBase} from "./CliCoreBase.js";
import {DataFlow, DataFlowNode, FlowOpt} from "./DataFlow.js";
import {SerialPlanner, SerialPlan} from "./SerialPlanner.js";
import {ExecutionPlan, Planner, SerializableExecutionPlan} from "./Planner.js";


declare const BUILD_TARGET: string | undefined;

export type MetaInfoMap = Record<JsonPointerString, MetaInfo[]>;
export type Snapshot = {
    template:object,
    output: any,
    options:{},
    mvcc: any,
    metaInfoByJsonPointer: Record<JsonPointerString, MetaInfo[]>,
    plans: SerializableExecutionPlan[]
}
export type StatedError = {
    error: {
        message: string;
        name?: string;
        stack?: string | null;
    };
};
export type Op = "initialize"|"set"|"delete"|"eval"|"forceSetInternal";
export type Fork = {forkId:ForkId, output:object};
export type ForkId = string;

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
export type Mutation =  {jsonPtr:JsonPointerString, op:Op, data:any};

//A Transaction is a set of changes applied atomically.
export type Transaction ={
    op: "transaction",
    mutations: Mutation[]
}

/**
 * a FunctionGenerator is used to generate functions that need the context of which expression they were called from
 * which is made available to them in the MetaInf
 */
export type FunctionGenerator<T> = (context: T, templateProcessor?: TemplateProcessor) => Promise<(...args: any[]) => Promise<any>> | ((...args: any[]) => any);




/**
 * A callback function that is triggered when data changes.
 *
 * This callback supports both the legacy `removed` boolean parameter and the new `op` parameter
 * to avoid breaking existing clients while allowing for more descriptive operations.
 *
 * - When `removed` is provided, it indicates whether the data was removed (`true` for delete, `false` for set).
 * - When `op` is provided, it specifies the operation performed on the data:
 *   - `"set"`: The data was set or updated.
 *   - `"delete"`: The data was deleted.
 *   - `"forceSetInternal"`: A forced internal set operation was performed.
 *
 * Both `removed` and `op` are optional. If both are provided, `op` takes precedence in interpreting the operation.
 *
 * @param data - The data that was changed and is pointed to by ptr
 * @param ptr - The JSON pointer string indicating where in the root object the change occurred. In the case of callbacks
 * registered on "/", ptr will be an array of JSON pointers into the `data` field  represents the root object.
 * @param removed - (optional) A boolean indicating whether the data was removed. `true` for delete, `false` for set.
 * @param op - (optional) A string describing the operation. Can be `"set"`, `"delete"`, or `"forceSetInternal"`.
 */
export type DataChangeCallback = (data: any, ptr: JsonPointerString|JsonPointerString[], removed?: boolean, op?: Op) => void;


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
     * @param options
     * @returns {Promise<TemplateProcessor>} Returns an initialized instance of `TemplateProcessor`.
     */
    static async load(template:object, context = {}, options:object={}):Promise<TemplateProcessor> {
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
     *   clearInterval: typeof clearInterval,
     *   setTimeout: typeof setTimeout,
     *   setInterval: typeof setInterval,
     *   console: Console,
     *   debounce: typeof debounce
     *   Date: Date
     *   rateLimit: typeof rateLimit
     *   env: typeof env
     * }}
     */
    static DEFAULT_FUNCTIONS = {
        fetch:saferFetch,
        console,
        debounce,
        Date,
        rateLimit,
        env
    }

    private static _isNodeJS = typeof process !== 'undefined' && process.release && process.release.name === 'node';

    /**
     * An instance of the `Planner` interface used to manage execution plans.
     *
     * The `planner` is responsible for generating and executing `ExecutionPlan`s,
     * which define the steps necessary to process templates. It provides methods
     * to initialize plans based on metadata and execute those plans. The planner
     * can be replaced by any valid Planner. We have SerialPlanner and ParallelPlanner
     *
     * @see Planner
     * @see ExecutionPlan
     */
    planner: Planner;
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
    templateMeta: Record<JsonPointerString, MetaInfo>={};

    /** List of warnings generated during template processing. */
    warnings: any[] = [];

    /** Maps JSON pointers of import paths to their associated meta information.
     * So, for example the key "/" -> MetaInfo[]. the MetaInfo are in no particular order
     * HOWEVER the individual MetaInfo objects are the same objects as memory as those in
     * the templateMeta tree. Therefore, from any MetaInfo, you can navigate to it children
     * as its children are simply field of the object that don't end in "__". This explains
     * why we name the MetaInfo fields with "__" suffix, so they can be differentiated from
     * 'real' fields of the template output nodes.
     * */
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
    private readonly executionQueue:(ExecutionPlan|SerialPlan|SnapshotPlan|Transaction)[] = [];

    /** function generators can be provided by a caller when functions need to be
     *  created in such a way that they are somehow 'responsive' or dependent on their
     *  location inside the template. Both the generator function, and the function
     *  it generates are asynchronous functions (ie they return a promise).
     *  $import is an example of this kind of behavior.
     *  When $import('http://mytemplate.com/foo.json') is called, the import function
     *  is actually generated on the fly, using knowledge of the json path that it was
     *  called at, to replace the content of the template at that path with the downloaded
     *  content.*/
    functionGenerators: Map<string, FunctionGenerator<MetaInfo>> = new Map();
    planStepFunctionGenerators:  Map<string, FunctionGenerator<PlanStep>> = new Map();

    /** for every json pointer, we have multiple callbacks that are stored in a Set
     * @private
     */
    private changeCallbacks:Map<JsonPointerString, Set<DataChangeCallback>>;

    /** Flag indicating if the template processor is currently initializing. */
    private isInitializing: boolean;

    /** A unique string identifier for the template processor instance like '3b12f1df-5232-4e1f-9c1b-3c6fc5ac7d3f'. */
    public uniqueId:string;

    private tempVars:JsonPointerString[]=[];

    timerManager:TimerManager;

    private generatorManager:GeneratorManager;

    /** Allows caller to set a callback to propagate initialization into their framework
     * @deprecated use lifecycleManager instead
     * */
    public readonly onInitialize: Map<string,() => Promise<void>|void>;

    /**
     * Allows a caller to receive a callback after the template is evaluated, but before any temporary variables are
     * removed. This function is slated to be replaced with a map of functions like onInitialize
     * @deprecated use lifecycleManager instead
     */
    public postInitialize: ()=> Promise<void> = async () =>{};
    public readonly lifecycleManager:LifecycleOwner = new LifecycleManager(this);

    public executionStatus: ExecutionStatus;

    public isClosed = false;

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
        this.generatorManager = new GeneratorManager(this);
        this.uniqueId = crypto.randomUUID();
        this.setData = this.setData.bind(this); // Bind template-accessible functions like setData and import
        this.import = this.import.bind(this); // allows clients to directly call import on this TemplateProcessor
        this.logger = new ConsoleLogger("info");
        this.setupContext(context);
        this.resetTemplate(template);
        this.options = options;
        this.isInitializing = false;
        this.changeCallbacks = new Map();
        this.tagSet = new Set();
        this.onInitialize = new Map();
        this.executionStatus = new ExecutionStatus(this);
        const {planner=new SerialPlanner(this)} = options as any;
        this.planner = planner;
    }

    // resetting template means that we are resetting all data holders and set up new template
    private resetTemplate(template:object) {
        this.executionQueue.length = 0; //empty the execution queue - it can contain lingering plans that mustn't infect this template
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
                        this.logger.debug(this.executionStatus.toJsonString());
                    }
                    return output;
            }}, //note that save is before context, by design, so context can override save as needed
            context,
            {"set": this.setData},
            {"sleep": new Sleep(this.timerManager).sleep},
            {"setTimeout": this.timerManager.setTimeout},
            {"clearTimeout": this.timerManager.clearTimeout},
            {"generate": this.generatorManager.generate},
            {"accumulate": accumulate},
            {"default": defaulter},

        );
        const safe = this.withErrorHandling.bind(this);
        for (const key in this.context) {
            if (typeof this.context[key] === 'function') {
                this.context[key] = safe(this.context[key]);

            }
        }
        this.setupFunctionGenerators();
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
    public async initialize(importedSubtemplate: {}|undefined = undefined, jsonPtr: string = "/", executionStatusSnapshot: Snapshot|undefined = undefined):Promise<void> {
        if(jsonPtr === "/"){
            this.timerManager.clear();
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
            this.logger.error("-----Initialization '/' is already in progress. Ignoring concurrent call to initialize!!!! Strongly consider checking your JS code for errors.-----");
            return;
        }

        // Set the lock
        this.isInitializing = true;
        //run all initialization plugins
        for (const [name, task] of this.onInitialize) {
            this.logger.debug(`Running onInitialize plugin '${name}'...`);
            await task();
        }
        await (this.lifecycleManager as LifecycleManager).runCallbacks(LifecycleState.StartInitialize);
        try {
            if (jsonPtr === "/") {
                this.errorReport = {}; //clear the error report when we initialize a root importedSubtemplate
            }

            if (typeof BUILD_TARGET !== 'undefined' && BUILD_TARGET !== 'web') {
                const _level = this.logger.level; //carry the ConsoleLogger level over to the fancy logger
                this.logger = await FancyLogger.getLogger() as StatedLogger;
                this.logger.level = _level;
            }

            this.logger.debug(`initializing (uid=${this.uniqueId})...`);
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
            // Recreating the meta info if execution status is not provided
            if (executionStatusSnapshot === undefined) {
                const metaInfos = await this.createMetaInfos(compilationTarget , parsedJsonPtr);
                this.metaInfoByJsonPointer[jsonPtr] = metaInfos; //dictionary for importedSubtemplate meta info, by import path (jsonPtr)
                this.sortMetaInfos(metaInfos);
                this.populateTemplateMeta(metaInfos);
                this.setupDependees(metaInfos); //dependency <-> dependee is now bidirectional
                this.propagateTags(metaInfos);
                this.tempVars = [...this.tempVars, ...this.cacheTmpVarLocations(metaInfos)];
                this.isClosed = false; //open the execution queue for processing
                await this.queueInitializationPlan(jsonPtr);
            } else {
                this.isClosed = false;
                await this.planner.restore(this.executionStatus);
            }
            await this.postInitialize();
            await (this.lifecycleManager as LifecycleManager).runCallbacks(LifecycleState.PreTmpVarRemoval);
            this.removeTemporaryVariables(this.tempVars, jsonPtr);
            this.logger.verbose("initialization complete...");
            this.logOutput(this.output);
            await (this.lifecycleManager as LifecycleManager).runCallbacks(LifecycleState.Initialized);
        }finally {
            this.isInitializing = false;
        }
    }

    async close():Promise<void>{
        this.isClosed = true;
        await (this.lifecycleManager as LifecycleManager).runCallbacks(LifecycleState.StartClose);
        this.executionQueue.length = 0; //nuke execution queue
        await this.drainExecutionQueue();
        this.timerManager.clear();
        this.changeCallbacks.clear();
        this.executionStatus.clear();
        await (this.lifecycleManager as LifecycleManager).runCallbacks(LifecycleState.Closed);
        (this.lifecycleManager as LifecycleManager).clear();
    }

    private async queueInitializationPlan(jsonPtr:JsonPointerString) {
        const startTime = Date.now(); // Capture start time
        this.logger.verbose(`generating initialization plan for template (uid=${this.uniqueId})...`);
        const plan:ExecutionPlan = this.planner.getInitializationPlan(jsonPtr);
        this.executionQueue.push(plan);
        await this.drainExecutionQueue(false);
        const endTime = Date.now(); // Capture end time

        this.logger.verbose(`formulated initialization plan in ${endTime - startTime} ms...`);

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

    private getImport = (metaInfo: MetaInfo):(templateToImport:string)=>Promise<symbol> => { //we provide the JSON Pointer that targets where the imported content will go
        //import the template to the location pointed to by jsonPtr
        return async (importMe) => {
            let resp;
            const parsedUrl = this.parseURL(importMe);
            if (parsedUrl) { //remote download
                this.logger.debug(`Attempting to fetch imported URL '${importMe}'`);
                resp = await this.fetchFromURL(parsedUrl);
                resp = this.extractFragmentIfNeeded(resp, parsedUrl);
            } else if (MetaInfoProducer.EMBEDDED_EXPR_REGEX.test(importMe)) { //this is the case of importing an expression string
                resp = importMe; //literally a direction expression like '/${foo}'
            } else {
                this.logger.debug(`Attempting literal import of object as json '${importMe}'`);
                resp = this.validateAsJSON(importMe);
                if (resp === undefined) { //it wasn't JSON
                    this.logger.debug(`Attempting local file import of '${importMe}'`);
                    const fileExtension = path.extname(importMe).toLowerCase();
                    if (TemplateProcessor._isNodeJS || (typeof BUILD_TARGET !== 'undefined' && BUILD_TARGET !== 'web')) {
                        try {
                            resp = await this.localImport(importMe);
                            if (fileExtension === '.js' || fileExtension === '.mjs') {
                                return resp; //the module is directly returned and assigned
                            }
                        }catch(error){
                            //we log here and don't rethrow because we don't want to expose serverside path information to remote clients
                            this.logger.error((error as any).message);
                        }
                    } else {
                        this.logger.error(`It appears we are running in a browser where we can't import from local ${importMe}`)
                    }
                }
            }
            if (resp === undefined) {
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
                }else if (contentType.includes("text/plain")) {
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
                } else if (fileExtension === 'text' || fileExtension === 'txt') {
                    format = 'text';
                }
            }

            switch (format) {
                case 'json':
                    return await resp.json();
                case 'text':
                    return await resp.text();
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
                    metaInfo.variables__ = Array.from(depFinder.variables);
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
                jp.set(this.templateMeta, meta.jsonPointer__, meta); //templateMeta is a tree structure of MeatInfo mirroring the actual structure
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
                        "tags__": [],
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
                        "tags__": [],
                        "treeHasExpressions__": false,
                        parent__: parent
                    };
                    merge(meta, nonMaterialized);
                }

                (meta.dependees__ as JsonPointerString[]).push(i.jsonPointer__ as JsonPointerString);
            });
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
                if(dependency.tags__){
                    dependency.tags__.forEach(tag => node.tags__.push(tag));
                }
            });
            node.tags__ = [...new Set<string>(node.tags__)]; //uniquify the array
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
                    this.callDataChangeCallbacks(current, jsonPtr, true, "delete");
                }
            });
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
        if(this.isClosed){
            throw new Error("Attempt to setData on a closed TemplateProcessor.")
        }
        this.isEnabled("debug") && this.logger.debug(`setData on ${jsonPtr} for TemplateProcessor uid=${this.uniqueId}`)
        //get all the jsonPtrs we need to update, including this one, to percolate the change
        const [plan, fromPlan] = this.planner.getMutationPlan(jsonPtr, data, op);
        this.executionQueue.push(plan);
        if(this.isEnabled("debug")) {
            this.logger.debug(`execution plan (uid=${this.uniqueId}): ${stringify(plan)}`);
            this.logger.debug(`execution plan queue (uid=${this.uniqueId}): ${stringify(this.executionQueue)}`);
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
        if(this.isClosed){
            throw new Error("Attempt to setData on a closed TemplateProcessor.")
        }
        const {jsonPtr} = planStep;
        this.isEnabled("debug") && this.logger.debug(`setData on ${jsonPtr} for TemplateProcessor uid=${this.uniqueId}`)
        const fromPlan = [...this.from(jsonPtr)]; //defensive copy
        const mutationPlan = {...planStep, sortedJsonPtrs:fromPlan, restoreJsonPtrs: [], didUpdate:[], op:"set"};
        await this.executePlan(mutationPlan as SerialPlan);
        return fromPlan;
    }

    private async drainExecutionQueue(removeTmpVars:boolean=true){
        while (this.executionQueue.length > 0 && !this.isClosed) {
            try {
                const plan: ExecutionPlan| SerialPlan | SnapshotPlan | Transaction= this.executionQueue[0];
                if (plan.op === "snapshot") {
                    (plan as SnapshotPlan).generatedSnapshot = this.executionStatus.toJsonString();;
                } else if(plan.op === "transaction" ){
                    this.applyTransaction(plan as Transaction); //should this await?
                }else{
                    await this.executePlan(plan as SerialPlan);
                }
                removeTmpVars && this.removeTemporaryVariables(this.tempVars, "/");
            }finally {
                this.executionQueue.shift();
            }
        }
    }

    /**
     * Applies a transaction by processing each mutation within the transaction.
     *
     * For each mutation, this method applies the specified operation (`set` or `delete`)
     * to the `output` object based on the `jsonPtr` (JSON pointer).
     * It also triggers data change callbacks after each mutation.
     *
     * @param transaction - The transaction object containing a list of mutations to apply.
     * @throws {Error} If the operation (`op`) is neither `"set"` nor `"delete"`.
     *
     * The transaction is processed as follows:
     * - `"set"`: Sets the value at the location specified by `jsonPtr` using `jp.set`.
     * - `"delete"`: Removes the value at the location specified by `jsonPtr` using `jp.remove`.
     *
     * After each mutation, `callDataChangeCallbacks` is called to notify of the change.
     * Finally, a batch data change callback is triggered for all affected JSON pointers.
     *
     * @private
     */
    private async applyTransaction(transaction: Transaction) {
        const ptrs: JsonPointerString[] = [];
        for (const { jsonPtr, data, op } of transaction.mutations) {
            ptrs.push(jsonPtr);
            if (op === 'set') {
                jp.set(this.output, jsonPtr, data);
            } else if (op === 'delete') {
                jp.remove(this.output, jsonPtr);
            } else {
                throw new Error(`Transaction cannot include Op type ${op}`);
            }
            await this.callDataChangeCallbacks(data, jsonPtr, op === 'delete', op);
        }
        await this.callDataChangeCallbacks(this.output, ptrs);
    }

    /**
     * Registers a transaction callback to handle batched data changes.
     *
     * When setData is called, a set of changes (a DAG) is calculated and the changes are sequentially applied. These
     * changes can be 'bundled' into a single Transaction for the purpose of capturing a single set of changes that
     * if atomically applied, has the exact same effect as the DAG propagation. Therefore, a Transaction can be a
     * less chatty way to capture and apply changes from one template instance A to template instance B without
     * incurring the cost of for B to compute the change DAG.
     *
     * @param cb - A callback function that handles a `Transaction` object. The callback is expected
     * to return a `Promise<void>`.
     *
     * @throws {Error} If the callback is registered for any path other than `'/'`.
     *
     * @public
     */
    public setTransactionCallback(cb: (transaction: Transaction) => Promise<void>) {
        const dataChangeCallback = async (root: any, jsonPtrs: JsonPointerString | JsonPointerString[], removed?: boolean, op?: Op) => {
            if (!Array.isArray(jsonPtrs)) {  // This is the case where the update is for the root document
                throw new Error(`DataChangeHandler for transaction bundling was illegally registered on ${jsonPtrs} (it can only be registered on '/'`);
            }
            const mutations: Mutation[] = jsonPtrs.map(jsonPtr => {
                const data = jp.has(this.output, jsonPtr) ? jp.get(this.output, jsonPtr) : undefined;
                return {
                    data,
                    jsonPtr,
                    op: data === undefined ? "delete" : "set",
                };
            });
            const transaction: Transaction = {
                op: "transaction",
                mutations
            };
            await cb(transaction);
        };
        this.setDataChangeCallback("/", dataChangeCallback);
    }

    /**
     * Removes a previously registered transaction callback.
     *
     * This method removes the callback that was registered with `setTransactionCallback`
     * for the root path `'/'`.
     *
     * @param cb - The callback function to remove, which should match the previously registered callback.
     *
     * @public
     */
    public removeTransactionCallback(cb: DataChangeCallback) {
        this.removeDataChangeCallback("/", cb);
    }



    private isEnabled(logLevel:Levels):boolean{
        return LOG_LEVELS[this.logger.level] >= LOG_LEVELS[logLevel];
    }

    private logOutput(output:any) {
        if (this.isEnabled("debug")) {
            this.logger.debug(`----------------TEMPLATE OUTPUT (${this.uniqueId})-----------------`)
            this.logger.debug(stringify(output));
        }
    }

    public async executePlan(plan:ExecutionPlan){
        try {
            await this.planner.execute(plan);
        }catch(error){
            this.logger.error("plan execution failed");
            throw error;
        }
    }


    public async executeDataChangeCallbacks(plan:SerialPlan) {
        let anyUpdates = false;
        const {receiveNoOpCallbacksOnRoot:everything = false} = this.options;
        let jsonPtrArray = plan.sortedJsonPtrs;
        const onlyWhatChanged = (plan:SerialPlan)=>{
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
            const {op="set"} = plan;
            // current callback APIs are not interested in deferred updates, so we reduce op to boolean "removed"
            const removed = op==="delete";
            //admittedly this structure of this common callback is disgusting. Essentially if you are using the
            //common callback you don't want to get passed any data that changed because you are saying in essence
            //"I don't care what changed".
            //ToDO - other calls to callDataChangeCallbacks are not awaiting. Reconcile this
            await this.callDataChangeCallbacks(plan.output, jsonPtrArray, removed, op);
        }
    }

    public async mutate(planStep: PlanStep):Promise<boolean> {
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

    async evaluateNode(step:PlanStep):Promise<boolean> {
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
                this.logger.debug(`Skipping execution of expression at ${jsonPtr}, because none of required tags (${tags__}) were set with --tags`);
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

    private setDataIntoTrackedLocation(templateMeta:Record<JsonPointerString,MetaInfo>, planStep:PlanStep ) {
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
        await this.callDataChangeCallbacks(data, jsonPtr, op==="delete", op);
        return true;
    }

    private async _evaluateExprNode(planStep: PlanStep) {
        const {jsonPtr, output} = planStep;
        let evaluated: AsyncGenerator<unknown, any, unknown> | any;
        const metaInfo = jp.get(this.templateMeta, jsonPtr) as MetaInfo;
        const {compiledExpr__, exprTargetJsonPointer__, expr__, variables__=[]} = metaInfo;
        let target;
        try {
            const context = {...this.context};
            await this.populateContextWithGeneratedFunctions(context, variables__, metaInfo, planStep);
            this.populateContextWithSelf(context, metaInfo);
            target = jp.get(output, exprTargetJsonPointer__ as JsonPointerString); //an expression is always relative to a target
            evaluated = await compiledExpr__?.evaluate(
                target,
                context
            );
            metaInfo.isInitialized__ = true;
            if (evaluated?._jsonata_lambda) {
                evaluated = TemplateProcessor.wrapInOrdinaryFunction(evaluated);
                metaInfo.isFunction__ = true;
            }
        } catch (error: any) {
            this.logger.error(`Error evaluating expression at ${jsonPtr}`);
            this.logger.error(error);
            this.logger.debug(`Expression: ${expr__}`);
            this.logger.debug(`Target: ${stringify(target)}`);
            this.logger.debug(`Target: ${stringify(target)}`);
            this.logger.debug(`Result: ${stringify(evaluated)}`);
            const _error = new Error(error.message);
            _error.name = "JSONata evaluation exception";
            throw _error;
        }
        if (GeneratorManager.isAsyncGenerator(evaluated)) {
            //awaits and returns the first item. And pumpItems begins pumping remaining items into execution queue asynchronously
            evaluated = await this.generatorManager.pumpItems(evaluated as AsyncGenerator, metaInfo, this);
        }
        return evaluated

    }

    private populateContextWithSelf(context:any, metaInf:MetaInfo):void{
        const {isInitialized__=false, jsonPointer__, compiledExpr__, parent__} = metaInf;
        if(compiledExpr__ && isInitialized__){
            context.self = jp.get(this.output, jsonPointer__); //populate context with self
        }else{
            context.self = undefined;
        }
        //parent is much trickier than self because parent is never an expression, so it
        //means expressions will say "$parent.foo" which introduces dependencies which we would expect
        //to resolve before accessing them. So punt on $parent for now
        //context.parent = jp.get(this.output, parent__);
    }

    private setupFunctionGenerators(){
        this.functionGenerators.set("errorReport", this.generateErrorReportFunction);
        this.functionGenerators.set("defer", this.generateDeferFunction);
        this.functionGenerators.set("import", this.getImport);
        this.planStepFunctionGenerators.set("forked", this.generateForked);
        this.planStepFunctionGenerators.set("joined", this.generateJoined);
        this.planStepFunctionGenerators.set("set", this.generateSet);
        this.planStepFunctionGenerators.set("setInterval", this.timerManager.generateSetInterval);
        this.planStepFunctionGenerators.set("clearInterval", this.timerManager.generateClearInterval);
    }

    /**
     * Certain functions callable in a JSONata expression must be dynamically generated. They cannot be static
     * generated because the function instance needs to hold a reference to some kind of runtime state, either
     * a MetaInfo or a PlanStep (see FunctionGenerator type). This method, for a given list of function names,
     * generates the function by finding and calling the corresponding FunctionGenerator.
     * @param context
     * @param functionNames
     * @param metaInf
     * @param planStep
     * @private
     */
    private async populateContextWithGeneratedFunctions( context:any, functionNames:string[], metaInf:MetaInfo, planStep:PlanStep):Promise<void>{
        const safe = this.withErrorHandling.bind(this);
        for (const name of functionNames) {
            try {
                let generator:any = this.functionGenerators.get(name);
                if (generator) {
                    const generated:any = await generator(metaInf, this);
                    context[name] = safe(generated);
                } else {
                    generator = this.planStepFunctionGenerators.get(name);
                    if (generator) {
                        const generated = await generator(planStep);
                        context[name] = safe(generated);
                    }
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                const msg = `Function generator '${name}' failed to generate a function and erred with:"${errorMessage}"`;
                this.logger.error(msg);
                throw new Error(msg);
            }
        }
    }

    private allTagsPresent(tagSetOnTheExpression:string[]) {
        if(tagSetOnTheExpression.length === 0 && this.tagSet.size > 0){
            return false;
        }
        return tagSetOnTheExpression.every(tag => this.tagSet.has(tag));
    }

    private _setData(planStep: PlanStep):boolean {
        const {jsonPtr, data=undefined, op="set", output} = planStep;
        if (data === TemplateProcessor.NOOP) { //a No-Op is used as the return from 'import' where we don't actually need to make the assignment as init has already dont it
            return false;
        }

        if(op === 'delete'){
            if(jp.has(output, jsonPtr)) {
                jp.remove(output, jsonPtr);
                this.callDataChangeCallbacks(data, jsonPtr, true, op);
                return true;
            }
            return false;
        }
        let existingData;
        if (jp.has(output, jsonPtr)) {
            //note get(output, 'foo/-') SHOULD and does return undefined. Don't be tempted into thinking it should
            //return the last element of the array. 'foo/-' syntax only has meaning for update operations. IF we returned
            //the last element of the array, the !isEqual logic below would fail because it would compare the to-be-appended
            //item to what is already there, which is nonsensical.
            existingData = jp.get(output, jsonPtr);
        }
        const {sideEffect__ = false, value:affectedData} = data || {};
        if (!sideEffect__) {
            if(!isEqual(existingData, data)) {
                jp.set(output, jsonPtr, data);
                this.callDataChangeCallbacks(data, jsonPtr, false);
                return true;
            }else {
                if (this.isEnabled("verbose"))this.logger.verbose(`data to be set at ${jsonPtr} did not change, ignored. `);
                return false;
            }
        }else { //a side-effect happened
            if (affectedData !== existingData){ //use pointer comparison here, not deep equality
                jp.set(output, jsonPtr, affectedData);
            }
            this.callDataChangeCallbacks(affectedData, jsonPtr, false); //always call the callback as by definition a side effect changed the data
            return true;
        }

    }


    from(jsonPtr:JsonPointerString) {
        //check execution plan cache
        if (this.executionPlans[jsonPtr] === undefined) {
            this.executionPlans[jsonPtr] = this.planner.from(jsonPtr)
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
            //return this.topologicalSort([node], false); //for the repl "to" command we want to see all the dependencies, not just expressions (so exprsOnly=false)
            return new SerialPlanner(this).topologicalSort([node], false);
        }
        return [];
    }


    /**
     * Controls the flow of data and retrieves root nodes based on the specified level.
     *
     * @param {FlowOpt} level - The level specifying the granularity of the data flow.
     * @return {DataFlowNode[]} An array of root nodes that are computed based on the specified level.
     */
    flow(level:FlowOpt):DataFlowNode[]{
        return new DataFlow(this).getRoots(level);
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
    private async callDataChangeCallbacks(data: any, jsonPointer: JsonPointerString|JsonPointerString[], removed: boolean = false, op:Op="set") {
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
                    cbFn(data, jsonPointer as JsonPointerString, removed, op);
                }) //works with cbFn that is either sync or async by wrapping in promise
            );

            try {
                await Promise.all(promises);
            } catch (error:any) {
                this.logger.error(`Error in dataChangeCallback at ${JSON.stringify(jsonPointer)}: ${error.message}`);
            }
        }
    }


    //returns the evaluation plan for evaluating the entire template
    async plan() {
        return new SerialPlanner(this).topologicalSort(this.metaInfoByJsonPointer["/"], true);
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

    private async localImport(localPath: string) {
        this.logger.debug(`importing ${localPath}`);
        this.logger.debug(`resolving import path using --importPath=${this.options.importPath || ""}`);
        const fullpath = CliCoreBase.resolveImportPath(localPath, this.options.importPath);
        this.logger.debug(`resolved import: ${fullpath}`);
        const {importPath} = this.options;

        if(!importPath){
            throw new Error(`$import statements are not allowed in templates unless the importPath is set (see TemplateProcessor.options.importPath and the --importPath command line switch`);
        }

        // Ensure `fullpath` is within `importPath`. I should be able to $import('./foo.mjs') and$import('./foo.mjs')
        // but not $import('../../iescaped/foo.mjs)
        const resolvedImportPath = path.resolve(importPath);
        if (!fullpath.startsWith(resolvedImportPath)) {
            throw new Error(`Resolved import path was ${resolvedImportPath} which is outside the allowed --importPath (${importPath})`);
        }

        try {
            const fileExtension = path.extname(fullpath).toLowerCase();
            if (fileExtension === '.js' || fileExtension === '.mjs') {
                return await import(fullpath);
            }

            // Read the file
            const content = await fs.promises.readFile(fullpath, 'utf8');
            if (fileExtension === ".json") {
                return JSON.parse(content);
            } else if (fileExtension === '.yaml' || fileExtension === '.yml') {
                return yaml.load(content);
            } else if (fileExtension === '.text' || fileExtension === '.txt') {
                return content;
            }else {
                throw new Error('Import file extension must be .json, .yaml, .yml, .txt, .js, or .mjs');
            }
        } catch (e) {
            this.logger.debug('import was not a local file');
            throw e;
        }
    }


    public static wrapInOrdinaryFunction(jsonataLambda:any) {
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

    private generateErrorReportFunction = async (metaInfo: MetaInfo) => {
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



    private generateDeferFunction = (metaInfo: MetaInfo) => {
        return (jsonPointer: JsonPointerString, timeoutMs: number) => {

            if (jp.has(this.output, jsonPointer)) {
                const dataChangeCallback = debounce(async (data) => {
                    this.setData(metaInfo.jsonPointer__ as JsonPointerString, data, "forceSetInternal"); //sets the value into the location in the template where the $defer() call is made
                }, timeoutMs);
                this.setDataChangeCallback(jsonPointer, dataChangeCallback);
                return jp.get(this.output, jsonPointer); //returns the current value of the location $defer is called on
            }
            throw new Error(`$defer called on non-existant field: ${jsonPointer}`);
        };
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
    public generateForked = (planStep: PlanStep) => {
        return async (jsonPtr:JsonPointerString, data:any, op:Op='set')=>{
            const {output=this.output, forkStack, forkId} = planStep; //defaulting output to this.output is important for when this call is used by ExecutionStatus to restore
            const mvccSnapshot = TemplateProcessor.deepCopy(output); //every call to $forked creates a new planStep with its own output copy
            const mvccForkstack:Fork[] = TemplateProcessor.deepCopy(forkStack); //every call to $forked creates a new planStep with its own forkStack that is a copy if current forkstack
            mvccForkstack.push({output, forkId});
            const mvccSnapshotPlanStep:PlanStep = {
                ...planStep,
                jsonPtr,
                data,
                output:mvccSnapshot ,
                forkStack:mvccForkstack,
                forkId: TemplateProcessor.simpleUniqueId()
            };
            //do not await setData...$forked runs async
            void this.setDataForked (mvccSnapshotPlanStep);
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
    private generateSet = (planStep: PlanStep) => {
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
    private generateJoined = (planStep: PlanStep) => {
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

    /**
     * Retrieves the metadata information for a given JSON Pointer string.
     *
     * @param jsonPtr - The JSON Pointer string that identifies the template node.
     * @returns The `MetaInfo` object corresponding to the provided JSON Pointer.
     * @throws If the JSON Pointer does not exist in the `templateMeta`.
     */
    public getMetaInfo(jsonPtr:JsonPointerString):MetaInfo{
        return jp.get(this.templateMeta, jsonPtr) as MetaInfo;
    }
}

