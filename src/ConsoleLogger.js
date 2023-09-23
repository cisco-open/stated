export default class ConsoleLogger {
    static levels = {
        silent: 0,
        error: 1,
        warn: 2,
        info: 3,
        verbose: 4,
        debug: 5
    };
    constructor(initialLevel = 'verbose') {
        this.level = initialLevel;
    }

    fail(...args) {
        if (ConsoleLogger.levels[this.level] >= ConsoleLogger.levels.silent) {
            console.error(...args);
        }
    }

    debug(...args) {
        if (ConsoleLogger.levels[this.level] >= ConsoleLogger.levels.debug) {
            console.debug(...args);
        }
    }

    error(...args) {
        if (ConsoleLogger.levels[this.level] >= ConsoleLogger.levels.error) {
            console.error(...args);
        }
    }

    warn(...args) {
        if (ConsoleLogger.levels[this.level] >= ConsoleLogger.levels.warn) {
            console.warn(...args);
        }
    }

    info(...args) {
        if (ConsoleLogger.levels[this.level] >= ConsoleLogger.levels.info) {
            console.info(...args);
        }
    }

    verbose(...args) {
        if (ConsoleLogger.levels[this.level] >= ConsoleLogger.levels.verbose) {
            console.log(...args);
        }
    }

    log(level, ...args) {
        this[level](args);
    }
}

