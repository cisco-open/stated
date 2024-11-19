import {JsonPointerString, MetaInfo} from "./MetaInfoProducer.js";
import TemplateProcessor from "./TemplateProcessor.js";
import {default as jp} from "./JsonPointer.js";
import {JsonPointer} from "./index.js";
//type TreeNode = {metaInfo:MetaInfo, dependees:TreeNode[]};

/**
 * Represents a node in a data flow structure.
 * A DataFlowNode can either be a JsonPointerString or an object with a location
 * and an optional 'to' field which points to one or more subsequent DataFlowNodes or a JsonPointerString.
 *
 * @typedef {Object} DataFlowNode
 * @property {JsonPointerString} location - The location of the data in a JSON structure.
 * @property {DataFlowNode[]|DataFlowNode|JsonPointerString} [to] - Optional field that indicates the next node or nodes in the data flow.
 *
 * @typedef {string} JsonPointerString - A string that represents a JSON Pointer.
 */
export type DataFlowNode = {
    location:JsonPointerString,
    to?:DataFlowNode[]|DataFlowNode|JsonPointerString
} | JsonPointerString

export type FlowOpt = 0|1;


/**
 * Class representing a DataFlow, managing dependencies and data flow nodes.
 */
export class DataFlow {
    private templateProcessor: TemplateProcessor;
    private visited:Map<MetaInfo, DataFlowNode>;
    private roots:Set<DataFlowNode>;

    constructor(templateProcessor: TemplateProcessor) {
        this.visited = new Map<MetaInfo, DataFlowNode>();
        this.roots = new Set<DataFlowNode>();
        this.templateProcessor = templateProcessor;
    }

    /**
     * Links the given metaInfo node with its dependees, creating and returning a new DataFlowNode.
     *
     * @param {MetaInfo} metaInfo - The metadata information object containing dependencies and location data.
     * @return {DataFlowNode} - The created DataFlowNode with linked dependees.
     */
    private linkDependees(metaInfo: MetaInfo): DataFlowNode {
        let n:any = this.visited.get(metaInfo);
        if(n){
            return n;
        }
        const {absoluteDependencies__:deps, jsonPointer__:location} = metaInfo;
        n = {location, to:[]};
        this.visited.set(metaInfo, n);
        for (const jsonPtr of metaInfo.dependees__) {
            const dependeeMeta: MetaInfo = jp.get(this.templateProcessor.templateMeta, jsonPtr) as MetaInfo;
            const dependeeTreeNode = this.linkDependees(dependeeMeta);
            const dependees = n.to;
            dependees.push(dependeeTreeNode);
        }

        //a root has no dependencies and at least one dependee (todo: degenerate case of expression like ${42} that has np dependencies)
        if(metaInfo.absoluteDependencies__.length === 0 && metaInfo.dependees__.length > 0){
            this.roots.add(n);
        }

        return n;
    }


    /**
     * Recursively compacts the given DataFlowNode, reducing the 'to' field to a single object
     * if there is only one child node, or omitting it if there are no child nodes.
     *
     * @param {DataFlowNode} node - The node to compact. This node may have a 'to' field
     * that is an array of child nodes.
     * @return {DataFlowNode} The compacted node, which may have a simplified 'to' field or none at all.
     */
    private level1Compact(node:DataFlowNode):DataFlowNode {
        const kids = (node as any).to? (node as any).to as DataFlowNode[]:[];
        const compactKids = kids.map((kid) => this.level1Compact(kid));
        const noKids = compactKids.length === 0;
        const oneKid = compactKids.length === 1;
        let compactNode;
        let location: JsonPointerString;
        if (typeof node === "string"){
            location = node as JsonPointerString;
        }else{
            location = node.location;
        }
        if(noKids){
            compactNode = location; //no 'to' at all, just a raw location
        }else if (oneKid) {
            const onlyKid = compactKids[0];
            compactNode = {location, to: onlyKid}; //'to' is just a single thing, not an array
        }else{
            compactNode = {location, to:compactKids}
        }
        return compactNode as DataFlowNode;

    }

    /**
     * Retrieves the roots of the data flow nodes based on the specified option.
     *
     * @param {string} level - The option for retrieving roots, it can be either "l0" or "l1".
     *                       "l0" returns the roots as they are.
     *                       "l1" returns the roots in a compacted form.
     * @return {DataFlowNode[]} - An array of data flow node roots.
     * @throws {Error} - Throws an error if the specified option is unknown.
     */
    getRoots(level:FlowOpt=0):DataFlowNode[] {
        this.visited = new Map<MetaInfo, DataFlowNode>();
        this.roots = new Set<DataFlowNode>();
        const metas = this.templateProcessor.metaInfoByJsonPointer["/"];
        for (const m of metas) {
            if(m.jsonPointer__ !== "") { //skip root json pointer
                this.linkDependees(m);
            }
        }
        if(level===0){
            return Array.from(this.roots);
        }else if (level===1){
            return Array.from(this.roots).map(root=>this.level1Compact(root));
        }else{
            throw new Error(`Unknown option ${level}`);
        }

    }
}
