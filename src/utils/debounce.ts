// Copyright 2023 Cisco Systems, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


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
export function debounce<T extends AnyFunction>(func: T, wait: number=200): T {
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

