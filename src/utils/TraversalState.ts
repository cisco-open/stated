import TemplateProcessor from "../TemplateProcessor.js";
import { ParallelExecutionPlan } from "../ParallelExecutionPlan.js";
import { CircularDependencyChecker } from "./CircularDependencyChecker.js";
import { TraversalStack } from "./TraversalStack.js";
import { JsonPointerString } from "../MetaInfoProducer.js";

export class TraversalState {
    visited = new Set<JsonPointerString>();
    recursionStack: Set<JsonPointerString> = new Set();
    options: { exprsOnly: boolean } = { exprsOnly: true };
    tp: TemplateProcessor;
    
    private stack: TraversalStack;
    private circularChecker: CircularDependencyChecker;

    constructor(tp: TemplateProcessor, options: { exprsOnly: boolean }) {
        this.options = options;
        this.tp = tp;
        this.stack = new TraversalStack(tp);
        this.circularChecker = new CircularDependencyChecker(tp, this.visited);
    }

    pushNode(node: ParallelExecutionPlan): boolean {
        return this.stack.push(node);
    }

    popNode(): ParallelExecutionPlan | undefined {
        return this.stack.pop();
    }

    isCircular(dependency: JsonPointerString, owner: JsonPointerString): boolean {
        return this.circularChecker.isCircular(dependency, owner);
    }

    logCircular(dependency: JsonPointerString): void {
        this.circularChecker.logCircular(dependency);
    }
} 