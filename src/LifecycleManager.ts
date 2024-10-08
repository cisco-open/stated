import { LifecycleState, LifecycleCallback, LifecycleOwner } from './Lifecycle.js';
import TemplateProcessor from "./TemplateProcessor.js";


/**
 * Class for managing lifecycle callbacks.
 */
export class LifecycleManager implements LifecycleOwner {
    private lifecycleCallbacks: Map<LifecycleState, Set<LifecycleCallback>>;
    private templateProcessor: TemplateProcessor;

    constructor(templateProcessor:TemplateProcessor) {
        this.lifecycleCallbacks = new Map();
        this.templateProcessor = templateProcessor;
    }

    /**
     * Registers a lifecycle callback for a specific lifecycle state.
     * @param state The lifecycle state to register the callback for.
     * @param cbFn The callback function to execute when the lifecycle state is triggered.
     */
    setLifecycleCallback(state: LifecycleState, cbFn: LifecycleCallback) {
        this.templateProcessor.logger.debug(`Lifecycle callback set on state: ${state}`);
        let callbacks = this.lifecycleCallbacks.get(state);
        if (!callbacks) {
            callbacks = new Set();
            this.lifecycleCallbacks.set(state, callbacks);
        }
        callbacks.add(cbFn);
    }

    /**
     * Removes a specific lifecycle callback or all callbacks for a lifecycle state.
     * @param state The lifecycle state to remove the callback from.
     * @param cbFn The specific callback function to remove. If not provided, all callbacks for the state will be removed.
     */
    removeLifecycleCallback(state: LifecycleState, cbFn?: LifecycleCallback) {
        this.templateProcessor.logger.debug(`Lifecycle callback removed from state: ${state}`);
        if (cbFn) {
            const callbacks = this.lifecycleCallbacks.get(state);
            if (callbacks) {
                callbacks.delete(cbFn);
            }
        } else {
            this.lifecycleCallbacks.delete(state);
        }
    }

    /**
     * Calls all lifecycle callbacks registered for a specific lifecycle state.
     * @param state The lifecycle state to trigger callbacks for.
     */
    async runCallbacks(state: LifecycleState) {
        this.templateProcessor.logger.debug(`Calling lifecycle callbacks for state: ${state}`);
        const callbacks = this.lifecycleCallbacks.get(state);
        if (callbacks) {
            const promises = Array.from(callbacks).map(cbFn =>
                Promise.resolve().then(() => cbFn(state, this.templateProcessor))
            );

            try {
                await Promise.all(promises);
            } catch (error: any) {
                this.templateProcessor.logger.error(`Error in lifecycle callback at state ${state}: ${error.message}`);
            }
        }
    }

    clear(){
        this.lifecycleCallbacks.clear();
    }
}
