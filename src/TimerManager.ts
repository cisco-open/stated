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

import TemplateProcessor, {PlanStep} from "./TemplateProcessor.js";
import {JsonPointerString} from "./MetaInfoProducer.js";

type Timeout = ReturnType<typeof setTimeout>;
type Interval = ReturnType<typeof setInterval>;
type wrappedInterval = {
    interval: Interval,
    jsonPointerStr: JsonPointerString
}


class TimerManager {
    private timeouts: Set<Timeout>;
    private intervals: Set<Interval>;
    private tp: TemplateProcessor;
    private jsonPointerByInterval: Map<Interval, string>;

    constructor(tp:TemplateProcessor) {
        this.timeouts = new Set<Timeout>();
        this.intervals = new Set<Interval>();
        this.jsonPointerByInterval = new Map<Interval, string>();
        this.tp = tp;
    }

    // Wraps setTimeout to track the timeout
    public setTimeout = (callback: (...args: any[]) => void, delay: number, ...args: any[]): Timeout => {
        const timeout: Timeout = setTimeout(() => {
            callback(...args);
            this.timeouts.delete(timeout); // Remove the timeout from the set after it's called
        }, delay);
        this.timeouts.add(timeout);
        return timeout;
    }

    public generateSetInterval(planStep:PlanStep) {
        return (callback: (...args: any[]) => void, delay: number, ...args: any[]): Interval => {
            // TODO: wrap the callback to track last run time, run counter, and other stats
            const interval: Interval = setInterval(callback, delay, ...args);
            this.intervals.add(interval);
            this.jsonPointerByInterval.set(interval, planStep.jsonPtr);
            return interval;
        }
    }

    public generateClearInterval(planStep:PlanStep) {
        return async (interval: Interval): Promise<void> => {
            this.clearInterval(interval);
            const jsonPointerStr: string = this.jsonPointerByInterval.get(interval) as string;
            if (jsonPointerStr != undefined) {
                await this.tp.setData(jsonPointerStr, "--cleared-interval", "forceSetInternal");
            }
            this.jsonPointerByInterval.delete(interval);

        }
    }

    // Wraps setInterval to track the interval
    setInterval = (callback: (...args: any[]) => void, delay: number, ...args: any[]): Interval => {
        const interval: Interval = setInterval(callback, delay, ...args);
        this.intervals.add(interval);
        return interval;
    }

    // Clears a specific timeout
    public clearTimeout = (timeout: Timeout): void => {
        clearTimeout(timeout);
        this.timeouts.delete(timeout);
    }

    // Clears a specific interval
    public clearInterval = (interval: Interval): void => {
        clearInterval(interval);
        this.intervals.delete(interval);
    }

    // Clears all timeouts
    private clearAllTimeouts(): void {
        for (const timeout of this.timeouts) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
    }

    // Clears all intervals
    private clearAllIntervals(): void {
        for (const interval of this.intervals) {
            clearInterval(interval);
        }
        this.intervals.clear();
        this.jsonPointerByInterval.clear();
    }

    // Clears all timeouts and intervals
    public clear(): void {
        this.clearAllTimeouts();
        this.clearAllIntervals();
    }

    isInterval(interval: any){
        return this.intervals.has(interval);
    }
}

export { TimerManager };
