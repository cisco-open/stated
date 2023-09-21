export default class ConsoleLogger {
    constructor(initialLevel = 'verbose') {
        this.level = initialLevel;
        this.levels = {
            error: 1,
            warn: 2,
            info: 3,
            verbose: 4,
            debug: 5
        };
    }

    debug(...args) {
        if (this.levels[this.level] >= this.levels.debug) {
            console.debug(...args);
        }
    }

    error(...args) {
        if (this.levels[this.level] >= this.levels.error) {
            console.error(...args);
        }
    }

    warn(...args) {
        if (this.levels[this.level] >= this.levels.warn) {
            console.warn(...args);
        }
    }

    verbose(...args) {
        if (this.levels[this.level] >= this.levels.verbose) {
            console.log(...args);
        }
    }

    log(level, ...args) {
        switch (level) {
            case 'info':
                if (this.levels[this.level] >= this.levels.info) {
                    console.info(...args);
                }
                break;
            default:
                if (this.levels[this.level] >= this.levels.verbose) {
                    console.log(...args);
                }
                break;
        }
    }
}

