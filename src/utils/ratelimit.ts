/**
 * Rate-limits a function, ensuring that it is not called more often than once
 * in a specified maximum wait time.
 *
 * @param func The function to rate-limit.
 * @param maxWait The maximum wait time in milliseconds between successive calls.
 * @returns A rate-limited function with the same type as the original function.
 *
 * @example
 * // Example usage:
 * function myFunction(value: string) {
 *   console.log('Value:', value);
 * }
 *
 * Let's assume a rate limited function is created with maxWait of 1000ms
 * const rateLimitedFunction = rateLimit(myFunction, 1000);
 *
 * The following sequence of calls illustrates the behaviour of the rate-limited function:
 * rateLimitedFunction('First call'); // called at 0ms and Executed immediately
 * rateLimitedFunction('Second call');  // called at 500ms, deferred till execution at 1000ms
 * rateLimitedFunction('Third call');  // called at 700ms, deferred till execution at 1000ms, and replaces the Second call
 * // at 1000ms 'Third call' gets executed.
 * rateLimitedFunction('Forth call'); //  called at 1100m and executed immediately.
 */
export function rateLimit<T extends AnyFunction>(func: T, maxWait: number = 1000): T {
    let lastCallTime: number | null = null;
    let deferredCallTimer: ReturnType<typeof setTimeout> | null = null;

    return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
        const now = Date.now();
        const executeFunction = () => {
            lastCallTime = Date.now();
            func.apply(this as ThisParameterType<T>, args);
        };

        const diff = now - lastCallTime;
        if (lastCallTime === null || diff >= maxWait) {
            executeFunction();
        } else {
            if (deferredCallTimer) clearTimeout(deferredCallTimer);
            deferredCallTimer = setTimeout(() => {
                executeFunction();
            }, maxWait - diff);
        }
    } as T;
}

type AnyFunction = (...args: any[]) => void;