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

import { default as jp } from './JsonPointer.js';
import isEqual from "lodash-es/isEqual.js";
import merge from 'lodash-es/merge.js';
import yaml from 'js-yaml';
import Debugger from './Debugger.js';
import MetaInfoProducer from './MetaInfoProducer.js';
import DependencyFinder from './DependencyFinder.js';
import path from 'path';
import fs from 'fs';
import ConsoleLogger from "./ConsoleLogger.js";
import FancyLogger from "./FancyLogger.js";
import StatedREPL from "./StatedREPL.js";

export default class TemplateProcessor {

    static DEFAULT_FUNCTIONS = {
        "fetch": fetch,
        "setInterval": setInterval,
        "clearInterval": clearInterval,
        "setTimeout": setTimeout,
        "console": console
    }

    constructor(template={}, context = {}, options={}) {
        this.setData = this.setData.bind(this); // Bind template-accessible functions like setData and import
        this.import = this.import.bind(this); // allows clients to directly call import on this TemplateProcessor
        this.logger = new ConsoleLogger("info");
        this.context = merge(TemplateProcessor.DEFAULT_FUNCTIONS, context);
        this.context = merge(this.context, {"set": this.setData});
        const safe = this.withErrorHandling.bind(this);
        for (const key in this.context) {
            if (typeof this.context[key] === 'function') {
                this.context[key] = safe(this.context[key]);
            }
        }
        this.output = template; //initial output is input template
        this.input = JSON.parse(JSON.stringify(template));
        this.templateMeta = JSON.parse(JSON.stringify(this.output));// Copy the given template to initialize the templateMeta
        this.warnings = [];
        this.metaInfoByJsonPointer = {}; //there will be one key "/" for the root and one additional key for each import statement in the template
        this.tagSet = new Set();
        this.options = options;
        this.debugger = new Debugger(this.templateMeta, this.logger);
        this.errorReport = {}
    }

