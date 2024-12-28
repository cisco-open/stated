import { JsonPointerString } from "../MetaInfoProducer.js";
import JsonPointer from "../JsonPointer.js";
import TemplateProcessor from "../TemplateProcessor.js";

export class CircularDependencyChecker {
    private tp: TemplateProcessor;
    private visited: Set<string>;

    constructor(tp: TemplateProcessor, visited: Set<string>) {
        this.tp = tp;
        this.visited = visited;
    }

    isCircular(dependency: JsonPointerString, owner: JsonPointerString): boolean {
        return this.isCommonPrefix(owner, dependency);
    }

    /**
     * Used to detect a condition where like "data:${data.foo}" which essentially declares a dependency on the
     * expression itself. This is inherently circular. You cannot say "use that thing in this expression, where
     * that thing is a product of evaluating this expression". You also cannot say "use that thing in this
     * expression where that thing is a direct ancestor of this expression" as that is also circular, implying that
     * the expression tries to reference an ancestor node, whose descendent includes this very node.
     */
    private isCommonPrefix(exprNode: JsonPointerString, dependency: JsonPointerString): boolean {
        return JsonPointer.isAncestor(dependency, exprNode);
    }

    logCircular(dependency: JsonPointerString): void {
        const e = '🔃 Circular dependency  ' + Array.from(this.visited).join(' → ') + " → " + dependency;
        this.tp.warnings.push(e);
        this.tp.logger.log('warn', e);
    }
} 