#!/usr/bin/env node --experimental-vm-modules
import StatedREPL from './src/StatedREPL.js'
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import {StatedWorkflow} from "./src/StatedWorkflow.js";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const yamlFilePath = path.join(__dirname, 'example', 'experimental', 'pubsub.yaml');
const templateYaml = fs.readFileSync(yamlFilePath, 'utf8');
var template = yaml.load(templateYaml);
const tp = StatedWorkflow.newWorkflow(template);
await tp.initialize();
while(tp.output.stop$ === 'still going'){
    await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every 50ms
}
