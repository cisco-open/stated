/**
 * Debounces a function, ensuring that it is only called once after a specified
 * time has elapsed since the last call.
 *
 * @param func The function to debounce.
 * @param wait The number of milliseconds to wait before invoking the function.
 * @returns A debounced function with the same type as the original function.
 *
 * @example
 * // Example usage:
 * function myFunction(value: string) {
 *   console.log('Value:', value);
 * }
 *
 * const debouncedFunction = debounce(myFunction, 500);
 *
 * debouncedFunction('First call');
 * debouncedFunction('Second call');
 * debouncedFunction('Third call');
 *
 */
export function debounce<T extends AnyFunction>(func: T, wait: number): T {
    let timeout: ReturnType<typeof setTimeout>;

    return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
        const context = this as ThisParameterType<T>;

        clearTimeout(timeout);

        timeout = setTimeout(() => {
            func.apply(context, args);
        }, wait);
    } as T;
}
type AnyFunction = (...args: any[]) => void;