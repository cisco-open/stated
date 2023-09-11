const CliCore = require('./src/CliCore'); // Adjust the path as necessary

async function runCliCoreTest() {
    try {
        const cliCore = new CliCore();

        // Construct the command as if it were parsed from stated's command line
        const commandStr = 'example/ex25.json --xf "example/module_exports.js"';
        const output = await cliCore.init(commandStr);

        console.log("Output:", output);

    } catch (error) {
        console.error('An error occurred:', error);
    }
}

runCliCoreTest();