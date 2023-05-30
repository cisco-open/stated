const repl = require('repl');
const fs = require('fs');
const util = require('util');
const readFile = util.promisify(fs.readFile);
const TemplateProcessor = require('./TemplateProcessor');

let templateProcessor = null;

const r = repl.start({
    prompt: '> ',
    eval: async (cmd, context, filename, callback) => {
        const [action, ...args] = cmd.trim().split(' ');
        switch (action) {
            case 'init':
                if (args[0] === "-f") {
                    // If '-f' argument is provided, read the template from the file
                    const filePath = args[1];
                    try {
                        const fileContent = await readFile(filePath, 'utf8');
                        const template = JSON.parse(fileContent);
                        templateProcessor = new TemplateProcessor(template);
                        await templateProcessor.initialize();
                        console.log("Template Initialized from file.");
                    } catch (error) {
                        console.log(`Error reading file or initializing template: ${error.message}`);
                    }
                } else {
                    // Otherwise, parse the inline string as JSON
                    const templateString = args.join(' ');
                    try {
                        const template = JSON.parse(templateString);
                        templateProcessor = new TemplateProcessor(template);
                        await templateProcessor.initialize();
                        console.log("Template Initialized from inline string.");
                    } catch (error) {
                        console.log(`Error parsing inline JSON or initializing template: ${error.message}`);
                    }
                }
                break;
            case 'set':
                if (!templateProcessor) {
                    console.log('Initialize the template first');
                    break;
                }
                const jsonPtr = args[0];
                const data = JSON.parse(args[1]);
                await templateProcessor.setData(jsonPtr, data);""
                console.log(JSON.stringify(templateProcessor.template, null, 2));
                break;
            default:
                console.log(`Unknown command: ${action}`);
        }
        callback(null);
    },
});

r.on('exit', () => {
    process.exit();
});