    //this is used to wrap all functions that we expose to jsonata expressions so that
    //they do not throw exceptions, but instead return {"error":{...the error...}}
    withErrorHandling(fn) {
        return (...args) => {
            try {
                const result = fn(...args);
                if (result instanceof Promise) {
                    return result.catch(error => {
                        this.logger.error(error.toString());
                        return {
                            "error": {
                                message: error.message,
                                name: error.name,
                                stack: error.stack,
                            }
                        };
                    });
                }
                return result;
            } catch (error) {
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

    async initialize(template = this.input, jsonPtr = "/") {
        if(jsonPtr === "/"){
            this.errorReport = {}; //clear the error report when we initialize a root template
        }
        if(typeof BUILD_TARGET === 'undefined' || BUILD_TARGET !== 'web'){
            const _level = this.logger.level; //carry the ConsoleLogger level over to the fancy logger
            this.logger = await FancyLogger.getLogger();
            this.logger.level = _level;
        }
        this.logger.verbose("initializing...");
        this.logger.debug(`tags: ${JSON.stringify(this.tagSet)}`);
        this.executionPlans = {}; //clear execution plans
        let parsedJsonPtr = jp.parse(jsonPtr);
        parsedJsonPtr = isEqual(parsedJsonPtr, [""]) ? [] : parsedJsonPtr; //correct [""] to []
        let metaInfos = await this.createMetaInfos(template, parsedJsonPtr);
        this.metaInfoByJsonPointer[jsonPtr] = metaInfos; //dictionary for template meta info, by import path (jsonPtr)
        this.sortMetaInfos(metaInfos);
        this.populateTemplateMeta(metaInfos);
        this.setupDependees(metaInfos); //dependency <-> dependee is now bidirectional
        this.propagateTags(metaInfos);
        await this.evaluate(jsonPtr);
        this.removeTemporaryVariables(metaInfos);
        this.logger.verbose("initialization complete...");
    }


    async evaluate(jsonPtr) {
        const startTime = Date.now(); // Capture start time

        this.logger.verbose("evaluating template...");
        await this.evaluateDependencies(this.metaInfoByJsonPointer[jsonPtr]);

        const endTime = Date.now(); // Capture end time

        this.logger.verbose(`evaluation complete in ${endTime - startTime} ms...`);

        //the commented out approach below us necessary if we want to push in imports. It has the unsolved problem
        //that if the existing template has dependencies on the to-be-imported template, and we are not forcing it
        //in externally but rather the import is written as part of the template that the things that depend on the
        //import will be executed twice.
        /*
        const rootMetaInfos = this.metaInfoByJsonPointer["/"];
        if (jsonPtr === "/") { //<-- root/parent template
            await this.evaluateDependencies(rootMetaInfos);
        } else {  //<-- child/imported template
            //this is the case of an import. Imports target something other than root
            const importedMetaInfos = this.metaInfoByJsonPointer[jsonPtr];
            await this.evaluateDependencies([
                ...TemplateProcessor.dependsOnImportedTemplate(rootMetaInfos, jsonPtr),
                ...importedMetaInfos
            ]);
        }

         */
    }

    static async load(template, context = {}) {
        const t = new TemplateProcessor(template, context);
        await t.initialize();
        return t;
    }

    async import(template, jsonPtrImportPath) {
        jp.set(this.output, jsonPtrImportPath, template);
        await this.initialize(template, jsonPtrImportPath);
    }

    static NOOP = Symbol('NOOP');

    getImport(jsonPtrIntoTemplate) { //we provide the JSON Pointer that targets where the imported content will go
        //import the template to the location pointed to by jsonPtr
        return async (importMe) => {
            let resp;
            const parsedUrl = this.parseURL(importMe);
            if (parsedUrl) { //remote download
                const {protocol} = parsedUrl;
                this.logger.debug(`Attempting to fetch imported URL '${importMe}'`);
                resp = await this.fetchFromURL(parsedUrl);
                resp = this.extractFragmentIfNeeded(resp, parsedUrl);
            } else {
                this.logger.debug(`Attempting local file import of '${importMe}'`);
                const mightBeAFilename= importMe;
                if (typeof BUILD_TARGET === 'undefined' || BUILD_TARGET !== 'web') {
                    resp = await this.localImport(mightBeAFilename);
                }
                if(resp === undefined){
                    this.logger.debug(`Attempting literal import of '${importMe}'`);
                    resp = this.validateAsJSON(importMe);
                }
            }
            if(resp === undefined){
                throw new Error(`Import failed for '${importMe}' at '${jsonPtrIntoTemplate}'`);
            }
            await this.setContentInTemplate(resp, jsonPtrIntoTemplate);
            return TemplateProcessor.NOOP;
        }
    }
    parseURL(input) {
        try {
            return new URL(input);
        } catch (e) {
            return false;
        }
    }

    async fetchFromURL(url) {
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

    extractFragmentIfNeeded(response, url) {
        const jsonPointer = url.hash && url.hash.substring(1);
        if (jsonPointer && jp.has(response, jsonPointer)) {
            this.logger.debug(`Extracting fragment at ${jsonPointer}`);
            return jp.get(response, jsonPointer);
        } else if (jsonPointer) {
            throw new Error(`fragment ${jsonPointer} does not exist in JSON received from ${url}`);
        }
        return response;
    }

    validateAsJSON(obj) {
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

    async setContentInTemplate(response, jsonPtrIntoTemplate) {
        jp.set(this.output, jsonPtrIntoTemplate, response);
        await this.initialize(response, jsonPtrIntoTemplate);
    }

    async createMetaInfos(template, rootJsonPtr = []) {
        let metaInfos = await MetaInfoProducer.getMetaInfos(template);

        metaInfos = await Promise.all(metaInfos.map(async metaInfo => {
            metaInfo.jsonPointer__ = [...rootJsonPtr, ...metaInfo.jsonPointer__]; //templates can be rooted under other templates
            metaInfo.parentJsonPointer__ = metaInfo.jsonPointer__.slice(0, -1);
            const cdUpPath = metaInfo.exprRootPath__;
            if (cdUpPath) {
                const cdUpParts = cdUpPath.match(/\.\.\//g);
                if (cdUpParts) {
                    metaInfo.parentJsonPointer__ = metaInfo.parentJsonPointer__.slice(0, -cdUpParts.length);
                } else if (cdUpPath.match(/^\/$/g)) {
                    metaInfo.parentJsonPointer__ = [];
                } else {
                    throw new Error(`unexpected 'path' expression: ${cdUpPath}`);
                }
            }
            if (metaInfo.expr__ !== undefined) {
                try {
                    const depFinder = new DependencyFinder(metaInfo.expr__);
                    metaInfo.compiledExpr__ = depFinder.compiledExpression;
                    metaInfo.dependencies__ = depFinder.findDependencies(); //TemplateProcessor.getAncestors(depFinder.findDependencies()); //FIXME TODO
                }catch(e){
                    this.logger.error(`problem analysing expression at : ${jp.compile(metaInfo.jsonPointer__)}`);
                    throw(e);
                }
            }
            return metaInfo;
        }));

        return metaInfos;
    }

    //for deps [[a,b,c], [d,e,f]] we convert to [[a,b,c], [a,b], [a],[d,e,f], [d,e], [d]] thus producing all ancestors of a.b.c as well as a.b.c
    static getAncestors(deps) {  //
        return deps.map(d => d.map((_, index, self) => self.slice(0, index + 1))).flat(1).filter(d => d.length > 1 || !["", "$"].includes(d[0])); //the final filter is to remove dependencies on "" or $ (root)
    }


    sortMetaInfos(metaInfos) {
        metaInfos.sort((a, b) => a.jsonPointer__ < b.jsonPointer__ ? -1 : (a.jsonPointer__ > b.jsonPointer__ ? 1 : 0));
    }

    populateTemplateMeta(metaInfos) {
        metaInfos.forEach(meta => {
            const initialDependenciesPathParts = this.removeLeadingDollarsFromDependencies(meta);
            meta.absoluteDependencies__ = this.makeDepsAbsolute(meta.parentJsonPointer__, initialDependenciesPathParts);
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
    static compileToJsonPointer(meta) {
        meta.absoluteDependencies__ = [...new Set(meta.absoluteDependencies__.map(jp.compile))];
        meta.dependencies__ = meta.dependencies__.map(jp.compile);
        meta.parentJsonPointer__ = jp.compile(meta.parentJsonPointer__);
        meta.jsonPointer__ = jp.compile(meta.jsonPointer__);
    }

    setupDependees(metaInfos) {
        metaInfos.forEach(i => {
            i.absoluteDependencies__?.forEach(ptr => {
                if (!jp.has(this.templateMeta, ptr)) {
                    jp.set(this.templateMeta, ptr, {
                        "materialized__": false,
                        "jsonPointer__": ptr,
                        "dependees__": [],
                        "dependencies__": [],
                        "absoluteDependencies__": [],
                        "tags__": new Set()
                    });
                }
                const meta = jp.get(this.templateMeta, ptr);
                meta.dependees__?.push(i.jsonPointer__);
            });
        });
    }

    async evaluateDependencies(metaInfos) {
        const evaluationPlan = this.topologicalSort(metaInfos, true);//we want the execution plan to only be a list of nodes containing expressions (expr=true)
        return await this.evaluateJsonPointersInOrder(evaluationPlan);
    }

    makeDepsAbsolute(parentJsonPtr, localJsonPtrs) {
        return localJsonPtrs.map(localJsonPtr => { //both parentJsonPtr and localJsonPtr are like ["a", "b", "c"] (array of parts)
            return [...parentJsonPtr, ...localJsonPtr]
        })
    }

    removeLeadingDollarsFromDependencies(metaInfo) {
        // Extract dependencies__ and jsonPointer__ from metaInfo
        const {dependencies__,} = metaInfo;
        // Iterate through each depsArray in dependencies__ using reduce function
        dependencies__.forEach((depsArray) => {
            const root = depsArray[0];
            if (root === "" || root === "$") {
                depsArray.shift();
            }
        });
        return dependencies__;
    }

    propagateTags(metaInfos) {
        // Set of visited nodes to avoid infinite loops
        const visited = new Set();

        // Recursive function for DFS
        const dfs = (node)=> {
            if (node.jsonPointer__==undefined || visited.has(node.jsonPointer__)) return;
            visited.add(node.jsonPointer__);
            // Iterate through the node's dependencies
            node.absoluteDependencies__?.forEach(jsonPtr => {
                const dependency = jp.get(this.templateMeta, jsonPtr);
                // Recurse on the dependency first to ensure we collect all its tags
                dfs(dependency);
                // Propagate tags from the dependency to the node
                dependency.tags__?.forEach(tag => node.tags__.add(tag));
            });
        }

        // Start DFS from all nodes in metaInfos
        metaInfos.forEach(node => dfs(node));
    }

    removeTemporaryVariables(metaInfos){
        metaInfos.forEach(metaInfo=>{
            if(metaInfo.temp__){
                jp.remove(this.output, metaInfo.jsonPointer__);
            }
        })
    }


    topologicalSort(metaInfos, exprsOnly = true) {
        const visited = new Set();
        const recursionStack = new Set(); //for circular dependency detection
        const orderedJsonPointers = new Set();
        const templateMeta = this.templateMeta;

        //metaInfo gets arranged into a tree. The fields that end with "__" are part of the meta info about the
        //template. Fields that don't end in "__" are children of the given object in the template
        const processNode = (metaInfoNode) => {
            for (const childKey in metaInfoNode) {
                if (!childKey.endsWith("__")) { //ignore metadata fields
                    const child = metaInfoNode[childKey];
                    if (!visited.has(child.jsonPointer__)) {
                        listDependencies(child, exprsOnly);
                    }
                }
            }
        }
        const listDependencies = (metaInfo) => {
            if(metaInfo.jsonPointer__) {
                visited.add(metaInfo.jsonPointer__);
                recursionStack.add(metaInfo.jsonPointer__);
            }
            if (metaInfo.absoluteDependencies__) {
                for (const dependency of metaInfo.absoluteDependencies__) {
                    if (recursionStack.has(dependency)) {
                        const e = '🔃 Circular dependency  ' + Array.from(recursionStack).join(' → ') + " → " + dependency;
                        this.warnings.push(e);
                        this.logger.log('warn', e);
                    }
                    if (!visited.has(dependency)) {
                        const dependencyNode = jp.get(templateMeta, dependency);
                        if (dependencyNode.materialized__ === false) { // a node such as ex10.json's totalCount[0] won't be materialized until it's would-be parent node has run it's expression
                            const ancestor = this.searchUpForExpression(dependencyNode);
                            //if (ancestor && !visited.has(ancestor.jsonPointer__)) {
                            if (ancestor) {
                                //orderedJsonPointers.add(ancestor.jsonPointer__); //we cannot listDependencies of these "virtual" ancestor dependencies as that creates circular dependencies as it would in ex10
                                listDependencies(ancestor, exprsOnly);
                            }
                        }
                        listDependencies(dependencyNode, exprsOnly);
                    }
                }
            }

            // when we are forming the topological order for the 'plan' command, we don't need to include
            // nodes in the execution plan that don't have expressions. On the other hand, when we are forming
            // the topological order to see all the nodes that are dependencies of a particular target node, which
            // is what the 'to' command does in the repl, then we DO want to see dependencies that are constants/
            // literals that don't have expressions
            if (metaInfo.jsonPointer__ && (!exprsOnly || (exprsOnly && metaInfo.expr__))) {
                orderedJsonPointers.add(metaInfo.jsonPointer__);
            }
            processNode(metaInfo);

            if(metaInfo.jsonPointer__){
                recursionStack.delete(metaInfo.jsonPointer__);
            } // Clean up after finishing with this node
        }

        if (!(metaInfos instanceof Set || Array.isArray(metaInfos))) {
            metaInfos = [metaInfos];
        }
        // Perform topological sort
        metaInfos.forEach(node => {
            if (!visited.has(node.jsonPointer__)) {
                listDependencies(node, exprsOnly);
            }
        });

        return [...orderedJsonPointers];
    }


    async setData(jsonPtr, data) {
        //get all the jsonPtrs we need to update, including this one, to percolate the change
        const sortedJsonPtrs = [...this.getDependentsTransitiveExecutionPlan(jsonPtr)]; //defensive copy
        return await this.evaluateJsonPointersInOrder(sortedJsonPtrs, data); // Evaluate all affected nodes, in optimal evaluation order
    }


    async evaluateJsonPointersInOrder(jsonPtrList, data = TemplateProcessor.NOOP) {
        const resp = [];
        let first;
        if (data !== TemplateProcessor.NOOP) {
            first = jsonPtrList.shift(); //first jsonPtr is the target of the change, the rest are dependents
            if (!jp.has(this.output, first)) { //node doesn't exist yet, so just create it
                const didUpdate = await this.evaluateNode(first, data);
                jp.get(this.templateMeta, first).didUpdate__ = didUpdate;
            } else {
                // Check if the node contains an expression. If so, print a warning and return.
                const firstMeta = jp.get(this.templateMeta, first);
                if (firstMeta.expr__ !== undefined) {
                    this.logger.log('warn', `Attempted to replace expressions with data under ${first}. This operation is ignored.`);
                    return false;
                }
                firstMeta.didUpdate__ = await this.evaluateNode(first, data); // Evaluate the node provided with the data provided
                if (!firstMeta.didUpdate__) {
                    this.logger.verbose(`data did not change for ${first}, short circuiting dependents.`);
                    return false;
                }
            }
        }
        for (const jsonPtr of jsonPtrList) {
            const didUpdate = await this.evaluateNode(jsonPtr);
            jp.get(this.templateMeta, jsonPtr).didUpdate__ = didUpdate;
        }
        first && jsonPtrList.unshift(first);
        return jsonPtrList.filter(jptr => {
            const meta = jp.get(this.templateMeta, jptr);
            return meta.didUpdate__
        });
    }

    async evaluateNode(jsonPtr, data) {
        const {output, templateMeta} = this;

        //an untracked json pointer is one that we have no metadata about. It's just a request out of the blue to
        //set /foo when /foo does not exist yet
        const isUntracked = !jp.has(templateMeta, jsonPtr);
        if (isUntracked) {
            return this.setUntrackedLocation(output, jsonPtr, data);
        }

        const hasDataToSet = data !== undefined && data !== TemplateProcessor.NOOP;
        if (hasDataToSet) {
            return this.setDataIntoTrackedLocation(templateMeta, jsonPtr, data);
        }

        return this._evaluateExpression(jsonPtr);

    }

    async _evaluateExpression(jsonPtr) {
        const startTime = Date.now(); // Capture start time

        const {templateMeta, output} = this;
        let data;
        const metaInfo = jp.get(templateMeta, jsonPtr);
        const {expr__, tags__, callback__} = metaInfo;
        let success = false;
        if (expr__ !== undefined) {
            if(this.allTagsPresent(tags__)) {
                try {
                    this._strictChecks(metaInfo);
                    data = await this._evaluateExprNode(jsonPtr); //run the jsonata expression
                    success = true;
                }catch(error){
                    const errorObject = {name:error.name, message: error.message}
                    data = {error:errorObject}; //errors get placed into the template output
                    this.errorReport[jsonPtr] = errorObject;
                }
                this._setData(jsonPtr, data, callback__);
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

    _strictChecks(metaInfo) {
        const {strict} = this.options;
        if (strict?.refs) {
            metaInfo.absoluteDependencies__?.forEach(ptr => {
                if (jp.get(this.templateMeta, ptr).materialized__ === false) {
                    const msg = `${ptr} does not exist, referenced from ${metaInfo.jsonPointer__} (strict.refs option enabled)`;
                    this.logger.error(msg);
                    const error = new Error(msg);
                    error.name = "strict.refs"
                    throw error;
                }
            });
        }
    }

    setDataIntoTrackedLocation(templateMeta, jsonPtr, data) {
        const {treeHasExpressions__, callback__} = jp.get(templateMeta, jsonPtr);
        if (treeHasExpressions__) {
            this.logger.log('warn', `nodes containing expressions cannot be overwritten: ${jsonPtr}`);
            return false;
        }
        let didSet = this._setData(jsonPtr, data, callback__);
        if (didSet) {
            jp.set(templateMeta, jsonPtr + "/data__", data); //saving the data__ in the templateMeta is just for debugging
            jp.set(templateMeta, jsonPtr + "/materialized__", true);
        }
        return didSet; //true means that the data was new/fresh/changed and that subsequent updates must be propagated
    }

    setUntrackedLocation(output, jsonPtr, data) {
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
        return true;
    }

    async _evaluateExprNode(jsonPtr) {
        let evaluated;
        const {compiledExpr__, callback__, parentJsonPointer__, jsonPointer__, expr__} = jp.get(this.templateMeta, jsonPtr);
        let target;
        try {
            target = jp.get(this.output, parentJsonPointer__); //an expression is always relative to a target
            const safe =  this.withErrorHandling.bind(this);
            evaluated = await compiledExpr__.evaluate(
                target,
                merge(this.context, {"import": safe(this.getImport(jsonPointer__))}));
        } catch (error) {
            this.logger.error(`Error evaluating expression at ${jsonPtr}`);
            this.logger.error(error);
            this.logger.debug(`Expression: ${expr__}`);
            this.logger.debug(`Target: ${StatedREPL.stringify(target)}`);
            this.logger.debug(`Result: ${StatedREPL.stringify(evaluated)}`);
            const _error = new Error(error.message);
            _error.name = "JSONata evaluation exception";
            throw _error;
        }
        return evaluated;
    }

    allTagsPresent(tagSetOnTheExpression) {
        if(tagSetOnTheExpression.size === 0 && this.tagSet.size > 0){
            return false;
        }
        return Array.from(tagSetOnTheExpression).every(tag => this.tagSet.has(tag));
    }

    _setData(jsonPtr, data, callback) {
        if (data === TemplateProcessor.NOOP) { //a No-Op is used as the return from 'import' where we don't actually need to make the assignment as init has already dont it
            return false;
        }
        const {output} = this;
        let existingData;
        if (jp.has(output, jsonPtr)) {
            existingData = jp.get(output, jsonPtr);
        }
        if (!isEqual(existingData, data)) {
            jp.set(output, jsonPtr, data);
            callback && callback(data, jsonPtr);
            this.commonCallback && this.commonCallback(data, jsonPtr); //called if callback set on "/"
            return true;
        } else {
            this.logger.verbose(`data to be set at ${jsonPtr} did not change, ignored. `);
            return false;
        }

    }

    getDependentsTransitiveExecutionPlan(jsonPtr) {
        //check execution plan cache
        if (this.executionPlans[jsonPtr] === undefined) {
            const effectedNodesSet = this.getDependentsBFS(jsonPtr);
            this.executionPlans[jsonPtr] = [jsonPtr, ...[...effectedNodesSet].map(n => n.jsonPointer__)];
        }
        return this.executionPlans[jsonPtr];
    }

    getDependents(jsonPtr) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            return jp.get(this.templateMeta, jsonPtr).dependees__
        } else {
            return [];
        }
    }

    getDependentsBFS(jsonPtr) {
        if (!jp.has(this.templateMeta, jsonPtr)) {
            this.logger.log('warn', `${jsonPtr} does not exist.`);
            return [];
        }

        const dependents = [];
        const queue = [jsonPtr];
        const visited = new Set();

        while (queue.length > 0) {
            const currentPtr = queue.shift();
            visited.add(currentPtr);

            const metaInf = jp.get(this.templateMeta, currentPtr);

            if (metaInf.dependees__) {
                metaInf.dependees__.forEach(dependee => {
                    if (!visited.has(dependee)) {
                        dependents.push(jp.get(this.templateMeta, dependee));
                        queue.push(dependee);
                        visited.add(dependee);
                    }
                });
            }

            // Recursively traverse into children nodes.
            for (let key in metaInf) {
                // Skip fields that end in "__" and non-object children
                if (key.endsWith('__') || typeof metaInf[key] !== 'object') {
                    continue;
                }
                // Generate json pointer for child
                let childPtr = `${currentPtr}/${key}`;
                if (!visited.has(childPtr)) {
                    queue.push(childPtr);
                    visited.add(childPtr);
                }
            }
        }

        return dependents;
    }


    getDependencies(jsonPtr) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            return jp.get(this.templateMeta, jsonPtr).dependencies__
        }
        return [];

    }

    //this is the .to repl
    getDependenciesTransitiveExecutionPlan(jsonPtr) {
        if (jp.has(this.templateMeta, jsonPtr)) {
            const node = jp.get(this.templateMeta, jsonPtr);
            return this.topologicalSort(node, false); //for the repl "to" command we want to see all the dependencies, not just expressions (so exprsOnly=false)
        }
        return [];
    }

    setDataChangeCallback(jsonPtr, cbFn) {
        if(jsonPtr === "/"){
            this.commonCallback = cbFn;
        }else if (jp.has(this.templateMeta, jsonPtr)) {
            const node = jp.get(this.templateMeta, jsonPtr);
            node.callback__ = cbFn;
        }
    }

    //returns the evaluation plan for evaluating the entire template
    async getEvaluationPlan() {
        return this.topologicalSort(this.metaInfoByJsonPointer["/"], true);
    }

    searchUpForExpression(childNode) {
        let pathParts = jp.parse(childNode.jsonPointer__);
        while (pathParts.length > 1) {
            pathParts = pathParts.slice(0, -1); //get the parent expression
            const jsonPtr = jp.compile(pathParts);
            const ancestorNode = jp.get(this.templateMeta, jsonPtr);
            if (ancestorNode.materialized__ === true) {
                return ancestorNode;
            }
        }
        //this.logger.info(`No parent or ancestor of '${childNode.jsonPointer__}'`);
        return undefined;

    }

    //when importing a template we must only evaluate expressions in the enclosing root template
    //that have dependencies to something inside the target template. Otherwise we will get looping
    //where the expression in the enclosing root template that performs the import gets re-evaluated
    //upon import
    static dependsOnImportedTemplate(metaInfos, importPathJsonPtr) {
        return metaInfos.filter(metaInof => metaInof.absoluteDependencies__.some(dep => dep.startsWith(importPathJsonPtr)));
    }

    out(jsonPointer){
        if(jp.has(this.output, jsonPointer)){
            return jp.get(this.output, jsonPointer)
        };
        return null;
    }

    async localImport(filePathInPackage) {
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

}

