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

const CliCore = require('./src/CliCore');
const fs = require('fs');
const {stringify} = require("./stated");
/**
 * Regular expression for command extraction from README.md file. This program finds all the markup code blocks
 * that begin and end with ``` (markdown syntax for code block) and it extracts the cli command and the
 * response. It then runs the cli command and compares the response to what is in the README.md. This ensures
 * that the README is always accurate.
 *
 * /^> \.(?<command>.+[\r\n])((?<expectedResponse>(?:(?!^>|```)[\s\S])*))$/gm
 *
 * Breakdown:
 *
 * ^: Start of a line (because we're using the 'm' flag which makes ^ and $ match start and end of lines respectively)
 *
 * > : Matches the ">" character literally. This assumes that your command lines in the README start with ">".
 *
 * \. : Matches the "." character literally.
 *
 * (?<command>.+[\r\n]): Named capturing group 'command'. Matches any number of characters (using .+), followed by a line break (using [\r\n]).
 *
 * ((?<expectedResponse>(?:(?!^>|```)[\s\S])*)): Named capturing group 'expectedResponse'. Matches any number of characters that do not start a new command line or a markdown code block.
 *
 * Inside 'expectedResponse':
 *    (?:...): Non-capturing group, used to group these elements together without remembering their matched content.
 *    (?!^>|```): Negative lookahead. Asserts that what follows is not the start of a new command line (^>) or a markdown code block (```).
 *    [\s\S]: Matches any character, including newlines. \s matches any whitespace character, and \S matches any non-whitespace character. Together, they match any character.
 *    *: Matches zero or more of the preceding element.
 *
 * $: End of a line (because we're using the 'm' flag which makes ^ and $ match start and end of lines respectively)
 *
 * g: Global flag, to find all matches in the string, not just the first one.
 *
 * m: Multiline flag, to allow ^ and $ to match the start and end of lines, not just the start and end of the whole string.
 */
const markdownContent = fs.readFileSync("README_JS.md", 'utf-8');
// const commandRegex  = /^> \.(?<command>.+[\r\n])((?<expectedResponse>(?:(?!^>|```)[\s\S])*))$/gm;
const commandRegex = /^(?:> \.note (?<note>.+)[\r\n])?^> \.(?<command>.+[\r\n])((?<expectedResponse>(?:(?!^>|```)[\s\S])*))$/gm;
let match;
const cliCore = new CliCore();
const testData = [];

while ((match = commandRegex.exec(markdownContent)) !== null) {
    const command = match.groups.command.trim();
    const expectedResponseString = match.groups.expectedResponse.trim();
    const args = command.split(' ');

    if (args.length > 0) {
        const cmdName = args.shift();
        const method = cliCore[cmdName];

        if (typeof method === 'function') {
            testData.push([cmdName, args, expectedResponseString]);
        } else {
            throw Error(`Unknown command: .${cmdName}`);
        }
    }
}

testData.forEach(([cmdName, args, expectedResponseString], i) => {
    test(`${cmdName} ${args.join(' ')}`, async () => {
        const rest = args.join(" ");
        const resp = await cliCore[cmdName].apply(cliCore, [rest]);
        const respNormalized = JSON.parse(stringify(resp));
        const _expected = JSON.parse(expectedResponseString);
        expect(respNormalized).toEqual(_expected);
    }, 30000);  // set timeout to 10 seconds for each test since in the readme we call web apis
});

