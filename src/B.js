const fs = require('fs');

function imortJSContent(jsContent) {
    const encodedContent = encodeURIComponent(jsContent);
    return `data:text/javascript;charset=utf-8,${encodedContent}`;
}

async function loadModule() {
    try {
        const jsContent = fs.readFileSync("./A.js", "utf8");
        let data = imortJSContent(jsContent);
        const moduleA = await import(data);
        console.log(moduleA.myFunction()); // Outputs: Hello from myFunction
    } catch (error) {
        console.error('Failed to load module:', error);
    }
}

loadModule();
