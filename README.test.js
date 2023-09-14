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
        console.log(`Skipping integration test: ${data.cmdName} ${data.args.join(' ')}`);
        return false;
    }
    return true;
});

testDataFiltered.forEach(({ cmdName, args, expectedResponseString }, i) => {
    test(`${cmdName} ${args.join(' ')}`, async () => {
        console.log(`Running test ${i + 1} of ${testData.length}: ${cmdName} ${args.join(' ')} and expecting ${expectedResponseString}`);
        const rest = args.join(" ");
        const resp = await cliCore[cmdName].apply(cliCore, [rest]);
        const respNormalized = JSON.parse(StatedREPL.stringify(resp));
        const _expected = JSON.parse(expectedResponseString);
        expect(respNormalized).toEqual(_expected);
    }, 30000);  // set timeout to 10 seconds for each test since in the readme we call web apis
});

