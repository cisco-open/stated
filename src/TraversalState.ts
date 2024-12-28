import JsonPointer from "./JsonPointer.js";
import { JsonPointerString } from "./MetaInfoProducer.js";
import { ParallelExecutionPlan } from "./ParallelExecutionPlan.js";
import TemplateProcessor from "./TemplateProcessor.js";

export class TraversalState {
    visited = new Set();
    recursionStack: Set<JsonPointerString> = new Set(); //for circular dependency detection
    stack: ParallelExecutionPlan[] = [];
    options: { exprsOnly: boolean; } = { exprsOnly: true };
    tp: TemplateProcessor;

    constructor(tp: TemplateProcessor, options: { exprsOnly: boolean; }) {
        this.options = options;
        this.tp = tp;
    }

    pushNode(node: ParallelExecutionPlan): boolean {
        const { jsonPtr, op } = node;
        if (op !== "noop" && this.stack.map(n => n.jsonPtr).includes(jsonPtr)) { //noop's are the end of a traversal chain and in the case of a mutation will be the same jsonPtr as the initial mutation, so not circular. But any other offender is circular
            const e = '🔃 Circular dependency  ' + this.stack.map(n => n.jsonPtr).join(' → ') + " → " + jsonPtr;
            this.tp.warnings.push(e);
            this.tp.logger.log('warn', e);
            return false;
        }
        if (this.stack[this.stack.length - 1]?.op === "noop") {
            throw new Error(`attempt to push ${jsonPtr} onto traversal path that is already closed by a noop`);
        }
        this.stack.push(node);
        return true;
    }

    popNode() {
        this.stack.pop();
    }

    isCircular(dependency: JsonPointerString, owner: JsonPointerString) {
        return this.recursionStack.has(dependency as JsonPointerString)
            || this.isCommonPrefix(owner as JsonPointerString, dependency as JsonPointerString);
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
    private isCommonPrefix(exprNode: JsonPointerString, dependency: JsonPointerString): boolean {
        return JsonPointer.isAncestor(dependency, exprNode);
    }

    logCircular(dependency: JsonPointerString) {
        const e = '🔃 Circular dependency  ' + Array.from(this.visited).join(' → ') + " → " + dependency;
        this.tp.warnings.push(e);
        this.tp.logger.log('warn', e);
    }
}
