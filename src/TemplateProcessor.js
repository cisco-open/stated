/*
  Copyright 2023, Cisco Systems, Inc
 */
const jsonata = require('jsonata');
const jp = require('json-pointer');
const _ = require('lodash');
const metaInfoProducer = require('./MetaInfoProducer');
const DependencyFinder=require('./DependencyFinder');
const winston = require('winston');

class TemplateProcessor {
    constructor(template, context = {}) {
        this.setData = this.setData.bind(this); // Bind template-accessible functions like setData and import
        this.import = this.import.bind(this);
        this.context = _.merge(context, {
            "set": this.setData,
            "fetch":fetch,
            "setInterval":setInterval,
            "clearInterval":clearInterval,
            "setTimeout":setTimeout,
            "console":console
        });
        this.logger = this.getLogger();
        this.output = template; //initial output is input template
        this.input = JSON.parse(JSON.stringify(template));
        this.templateMeta = JSON.parse(JSON.stringify(this.output));// Copy the given template to initialize the templateMeta
        this.errors = [];
        this.metaInfoByJsonPointer = {};
        this.logger = this.getLogger();
    }

    getLogger() {
        return winston.createLogger({
            format: winston.format.json(),
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                })
            ],
        });
    }

    async initialize(template = this.input, jsonPtr="/") {
        this.executionPlans = {}; //clear execution plans
        let parsedJsonPtr = jp.parse(jsonPtr);
        parsedJsonPtr = _.isEqual(parsedJsonPtr,[""])?[]:parsedJsonPtr; //correct [""] to []
        let metaInfos = await this.createMetaInfos(template, parsedJsonPtr);
        this.metaInfoByJsonPointer[jsonPtr] = metaInfos; //dictionary for template meta info, by import path (jsonPtr)
        this.sortMetaInfos(metaInfos);
        this.populateTemplateMeta(metaInfos);
        this.setupDependees(metaInfos); //dependency <-> dependee is now bidirectional
        await this.evaluate(jsonPtr);
    }


    async evaluate(jsonPtr) {
        await this.evaluateDependencies(this.metaInfoByJsonPointer[jsonPtr]);
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

    static async load(template, context={}){
        const t = new TemplateProcessor(template, context);
        await t.initialize();
        return t;
    }

    import(template, jsonPtrImportPath){
        return this.getImport(undefined)(template, jsonPtrImportPath);
    }

    static NOOP =  Symbol('NOOP');

    getImport(defaultPath) {
        //import the template to the location pointed to by jsonPtr
        return async (templateOrUrl, jsonPtrImportPath)=>
        {
            try {
                new URL(templateOrUrl);
                const res  = await fetch(templateOrUrl);
                templateOrUrl = await (res.ok ? res.json():res.statusText);
            } catch (_) {
                //no-op ...it's not a URL...it must be a literal template
            }
            if (!jsonPtrImportPath) {
                jsonPtrImportPath = defaultPath;
            }
            jp.set(this.output, jsonPtrImportPath, templateOrUrl);
            await this.initialize(templateOrUrl, jsonPtrImportPath);
            return TemplateProcessor.NOOP; //import returns No-Op because import assigns content to jsonPointer as a side effect
        }
    }

    async createMetaInfos(template, rootJsonPtr=[]) {
        const metaInfProcessor = jsonata(metaInfoProducer);
        let metaInfos = await metaInfProcessor.evaluate(template, {"console":console});

        metaInfos = await Promise.all(metaInfos.map(async metaInfo => {
            metaInfo.jsonPointer__ = [...rootJsonPtr, ...metaInfo.jsonPointer__]; //templates can be rooted under other templates
            metaInfo.parentJsonPointer__ = metaInfo.jsonPointer__.slice(0, -1);
            const cdUpPath = metaInfo.exprRootPath__;
            if(cdUpPath) {
                const cdUpParts = cdUpPath.match(/\.\.\//g);
                if(cdUpParts) {
                    metaInfo.parentJsonPointer__ = metaInfo.parentJsonPointer__.slice(0, -cdUpParts.length);
                }else if(cdUpPath.match(/^\/$/g)){
                    metaInfo.parentJsonPointer__ = [];
                }else{
                    throw new Error(`unexpected 'path' expression: ${cdUpPath}`);
                }
            }
            if (metaInfo.expr__ !== undefined) {
                const depFinder = new DependencyFinder(metaInfo.expr__, metaInfo);
                metaInfo.compiledExpr__  = depFinder.compiledExpression;
                metaInfo.dependencies__ = depFinder.findDependencies(); //TemplateProcessor.getAncestors(depFinder.findDependencies()); //FIXME TODO
            }
            return metaInfo;
        }));

        return metaInfos;
    }

    //for deps [[a,b,c], [d,e,f]] we convert to [[a,b,c], [a,b], [a],[d,e,f], [d,e], [d]] thus producing all ancestors of a.b.c as well as a.b.c
    static getAncestors(deps){  //
      return deps.map(d=> d.map((_, index, self) => self.slice(0, index + 1))).flat(1).filter(d=> d.length>1 || !["", "$"].includes(d[0])); //the final filter is to remove dependencies on "" or $ (root)
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
            if(meta.jsonPointer__.length > 0 ){
                //if we are here then the templateMetaData can be set to the meta we just populated
                jp.set(this.templateMeta, meta.jsonPointer__, meta);
            }
            TemplateProcessor.compileToJsonPointer(meta);
        });
    }

    //mutates all the pieces of metaInf that are path parts and turns them into JSON Pointer syntax
    static compileToJsonPointer(meta){
        meta.absoluteDependencies__ = meta.absoluteDependencies__.map(jp.compile);
        meta.dependencies__ = meta.dependencies__.map(jp.compile);
        meta.parentJsonPointer__ = jp.compile(meta.parentJsonPointer__);
        meta.jsonPointer__ = jp.compile(meta.jsonPointer__);
    }

    setupDependees(metaInfos) {
        metaInfos.forEach(i => {
            i.absoluteDependencies__?.forEach(ptr => {
                if (!jp.has(this.templateMeta, ptr)) {
                    jp.set(this.templateMeta, ptr, { "materialized__":false, "jsonPointer__": ptr, "dependees__": [], "dependencies__": [], "absoluteDependencies__": [] });
                }
                jp.get(this.templateMeta, ptr).dependees__?.push(i.jsonPointer__);
            });
        });
    }

    async evaluateDependencies(metaInfos) {
        const evaluationPlan = this.topologicalSort(metaInfos, true);//we want the execution plan to only be a list of nodes containing expressions (expr=true)
        return await this.evaluateJsonPointersInOrder(evaluationPlan);
    }

    makeDepsAbsolute(parentJsonPtr, localJsonPtrs){
        return localJsonPtrs.map(localJsonPtr =>{ //both parentJsonPtr and localJsonPtr are like ["a", "b", "c"] (array of parts)
            return [...parentJsonPtr, ...localJsonPtr]
        })
    }

    removeLeadingDollarsFromDependencies(metaInfo) {
        // Extract dependencies__ and jsonPointer__ from metaInfo
        const { dependencies__, } = metaInfo;
        // Iterate through each depsArray in dependencies__ using reduce function
        dependencies__.forEach((depsArray) => {
            const root = depsArray[0];
            if(root === "" || root === "$"){
                depsArray.shift();
            }
        });
        return dependencies__;
    }

    topologicalSort(nodes, exprsOnly=true) {
        const visited = new Set();
        const recursionStack = new Set(); //for circular dependency detection
        const orderedJsonPointers = new Set();
        const templateMeta = this.templateMeta;

        const processNode = (node) => {
            for (const childKey in node) {
                if (!childKey.endsWith("__")) { //ignore metadata fields
                    const child = node[childKey];
                    if (!visited.has(child.jsonPointer__)) {
                        listDependencies(child, exprsOnly);
                    }
                }
            }
        }
        const listDependencies = (node) => {
            visited.add(node.jsonPointer__);
            recursionStack.add(node.jsonPointer__);

            if (node.absoluteDependencies__){
                for (const dependency of node.absoluteDependencies__) {
                    if (recursionStack.has(dependency)) {
                        const e = '🔃 Circular dependency  ' + Array.from(recursionStack).join(' → ')+ " → "+ dependency;
                        this.errors.push(e);
                        this.logger.log('warn', e);
                    } else if (!visited.has(dependency)) {
                        const dependencyNode = jp.get(templateMeta, dependency);
                        if (dependencyNode.materialized__ === false) { // a node such as ex10.json's totalCount[0] won't be materialized until it's would-be parent node has run it's expression
                            const ancestor = this.searchUpForExpression(dependencyNode);
                            //if (ancestor && !visited.has(ancestor.jsonPointer__)) {
                            if(ancestor){
                                //orderedJsonPointers.add(ancestor.jsonPointer__); //we cannot listDependencies of these "virtual" ancestor dependencies as that creates circular depedencies as it would in ex10
                                listDependencies(ancestor, exprsOnly);
                            }
                        } else {
                            listDependencies(dependencyNode, exprsOnly);
                        }
                    }
                }
            }

            // when we are forming the topological order for the 'plan' command, we don't need to include
            // nodes in the execution plan that don't have expressions. On the other hand, when we are forming
            // the topological order to see all the nodes that are dependencies of a particular target node, which
            // is what the 'to' command does in the repl, then we DO want to see dependencies that are constants/
            // literals that don't have expressions
            if (!exprsOnly || (exprsOnly && node.expr__)) {
                orderedJsonPointers.add(node.jsonPointer__);
            }
            processNode(node);

            recursionStack.delete(node.jsonPointer__); // Clean up after finishing with this node
        }

        if(!(nodes instanceof Set || Array.isArray(nodes))){
            nodes = [nodes];
        }
        // Perform topological sort
        nodes.forEach(node => {
            if (!visited.has(node.jsonPointer__)) {
                listDependencies(node, exprsOnly);
            }
        });

        return [...orderedJsonPointers];
    }



    async setData(jsonPtr, data) {
        //get all the jsonPtrs we need to update, including this one, to percolate the change
        const sortedJsonPtrs = this.getDependentsTransitiveExecutionPlan(jsonPtr);
        return await this.evaluateJsonPointersInOrder(sortedJsonPtrs, data); // Evaluate all affected nodes, in optimal evaluation order
    }

    async evaluateJsonPointersInOrder(jsonPtrList, data) {
        const resp = [];
        let first;
        if(data) {
            first = jsonPtrList.shift(); //first jsonPtr is the target of the change, the rest are dependents
            if (!jp.has(this.output, first)) { //node doesn't exist yet, so just create it
                const didUpdate= await this.evaluateNode(first, data);
                jp.get(this.templateMeta, first).didUpdate__ = didUpdate;
            }else {
                // Check if the node contains an expression. If so, print a warning and return.
                const firstMeta = jp.get(this.templateMeta, first);
                if (firstMeta.expr__ !== undefined) {
                    this.logger.log('warn',`Attempted to replace expressions with data under ${first}. This operation is ignored.`);
                    return false;
                }
                firstMeta.didUpdate__  = await this.evaluateNode(first, data); // Evaluate the node provided with the data provided
                if (!firstMeta.didUpdate__) {
                    this.logger.log('info', `data did not change for ${first}, short circuiting dependents.`);
                    return false;
                }
            }
        }
        for (const jsonPtr of jsonPtrList) {
            try {
                const didUpdate = await this.evaluateNode(jsonPtr);
                jp.get(this.templateMeta, jsonPtr).didUpdate__ = didUpdate;
            } catch (e) {
                this.logger.log('error', `An error occurred while evaluating dependencies for ${jsonPtr}`);
            }
        }
        first && jsonPtrList.unshift(first);
        return jsonPtrList.filter(jptr=>{
            const meta = jp.get(this.templateMeta, jptr);
            return meta.didUpdate__
        });
    }

    async evaluateNode(jsonPtr, data) {
        const {output, templateMeta} = this;

        //an untracked json pointer is one that we have no metadata about. It's just a request out of the blue to
        //set /foo when /foo does not exist yey
        const isUntracked = !jp.has(templateMeta, jsonPtr);
        if (isUntracked) {
            return this.setUntrackedLocation(output, jsonPtr, data);
        }

        const hasDataToSet = data !== undefined;
        if(hasDataToSet){
            return this.setDataIntoTrackedLocation(templateMeta, jsonPtr, data);
        }

        return this._evaluateExpression(jsonPtr);

    }

    async _evaluateExpression(jsonPtr){
        const {templateMeta, output} = this;
        let data;
        const { expr__} = jp.get(templateMeta, jsonPtr);
        if (expr__ !== undefined) {
            data = await this._evaluateExprNode(jsonPtr);
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
        return true; //true means that the data was new/fresh/changed and that subsequent updates must be propagated
    }

    setDataIntoTrackedLocation(templateMeta, jsonPtr, data) {
        const {treeHasExpressions__, callback__} = jp.get(templateMeta, jsonPtr);
        if (treeHasExpressions__) {
            this.logger.log('warn',`nodes containing expressions cannot be overwritten: ${jsonPtr}`);
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

    async _evaluateExprNode(jsonPtr){
        let evaluated;
        try {
            const { compiledExpr__, callback__ , parentJsonPointer__, jsonPointer__} = jp.get(this.templateMeta, jsonPtr);
            const target = jp.get(this.output, parentJsonPointer__); //an expression is always relative to a target
            evaluated = await compiledExpr__.evaluate(
                target,
                _.merge(this.context, {"import":this.getImport(jsonPointer__)}));
            this._setData(jsonPtr, evaluated, callback__);
        } catch (error) {
            this.logger.log('error', `Error evaluating expression at ${jsonPtr}`);
        }
        return evaluated; //can be undefined if error evaluating expression
    }

    _setData(jsonPtr, data, callback){
        if(data === TemplateProcessor.NOOP){ //a No-Op is used as the return from 'import' where we don't actually need to make the assignment as init has already dont it
            return false;
        }
        const {output} = this;
        let existingData;
        if(jp.has(output, jsonPtr)){
            existingData = jp.get(output, jsonPtr);
        }
        if(!_.isEqual(existingData, data)){
            jp.set(output, jsonPtr, data);
            callback && callback(data, jsonPtr);
            return true;
        }else{
            this.logger.log('info', `data to be set at ${jsonPtr} did not change, ignored. `);
            return false;
        }

    }

    getDependentsTransitiveExecutionPlan(jsonPtr) {
        //check execution plan cache
        if(! this.executionPlans[jsonPtr]) {
            const effectedNodesSet = this.getDependentsBFS(jsonPtr);
            this.executionPlans[jsonPtr] = [jsonPtr, ...[...effectedNodesSet].map(n => n.jsonPointer__)];
        }
        return this.executionPlans[jsonPtr];
    }

    getDependents(jsonPtr){
        if(jp.has(this.templateMeta, jsonPtr)){
            return jp.get(this.templateMeta, jsonPtr).dependees__
        }else{
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


    getDependencies(jsonPtr){
        if(jp.has(this.templateMeta, jsonPtr)){
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

    setDataChangeCallback(jsonPtr, cbFn){
        if (jp.has(this.templateMeta, jsonPtr)) {
            const node = jp.get(this.templateMeta, jsonPtr);
            node.callback__ = cbFn;
        }
    }
    //returns the evaluation plan for evaluating the entire template
    async getEvaluationPlan(){
        return this.topologicalSort(this.metaInfoByJsonPointer["/"], true);
    }

    searchUpForExpression(childNode){
        let pathParts = jp.parse(childNode.jsonPointer__);
        while(pathParts.length > 1){
            pathParts = pathParts.slice(0,-1); //get the parent expression
            const jsonPtr = jp.compile(pathParts);
            const ancestorNode = jp.get(this.templateMeta, jsonPtr);
            if(ancestorNode.materialized__ === true){
                return ancestorNode;
            }
        }
        this.logger.log("info", `No parent or ancestor of '${childNode.jsonPointer__}'`);
        return undefined;

    }
    //when importing a template we must only evaluate expressions in the enclosing root template
    //that have dependencies to something inside the target template. Otherwise we will get looping
    //where the expression in the enclosing root template that performs the import gets re-evaluated
    //upon import
    static dependsOnImportedTemplate(metaInfos, importPathJsonPtr){
        return metaInfos.filter(metaInof=>metaInof.absoluteDependencies__.some(dep=>dep.startsWith(importPathJsonPtr)));
    }

}

module.exports = TemplateProcessor;
