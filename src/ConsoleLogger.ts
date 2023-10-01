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

