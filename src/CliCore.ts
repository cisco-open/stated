// Copyright 2023 Cisco Systems, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import TemplateProcessor from './TemplateProcessor.js';
import * as repl from 'repl';
import {stringifyTemplateJSON} from "./utils/stringify.js";
import jsonata from "jsonata";
import {CliCoreBase} from "./CliCoreBase.js";
import fs from 'fs';


export default class CliCore extends CliCoreBase{
    //@ts-ignore
    public replServer:repl.REPLServer;

    constructor(templateProcessor: TemplateProcessor) {
        super(templateProcessor);
    }

    public async open(directory: string = this.currentDirectory) {
        if(directory === ""){
            directory = this.currentDirectory;
        }

        let files: string[]|undefined = undefined;
        try {
            // Read all files from the directory
            files = await fs.promises.readdir(directory);
        } catch (error) {
            console.log(`Error reading directory ${directory}: ${error}`);
            console.log('Changed directory with .cd or .open an/existing/directory');
            this.replServer.displayPrompt();
            return {error: `Error reading directory ${directory}: ${error}`};
        }
        // Filter out only .json and .yaml files
        const templateFiles: string[] = files.filter(file => file.endsWith('.json') || file.endsWith('.yaml'));

        // Display the list of files to the user
        templateFiles.forEach((file, index) => {
            console.log(`${index + 1}: ${file}`);
        });

        // Create an instance of AbortController
        const ac = new AbortController();
        const {signal} = ac; // Get the AbortSignal from the controller

        // Ask the user to choose a file
        this.replServer.question('Enter the number of the file to open (or type "abort" to cancel): ', {signal}, async (answer) => {
            // Check if the operation was aborted
            if (signal.aborted) {
                console.log('File open operation was aborted.');
                this.replServer.displayPrompt();
                return;
            }

            const fileIndex = parseInt(answer, 10) - 1; // Convert to zero-based index
            if (fileIndex >= 0 && fileIndex < templateFiles.length) {
                // User has entered a valid file number; initialize with this file
                const filepath = templateFiles[fileIndex];
                try {
                    const result = await this.init(`-f "${filepath}"`); // Adjust this call as per your init method's expected format
                    console.log(stringifyTemplateJSON(result));
                    console.log("...try '.out' or 'template.output' to see evaluated template")
                } catch (error) {
                    console.log('Error loading file:', error);
                }
            } else {
                console.log('Invalid file number.');
            }
            this.replServer.displayPrompt();
        });

        // Allow the user to type "abort" to cancel the file open operation
        this.replServer.once('SIGINT', () => {
            ac.abort();
        });

        return "open... (type 'abort' to cancel)";
    }


    public async tail(args: string): Promise<any> {
        console.log("Started tailing... Press Ctrl+C to stop.")
        let {jsonPointer, number:countDown=NaN, jsonataExpression="false"} = this.extractArgsInfo(args);
        const compiledExpr = jsonata(jsonataExpression);

        let currentOutputLines = 0;

        // SIGINT listener to handle Ctrl+C press in REPL
        const onSigInt = () => {
            unplug();
        };

        // If this.replServer is defined (not in tests), register the SIGINT listener
        if (this.replServer) {
            this.replServer.on('SIGINT', onSigInt);
        }

        let resolve: ()=>void; //resolve function that will act as a latch to cause tail to return when the 'until' criterion is met
        // Function to stop tailing
        const unplug = () => {
            // Stop tailing without clearing the screen to keep the exit message
            this.templateProcessor.removeDataChangeCallback(jsonPointer);

            // If this.replServer is defined (not in tests), display the prompt and remove the SIGINT listener
            if (this.replServer) {
                this.replServer.removeListener('SIGINT', onSigInt);
            }
        };

        let _data;
        let done = false;
        // Data change callback
        const onDataChanged = async (data: any) => {
            if(done){
                return; //just ignore any latent callbacks
            }
            // Convert data to a string
            const output = stringifyTemplateJSON(data);
            _data = JSON.parse(output); //save data so we can return the final value from the promise. It is important to return a snapshot via reparsing from string so that returned objects don't continue to 'evolve' and make testing impossible
            const outputLines = output.split('\n');


            // If in overwrite mode and output lines exist, move cursor up to clear previous lines
            for (let i = 0; i < currentOutputLines; i++) {
                //when we are running tests like from README.md autogenerated tests, there is no repl server
                //so we must check to make sure it exists before we write it
                this.replServer && this.replServer.output.write('\x1B[1A\x1B[K'); // Clear the line
            }


            if(isNaN(countDown) || countDown > 0) { //since the last value will be returned from this method and written by the REPL, we should not print it to screen
                // Write new data to the output
                this.replServer && this.replServer.output.write(output + '\n');
                // Update the current output lines count for the next change
                currentOutputLines = outputLines.length;
            }

            if(!isNaN(countDown)){
                countDown--;
            }

            if(countDown === 0 || await compiledExpr.evaluate(_data)===true){ //check if the expression in the 'until' argument (the stop tailing condition) has evaluated to true
                done = true;
                unplug();
                resolve(); //resolve the latch promise
            }
        };


        // If countDown is greater than zero, return the Promise that resolves when countDown is zero
        const latch = new Promise<void>((_resolve) => {
                resolve = _resolve; //we assign our resolve variable that is declared outside this promise so that our onDataChange callbacks can use  it
        });

        // Register the onDataChanged callback with the templateProcessor
        this.templateProcessor.setDataChangeCallback(jsonPointer, onDataChanged);

        await latch; //waits for a onDataChanged callback to resolve the latch.

        return {
            "__tailed": true,
            "data":_data
        }; //the last result tailed to the screen is what this command returns
    }

}

