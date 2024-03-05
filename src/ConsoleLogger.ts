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
    debug(...args):void;
    error(...args):void;
    warn(...args):void;
    info(...args):void;
    verbose(...args):void;
    log(level, ...args): void;
    level:string;
}
export const LOG_LEVELS = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    verbose: 4,
    debug: 5
};
export default class ConsoleLogger implements StatedLogger{

    public level: string;
    constructor(initialLevel = 'verbose') {
        this.level = initialLevel;
    }

    debug(...args) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.debug) {
            console.debug(...args);
        }
    }

    error(...args) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.error) {
            console.error(...args);
        }
    }

    warn(...args) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.warn) {
            console.warn(...args);
        }
    }

    info(...args) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.info) {
            console.info(...args);
        }
    }

    verbose(...args) {
        if (LOG_LEVELS[this.level] >= LOG_LEVELS.verbose) {
            console.log(...args);
        }
    }

    log(level, ...args) {
        this[level](args);
    }
}

