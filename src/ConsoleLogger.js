export default class ConsoleLogger {

    debug(...args) {
        console.debug(...args);
    }

    error(...args) {
        console.error(...args);
    }

    warn(...args) {
        console.warn(...args);
    }

    verbose(...args) {
        // Console does not have a verbose method, so you can use log instead
        console.log(...args);
    }

    log(level, ...args) {
        // Map Winston log levels to console methods
        switch (level) {
            case 'info':
                console.info(...args);
                break;
            default:
                console.log(...args);
                break;
        }
    }
}

