import { ParallelExecutionPlan } from "../ParallelExecutionPlan.js";
import TemplateProcessor from "../TemplateProcessor.js";

export class TraversalStack {
    private stack: ParallelExecutionPlan[] = [];
    private tp: TemplateProcessor;

    constructor(tp: TemplateProcessor) {
        this.tp = tp;
    }

    push(node: ParallelExecutionPlan): boolean {
        const { jsonPtr, op } = node;
        
        if (this.hasCircularDependency(node)) {
            this.logCircularDependency(node);
            return false;
        }

        if (this.isClosedByNoop()) {
            throw new Error(`attempt to push ${jsonPtr} onto traversal path that is already closed by a noop`);
        }

        this.stack.push(node);
        return true;
    }

    pop(): ParallelExecutionPlan | undefined {
        return this.stack.pop();
    }

    private hasCircularDependency(node: ParallelExecutionPlan): boolean {
        const { jsonPtr, op } = node;
        return op !== "noop" && this.stack.map(n => n.jsonPtr).includes(jsonPtr);
    }

    private isClosedByNoop(): boolean {
        return this.stack[this.stack.length - 1]?.op === "noop";
    }

    private logCircularDependency(node: ParallelExecutionPlan): void {
        const e = '🔃 Circular dependency  ' + this.stack.map(n => n.jsonPtr).join(' → ') + " → " + node.jsonPtr;
        this.tp.warnings.push(e);
        this.tp.logger.log('warn', e);
    }

    getStack(): ParallelExecutionPlan[] {
        return this.stack;
    }
} 