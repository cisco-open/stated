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

import StatedREPL  from './src/StatedREPL.js';
import { getTestDataFromReadme } from './src/testUtil.js';


const {cliCore, testData} = getTestDataFromReadme();
const testDataFiltered = testData.filter(data => {
    if (data.note && data.note.includes("integration test")) {
        console.log(`Running integration test: ${data.cmdName} ${data.args.join(' ')}`);
        return true;
    }
    return false;
});

async function runTestsSequentially() {
    for (let i = 0; i < testDataFiltered.length; i++) {
        const {cmdName, args, expectedResponseString} = testDataFiltered[i];
        console.log(`Starting test ${i + 1} of ${testDataFiltered.length} (${cmdName} ${args.join(' ')}):`);
        try {
            const rest = args.join(" ");
            const output = await cliCore[cmdName].apply(cliCore, [rest]);

            const respNormalized = JSON.parse(JSON.stringify(output));
            const _expected = JSON.parse(expectedResponseString);

            if (JSON.stringify(respNormalized) !== JSON.stringify(_expected)) {
                console.error(`Test ${i + 1} (${cmdName} ${args.join(' ')}): Expected: ${ _expected }, but got, ${ respNormalized}`);
                throw {expected: _expected, got: respNormalized}
            } else {
                console.log(`Test ${i + 1} (${cmdName} ${args.join(' ')}): Passed`);
            }
        } catch (e) {
            console.error(`Test failed:`, e);
            console.log(`To reproduce the problem, please run the command:\nnode --experimental-vm-modules README.module_tester.js`);
            process.exit(1);
        }
    }
}

runTestsSequentially();






