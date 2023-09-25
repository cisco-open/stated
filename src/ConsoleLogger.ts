export interface StatedLogger{
    debug(...args):void;
    error(...args):void;
    warn(...args):void;
    info(...args):void;
    verbose(...args):void;
    log(level, ...args): void;
    level:string;
}
export const logLevels = {
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
        if (logLevels[this.level] >= logLevels.debug) {
            console.debug(...args);
        }
    }

    error(...args) {
        if (logLevels[this.level] >= logLevels.error) {
            console.error(...args);
        }
    }

    warn(...args) {
        if (logLevels[this.level] >= logLevels.warn) {
            console.warn(...args);
        }
    }

    info(...args) {
        if (logLevels[this.level] >= logLevels.info) {
            console.info(...args);
        }
    }

    verbose(...args) {
        if (logLevels[this.level] >= logLevels.verbose) {
            console.log(...args);
        }
    }

    log(level, ...args) {
        this[level](args);
    }
}

