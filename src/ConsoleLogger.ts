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

export interface StatedLogger{
    debug(...args:any[]):void;
    error(...args:any[]):void;
    warn(...args:any[]):void;
    info(...args:any[]):void;
    verbose(...args:any[]):void;
    log(level:Levels, ...args:any[]): void;
    level:Levels;
}
export type Levels = "silent"|"error"|"warn"|"info"|"verbose"|"debug";
export type LogLevel = {
    silent: number;
    error: number;
    warn: number;
    info: number;
    verbose: number;
    debug: number;
};
export const LOG_LEVELS:LogLevel = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    verbose: 4,
    debug: 5
};
export default class ConsoleLogger implements StatedLogger{

    public level: Levels;
    constructor(initialLevel:Levels = 'verbose') {
        this.level = initialLevel;
    }

    setLevel(level:Levels):void {
        this.level = level;
    }

    debug(...args: any[]) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.debug) {
            console.debug(...args);
        }
    }

    error(...args:any[]) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.error) {
            console.error(...args);
        }
    }

    warn(...args:any[]) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.warn) {
            console.warn(...args);
        }
    }

    info(...args: any[]) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.info) {
            console.info(...args);
        }
    }

    verbose(...args:any[]) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.verbose) {
            console.log(...args);
        }
    }

    log(level:Levels, ...args:any[]) {
        // @ts-ignore
        this[level](args);
    }
}

