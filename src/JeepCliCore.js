const fs = require('fs');
const TemplateProcessor = require('./TemplateProcessor');

class JeepCliCore {
    constructor() {
        this.templateProcessor = null;
    }

    async init(args) {
        const options = args.match(/(?:[^\s"]+|"[^"]*")+/g);
        const [flag, templateOrFilePath] = options;
        let input;
        if (flag === '-f') {
            const fileContent = await fs.promises.readFile(templateOrFilePath.slice(1, -1), 'utf8');
            input = JSON.parse(fileContent);
        } else {
            input = JSON.parse(templateOrFilePath);
        }
        this.templateProcessor = new TemplateProcessor(input);
        await this.templateProcessor.initialize();
        return this.templateProcessor.input;
    }

    async set(args) {
        const options = args.match(/(?:[^\s"]+|"[^"]*")+/g);
        let [path, data] = options;
        let jsonPtr = path;
        if (path === '-f') {
            try {
                // Read file
                const fileContent = await fs.promises.readFile(data, 'utf8');
                const tmp = JSON.parse(fileContent);
                jsonPtr = tmp.path; // Assumes the file contains an object with 'path' and 'data' properties
                data = tmp.data;
            } catch (err) {
                console.error('Error reading file:', err);
                throw err;
            }
        }

        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        try {
            data = JSON.parse(data);
        } catch (err) {
            console.error('Error parsing JSON data:', err);
            throw err;
        }

        await this.templateProcessor.setData(jsonPtr, data);
        return this.templateProcessor.output;
    }

    in() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.input;
    }

    out() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.output;
    }

    state() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.templateMeta;
    }

    from(args) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const [jsonPtr, option] = args.split(' ');
        return option === '--shallow' ? this.templateProcessor.getDependents(jsonPtr) : this.templateProcessor.getDependentsTransitiveExecutionPlan(jsonPtr);
    }

    to(args) {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        const [jsonPtr, option] = args.split(' ');
        return option === '--shallow' ? this.templateProcessor.getDependencies(jsonPtr) : this.templateProcessor.getDependenciesTransitiveExecutionPlan(jsonPtr);
    }

    plan() {
        if (!this.templateProcessor) {
            throw new Error('Initialize the template first.');
        }
        return this.templateProcessor.getEvaluationPlan();
    }
}

module.exports = JeepCliCore;
