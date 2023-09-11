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

import CliCore from "./src/CliCore.js";
import fs from 'fs';

// const CliCore = require('./src/CliCore');
// const fs = require('fs');
// const {stringify} = require("./stated");

const markdownContent = fs.readFileSync("README.md", 'utf-8');
const commandRegex = /^(?:> \.note (?<note>.+)[\r\n])?^> \.(?<command>.+[\r\n])((?<expectedResponse>(?:(?!^>|```)[\s\S])*))$/gm;
let match;
const cliCore = new CliCore();
const testData = [];

while ((match = commandRegex.exec(markdownContent)) !== null) {
    const command = match.groups.command.trim();
    const expectedResponseString = match.groups.expectedResponse.trim();
    const note = match.groups.note?.trim();
    const args = command.split(' ');

    if (args.length > 0) {
        const cmdName = args.shift();
        const method = cliCore[cmdName];

        if (typeof method === 'function') {
            if (note && note.includes("integration test")) {
                testData.push([cmdName, args, expectedResponseString]);
            }
        } else {
            throw Error(`Unknown command: .${cmdName}`);
        }
    }
}

async function runTestsSequentially() {
    for (const [cmdName, args, expectedResponseString] of testData) {
        // Use the cmdName and args to determine which method to call
        const i = testData.indexOf([cmdName, args, expectedResponseString]);  // Find the index
        console.log(`Starting test ${i + 1} (${cmdName} ${args.join(' ')}):`);
        try {
            const rest = args.join(" ");
            const output = await cliCore[cmdName].apply(cliCore, [rest]);

            const respNormalized = JSON.parse(JSON.stringify(output));
            const _expected = JSON.parse(expectedResponseString);

            if (JSON.stringify(respNormalized) !== JSON.stringify(_expected + ' ')) {
                console.error(`Test ${i + 1} (${cmdName} ${args.join(' ')}): Expected`, _expected, 'but got', respNormalized);
                throw {expected: _expected, got: respNormalized}
            } else {
                console.log(`Test ${i + 1} (${cmdName} ${args.join(' ')}): Passed`);
            }
        } catch (e) {
            console.error(`Test ${i + 1} (${cmdName} ${args.join(' ')}): Failed`);
            console.error(e);
            throw e;
        }
    }
}

runTestsSequentially();






