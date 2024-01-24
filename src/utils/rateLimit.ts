// Copyright 2024 Cisco Systems, Inc.
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
