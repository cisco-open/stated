const CliCore = require('./src/CliCore');

const testInstance = async (index) => {
    // Introduce a random delay between 0 and 2000 milliseconds
    // const randomDelay = Math.floor(Math.random() * 1);
    // await new Promise(resolve => setTimeout(resolve, randomDelay));

    // console.log(`Starting test #${index} after delay of ${randomDelay}ms`);
    const cli = new CliCore();
    const result = await cli.init('example/ex25.json --xf "example/module_exports.js"');

    // Log the outcome
    if (!result) {
        console.log(`Test #${index} failed, output: ${JSON.stringify(result)}`);
        return false;
    }
    console.log(`Test #${index} succeeded, output: ${JSON.stringify(result)}`);
    return true;
};

async function main() {
    const promises = [];

    // Create 100 promises
    for (let i = 0; i < 100; i++) {
        promises.push(testInstance(i));
    }

    // Wait for all promises to resolve
    const results = await Promise.all(promises);

    // Count successes and failures
    const successes = results.filter(r => r === true).length;
    const failures = results.length - successes;

    console.log(`Successes: ${successes}`);
    console.log(`Failures: ${failures}`);
}

main().catch(error => {
    console.error("Error in main:", error);
});
