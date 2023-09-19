export default class FancyLogger {
    static async getLogger() {
        if (typeof BUILD_TARGET === 'undefined' || BUILD_TARGET !== 'web') {
            const winston = await import('winston');
            const formats = [winston.format.colorize(), winston.format.simple()];
            const logger = winston.createLogger({
                format: winston.format.json(),
                transports: [
                    new winston.transports.Console({
                        format: winston.format.combine(...formats)
                    })
                ],
            });
            return logger;
        } else {
            throw new Error(`FancyLogger can't be used when BUILD_TARGET is ${BUILD_TARGET}`);
        }
    }
}
