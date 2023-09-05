const StatedWorkflow = require('../StatedWorkflow');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const stated = require('../../stated');

const yamlFilePath = path.join(__dirname, '../','../','example', 'experimental', 'pulsarWF.yaml');
const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');

// Parse the YAML
var template = yaml.load(templateYaml);


const tp = StatedWorkflow.newWorkflow(template);
process.on('SIGINT', function() {
    console.log('\nGracefully shutting down from SIGINT (Ctrl+C)');
    console.log(`template output log is ${JSON.stringify(tp.output.log, null, 2)}`)
    // Perform any cleanup or final tasks you need to here
    process.exit();
});
(async ()=> {
    await tp.initialize();
})()

