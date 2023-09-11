import webpack from 'webpack';
import path from 'path';
import fs from 'fs';

async function bundleModule(entryFilePath) {
    return new Promise((resolve, reject) => {
        webpack({
            mode: 'development',
            entry: entryFilePath,
            output: {
                filename: 'bundle.js',
                path: path.resolve('dist'),
            }
        }, (err, stats) => {
            if (err) {
                reject(err);
                return;
            }

            if (stats.hasErrors()) {
                reject(new Error(stats.compilation.errors.join('\n')));
                return;
            }

            const dirname = path.dirname(new URL(import.meta.url).pathname);
            const bundledContent = fs.readFileSync(path.resolve(dirname, 'dist/bundle.js'), 'utf8');
            resolve(bundledContent);
        });
    });
}

(async () => {
    try {
        const jsContent = await bundleModule('./example/module_exports.js');
        const encodedContent = encodeURIComponent(jsContent);
        console.log("Bundled Content:", jsContent);

        const data = `data:text/javascript;charset=utf-8,${encodedContent}`;
        const moduleA = await import(data);
        console.log("Keys in moduleA:", Object.keys(moduleA));
        console.log(`moduleA.anotherFunction(): ${ moduleA.anotherFunction()}`);
    } catch (error) {
        console.error('Failed to load module:', error);
    }
})();