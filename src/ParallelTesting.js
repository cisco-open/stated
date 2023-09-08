// Generate a random timeout between 500ms to 2000ms
function getRandomTimeout() {
    return Math.floor(Math.random() * 1500) + 500;
}

// Simulated lengthy I/O-bound operation for reading "data"
function simulatedLengthyRead(file) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`Fake data from ${file}`);
        }, getRandomTimeout());
    });
}

// Simulated lengthy I/O-bound operation for writing "data"
function simulatedLengthyWrite(file, data) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`Fake write to ${file} with data: ${data}`);
        }, getRandomTimeout());
    });
}

// Simulated lengthy I/O-bound operation for making an "HTTP request"
function simulatedLengthyHTTPRequest(url) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(`Fake HTTP response from ${url}`);
        }, getRandomTimeout());
    });
}

// Workflow 1 with multiple invocations
async function workflow1() {
    try {
        for (let i = 1; i <= 3; i++) {
            const data1 = await simulatedLengthyRead(`file1-${i}.txt`);
            const writeStatus1 = await simulatedLengthyWrite(`file1-${i}-output.txt`, data1);
            const httpData1 = await simulatedLengthyHTTPRequest(`https://jsonplaceholder.typicode.com/todos/${i}`);
            console.log(`Workflow 1 Iteration ${i}:`, data1, writeStatus1, 'HTTP Data:', httpData1);
        }
    } catch (error) {
        console.error('Error in Workflow 1:', error);
    }
}

// Workflow 2 with multiple invocations
async function workflow2() {
    try {
        for (let i = 4; i <= 6; i++) {
            const data2 = await simulatedLengthyRead(`file2-${i}.txt`);
            const writeStatus2 = await simulatedLengthyWrite(`file2-${i}-output.txt`, data2);
            const httpData2 = await simulatedLengthyHTTPRequest(`https://jsonplaceholder.typicode.com/todos/${i}`);
            console.log(`Workflow 2 Iteration ${i}:`, data2, writeStatus2, 'HTTP Data:', httpData2);
        }
    } catch (error) {
        console.error('Error in Workflow 2:', error);
    }
}

// Running the workflows in parallel
console.log('Starting workflows...');
Promise.all([workflow1(), workflow2()])
    .then(() => {
        console.log('All workflows finished.');
    })
    .catch((error) => {
        console.log('One or more workflows encountered an error:', error);
    });
