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

type Timeout = ReturnType<typeof setTimeout>;
type Interval = ReturnType<typeof setInterval>;

class TimerManager {
    private timeouts: Set<Timeout>;
    private intervals: Set<Interval>;

    constructor() {
        this.timeouts = new Set<Timeout>();
        this.intervals = new Set<Interval>();
    }

    // Wraps setTimeout to track the timeout
    setTimeout(callback: (...args: any[]) => void, delay: number, ...args: any[]): Timeout {
        const timeout: Timeout = setTimeout(() => {
            callback(...args);
            this.timeouts.delete(timeout); // Remove the timeout from the set after it's called
        }, delay);
        this.timeouts.add(timeout);
        return timeout;
    }

    // Wraps setInterval to track the interval
    setInterval(callback: (...args: any[]) => void, delay: number, ...args: any[]): Interval {
        const interval: Interval = setInterval(callback, delay, ...args);
        this.intervals.add(interval);
        return interval;
    }

    // Clears a specific timeout
    clearTimeout(timeout: Timeout): void {
        clearTimeout(timeout);
        this.timeouts.delete(timeout);
    }

    // Clears a specific interval
    clearInterval(interval: Interval): void {
        clearInterval(interval);
        this.intervals.delete(interval);
    }

    // Clears all timeouts
    clearAllTimeouts(): void {
        for (const timeout of this.timeouts) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
    }

    // Clears all intervals
    clearAllIntervals(): void {
        for (const interval of this.intervals) {
            clearInterval(interval);
        }
        this.intervals.clear();
    }

    // Clears all timeouts and intervals
    clearAll(): void {
        this.clearAllTimeouts();
        this.clearAllIntervals();
    }

    isInterval(interval: any){
        return this.intervals.has(interval);
    }
}

export { TimerManager };
