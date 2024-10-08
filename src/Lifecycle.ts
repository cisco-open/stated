import TemplateProcessor from "./TemplateProcessor.js";

/**
 * Enum representing the various states of the lifecycle.
 * This is used to track different phases during the operation of the system.
 */
export enum LifecycleState {
    /**
     * The state representing the start of the initialization process.
     */
    StartInitialize = 'StartInitialize',

    /**
     * The state before temporary variables are removed from the system.
     */
    PreTmpVarRemoval = 'PreTmpVarRemoval',

    /**
     * The state when the system has been fully initialized and is ready for use.
     */
    Initialized = 'Initialized',

    /**
     * The state when the process to close the system begins.
     */
    StartClose = 'StartClose',

    /**
     * The state when the system has fully closed and is no longer operational.
     */
    Closed = 'Closed',
}

/**
 * Callback type definition for functions that handle lifecycle transitions.
 *
 * This type represents an asynchronous function that will be called whenever the
 * lifecycle state changes. It receives the new lifecycle state and a `TemplateProcessor`
 * instance for processing.
 *
 * @param state - The new lifecycle state that the system has transitioned to.
 * @param templateProcessor - The `TemplateProcessor` instance to be used for handling the state transition.
 *
 * @returns A `Promise<void>` indicating the asynchronous operation is complete.
 */
export type LifecycleCallback = (state: LifecycleState, templateProcessor: TemplateProcessor) => Promise<void>;

/**
 * Interface for managing lifecycle callbacks.
 */
export interface LifecycleOwner {
    /**
     * Registers a lifecycle callback for a specific lifecycle state.
     * @param state The lifecycle state to register the callback for.
     * @param cbFn The callback function to execute when the lifecycle state is triggered.
     */
    setLifecycleCallback(state: LifecycleState, cbFn: LifecycleCallback): void;

    /**
     * Removes a specific lifecycle callback or all callbacks for a lifecycle state.
     * @param state The lifecycle state to remove the callback from.
     * @param cbFn The specific callback function to remove. If not provided, all callbacks for the state will be removed.
     */
    removeLifecycleCallback(state: LifecycleState, cbFn?: LifecycleCallback): void;
}


