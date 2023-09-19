import { fileURLToPath } from 'url';
import { dirname } from 'path';
import webpack from 'webpack';
import nodeExternals from 'webpack-node-externals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
    entry: {
        main: './src/TemplateProcessor.js'
    },
    output: {
        path: `${__dirname}/dist`, // Use __dirname here
        filename: 'bundle.mjs', // Use the '.mjs' extension for ESM
        module: true, // Indicate that this is an ES module
        libraryTarget: 'module', // Use 'module' as the library target
    },
    experiments: {
        outputModule: true, // Enable the outputModule experiment
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: [/node_modules/, `${__dirname}/src/FancyLogger.js`],
                use: {
                    loader: 'babel-loader', // You can add Babel or other loaders here
                },
            },
        ],
    },
    resolve: {
        extensions: ['.js'],
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
        // Other plugins...
    ],


    node: false
};
