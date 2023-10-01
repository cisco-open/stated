/**
 * Represents a template processor.
 */
export default class TemplateProcessor{
    /**
     * Initializes a new instance of the `TemplateProcessor` class.
     * @param input - The initial input for the template processor.
     * @param contextData - The context data used for processing.
     * @param options - Configuration options for the template processor.
     */
    constructor(input: any, contextData?: any, options?: any);

    /**
     * A set of tags associated with the template processor.
     */
    tagSet: Set<string>;

    /**
     * Logger instance used for logging various messages.
     */
    logger: any;

    /**
     * Initializes the template processor.
     */
    initialize(): Promise<void>;

    /**
     * The processed output resulting from expression evaluation. It will change when setData is called and changes
     * flow through the DAG.
     */
    output: any;

    /**
     * Represents the input template, which never changes.
     */
    input: any;

    /**
     * Metadata related to the template being processed.
     */
    templateMeta: any;

    /**
     * Sets data at a specific JSON pointer in the template.
     * @param jsonPtr - The JSON pointer indicating where to set the data.
     * @param data - The data to set.
     */
    setData(jsonPtr: string, data: any): Promise<void>;

    /**
     * Fetches data from the output based on a JSON pointer.
     * @param jsonPtr - The JSON pointer indicating where to fetch the data from.
     * @returns Data from the specified JSON pointer location.
     */
    out(jsonPtr: string): any;

    /**
     * Gets the dependencies for a given JSON pointer.
     * @param jsonPtr - The JSON pointer indicating which part of the template to get dependencies for.
     * @returns An array of dependencies.
     */
    getDependencies(jsonPtr: string): string[];

    /**
     * Gets the dependencies transitive execution plan for a given JSON pointer.
     * @param jsonPtr - The JSON pointer indicating which part of the template to get the plan for.
     * @returns An execution plan.
     */
    getDependenciesTransitiveExecutionPlan(jsonPtr: string): any;

    /**
     * Gets the dependents for a given JSON pointer.
     * @param jsonPtr - The JSON pointer indicating which part of the template to get dependents for.
     * @returns An array of dependents.
     */
    getDependents(jsonPtr: string): string[];

    /**
     * Gets the dependents transitive execution plan for a given JSON pointer.
     * @param jsonPtr - The JSON pointer indicating which part of the template to get the plan for.
     * @returns An execution plan.
     */
    getDependentsTransitiveExecutionPlan(jsonPtr: string): any;

    /**
     * Gets the evaluation plan for the template.
     * @returns The evaluation plan.
     */
    getEvaluationPlan(): Promise<any>;

    /**
     * Sets a callback to be invoked when data changes.
     * @param jsonPtr - The JSON pointer indicating where to monitor for data changes.
     * @param callback - The callback to invoke when data changes.
     */
    setDataChangeCallback(jsonPtr: string, callback: (data: any, jsonPtr: string) => void): void;
}

