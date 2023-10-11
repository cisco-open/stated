import ConsoleLogger, {LOG_LEVELS} from "./ConsoleLogger.js";
import TemplateProcessor from "./TemplateProcessor.js";

export default class FancyLogger {
    static async getLogger() {
        if (typeof BUILD_TARGET === 'undefined' || BUILD_TARGET !== 'web') {
            const winston = await import('winston');
            const formats = [winston.format.colorize(), winston.format.simple()];
            return winston.createLogger({
                levels: LOG_LEVELS,
                format: winston.format.json(),
                transports: [
                    new winston.transports.Console({
                        format: winston.format.combine(...formats)
                    })
                ],
            });
        } else {
            throw new Error(`FancyLogger can't be used when BUILD_TARGET is ${BUILD_TARGET}`);
        }
    }
}
