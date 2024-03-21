import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webpack from 'webpack';
import nodeExternals from 'webpack-node-externals';
import CopyPlugin from "copy-webpack-plugin";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {

    devtool: 'source-map',
    entry: {
        main: './dist/src/TemplateProcessor.js'
    },
    output: {
        path: `${__dirname}/dist`, // Use __dirname here
        filename: 'bundle-common-js.cjs', // Use the '.cjs' extension for CJS
        libraryTarget: 'commonjs', // Use 'module' as the library target
        publicPath: '/', // Important for correct source map paths
        // In sourcemap files, webpack generates sources with URLs like this: webpack://stated-js/dist/src/JsonPointer.ts
        // Strangely, webpack's sourcemap loader itself cannot handle these 'webpack://' URLS that it generates for TS files.
        // 3rd party lib trying to preserver Stated-js sourcemaps will fail with "Failed to parse source map: 'webpack://stated-js/dist/src/JsonPointer.ts' URL is not supported"
        // However, i have this workaround - we just drop the webpack:// crap at the begining of the URL
        devtoolModuleFilenameTemplate: info => {
            let resourcePath = info.absoluteResourcePath;
            const srcIndex = resourcePath.indexOf('/src/');
            if (srcIndex !== -1) {
                // Extract the part of the path from '/src/' onward
                return resourcePath.substring(srcIndex);//path is now relative to, and inside 'dist' with no 'webpack:// cruft'
            }
            const node_modules_index = resourcePath.indexOf('/node_modules/');
            if(node_modules_index !== -1){
                return ".."+resourcePath.substring(node_modules_index);
            }

            return resourcePath;
        }

    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: [/node_modules/, `${__dirname}/dist/src/FancyLogger.js`, `${__dirname}/dist/src/CliCore.js`, `${__dirname}/dist/src/StatedREPL.js`],
                use: {
                    loader: 'babel-loader', // You can add Babel or other loaders here
                },
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
        fallback: {
            util: false,
            path: false,
            fs: false,
            winston: false,
            os:false,
            buffer:false,
            zlib: false,
            http: false,
            https:false,
        }
    },
    plugins: [
        // Define global constants
        new webpack.DefinePlugin({
            BUILD_TARGET: JSON.stringify('web'),
        }),
//make sure the .ts files go into dist for sourcemaps
        new CopyPlugin({
            patterns: [
                {
                    from: 'src/**/*.ts', // Match only .ts files within the src directory
                    to: 'src/[name][ext]', // Copy to dist/src while retaining the file names and extensions
                    globOptions: {
                        ignore: [
                            '**/test/**', // Exclude the src/test directory
                        ],
                    },
                },
            ],
        })

    ],


    node: false
};
