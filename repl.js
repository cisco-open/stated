#!/usr/bin/env node
const repl = require('repl');
const fs = require('fs');
const util = require('util');
const readFile = util.promisify(fs.readFile);
const TemplateProcessor = require('./TemplateProcessor');

let templateProcessor;

const r = repl.start({
    prompt: '> ',
});

r.defineCommand('init', {
    help: 'Initialize the template',
    async action(args) {
        const options = args.match(/(?:[^\s"]+|"[^"]*")+/g);
        const [flag, templateOrFilePath] = options;

        let template;

        if (flag === '-f') {
            try {
                const fileContent = await readFile(templateOrFilePath.slice(1, -1), 'utf8');
                template = JSON.parse(fileContent);
            } catch (err) {
                console.error('Error reading file:', err);
                this.displayPrompt();
                return;
            }
        } else {
            try {
                template = JSON.parse(templateOrFilePath);
            } catch (err) {
                console.error('Error parsing JSON:', err);
                this.displayPrompt();
                return;
            }
        }

        templateProcessor = new TemplateProcessor(template);
        await templateProcessor.initialize();
        console.log(JSON.stringify(templateProcessor.input, null, 2));
        this.displayPrompt();
    },
});

r.defineCommand('set', {
    help: 'Set data to a JSON pointer path',
    async action(args) {
        const options = args.match(/(?:[^\s"]+|"[^"]*")+/g);
        let [path, data] = options;

        if (path === '-f') {
            try {
                // Read file
                const fileContent = await fs.promises.readFile(data, 'utf8');
                const tmp = JSON.parse(fileContent);
                path = tmp.path; // Assumes the file contains an object with 'path' and 'data' properties
                data = tmp.data;
            } catch (err) {
                console.error('Error reading file:', err);
                this.displayPrompt();
                return;
            }
        } else {
            try {
                data = JSON.parse(data);
            } catch (err) {
                console.error('Error parsing JSON data:', err);
                this.displayPrompt();
                return;
            }
        }

        if (templateProcessor) {
            try {
                console.time('setData Execution Time');
                await templateProcessor.setData(path, data);
                console.timeEnd('setData Execution Time');

                console.log(JSON.stringify(templateProcessor.output, null, 2));
            } catch (err) {
                console.error('Error setting data:', err);
            }
        } else {
            console.error('Error: Initialize the template first.');
        }
        this.displayPrompt();
    },
});


r.defineCommand('in', {
    help: 'Show the input template',
    action() {
        if (templateProcessor) {
            console.log(JSON.stringify(templateProcessor.input, null, 2));
        } else {
            console.error('Error: Initialize the template first.');
        }
        this.displayPrompt();
    },
});

r.defineCommand('out', {
    help: 'Show the current state of the template',
    action() {
        if (templateProcessor) {
            console.log(JSON.stringify(templateProcessor.output, null, 2));
        } else {
            console.error('Error: Initialize the template first.');
        }
        this.displayPrompt();
    },
});

r.defineCommand('state', {
    help: 'Show the current state of the templateMeta',
    action() {
        if (templateProcessor) {
            const omitCompiledExpressionsFromPrint = (key, value) => {
                if (key === 'compiledExpr__') {
                    return undefined;
                }
                return value;
            }
            console.log(JSON.stringify(templateProcessor.templateMeta, omitCompiledExpressionsFromPrint, 2));
        } else {
            console.error('Error: Initialize the template first.');
        }
        this.displayPrompt();
    },
});

r.defineCommand('from', {
    help: 'Show the dependents of a given JSON pointer',
    action(args) {
        if (templateProcessor) {
            const [jsonPtr, option] = args.split(' ');
            const dependents = option === '--shallow' ? templateProcessor.getDependents(jsonPtr): templateProcessor.getDependentsTransitiveExecutionPlan(jsonPtr) ;
            console.log(JSON.stringify(dependents, null, 2));
        } else {
            console.error('Error: Initialize the template first.');
        }
        this.displayPrompt();
    },
});

r.defineCommand('to', {
    help: 'Show the dependencies of a given JSON pointer',
    action(args) {
        if (templateProcessor) {
            const [jsonPtr, option] = args.split(' ');
            const dependencies = option === '--shallow' ? templateProcessor.getDependencies(jsonPtr):templateProcessor.getDependenciesTransitiveExecutionPlan(jsonPtr);
            console.log(JSON.stringify(Array.from(dependencies), null, 2));
        } else {
            console.error('Error: Initialize the template first.');
        }
        this.displayPrompt();
    },
});

r.defineCommand('help', {
    help: 'Display available commands and their descriptions',
    action() {
        console.log('Available commands:');
        Object.entries(r.commands).forEach(([name, command]) => {
            console.log(`  .${name} - ${command.help}`);
        });
        this.displayPrompt();
    },
});
