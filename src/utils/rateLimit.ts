export function rateLimit<T extends AnyFunction>(func: T, maxWait: number = 1000): T {
    let lastCallTime: number | null = null;
    let deferredCallTimer: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<T> | null = null;

    return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
        const context = this as ThisParameterType<T>;
        lastArgs = args; // Store the latest arguments

        const executeFunction = () => {
            lastCallTime = Date.now();
            if (lastArgs) {
                func.apply(context, lastArgs);
                lastArgs = null; // Reset after execution
            }
        };

        if (lastCallTime === null || (Date.now() - lastCallTime) >= maxWait) {
            // If this is the first call, or the wait time has passed since the last call
            executeFunction();
        } else if (!deferredCallTimer) {
            // Set up a deferred execution if not already scheduled
            deferredCallTimer = setTimeout(() => {
                deferredCallTimer = null; // Clear the timer
                executeFunction();
            }, maxWait - (Date.now() - lastCallTime));
        }
    } as T;
}

type AnyFunction = (...args: any[]) => void;
