
// Utility to parse markdown and extract test data
import fs from 'fs';
import jsonata from "jsonata";
import StatedREPL  from './StatedREPL.js';
import { test, expect } from '@jest/globals';
import CliCore from "./CliCore.js";

export type CommandAndResponse = {
  cmdName: string;
  args: string[];
  expectedResponse: string;
  jsonataExpr: string;
};

export function parseMarkdownAndTestCodeblocks(md:string, cliCore:CliCore, printFunction:(k:any, v:any)=>any = StatedREPL.stringify){
  runMarkdownTests(parseMarkdownTests(md, cliCore), cliCore, printFunction);
}

/**
 * Read the markdown file and extract the code blocks for testing.
 * @param {string} markdownPath Path to the markdown file.
 * @param {object} cliInstance An instance of the CLI class that has the methods to be tested.
 * @return {Array} Array of test data including commands and expected responses.
 */
export function parseMarkdownTests(markdownPath:string, cliInstance:CliCore):CommandAndResponse[] {
  const markdownContent = fs.readFileSync(markdownPath, 'utf-8');
  const codeBlockRegex = /```(?<codeBlock>[\s\S]*?)```/g;
  const jsonataExpressionsArrayRegex = /^json \s*(?<jsonataExpressionsArrayString>\s*\[.*?])\s*[\r\n]/;
  const commandRegex = /^> \.(?<command>.+[\r\n])(?<expectedResponse>(?:(?!^>|```)[\s\S])*)$/gm;
  let match;
  const testData = [];
  while ((match = codeBlockRegex.exec(markdownContent)) !== null) {
    const { codeBlock } = match.groups;
    let jsonataExpressionsArrayJson;
    let _match = jsonataExpressionsArrayRegex.exec(codeBlock);
    if (_match !== null) {
      const { jsonataExpressionsArrayString } = _match.groups;
      if (jsonataExpressionsArrayString !== undefined) {
        try {
          jsonataExpressionsArrayJson = JSON.parse(jsonataExpressionsArrayString);
        }catch(e){
          throw new Error(`failed to parse JSON from markdown codeblock jsonata expressions array:  ${jsonataExpressionsArrayString}`);
        }
      }
    }
    let i = 0;
    while ((_match = commandRegex.exec(codeBlock)) !== null) {
      const { command, expectedResponse } = _match.groups;
      const args = command.trim().split(' ');
      if (args.length > 0) {
        const cmdName = args.shift();
        const method = cliInstance[cmdName];
        if (typeof method === 'function') {
          let jsonataExpr = jsonataExpressionsArrayJson ? jsonataExpressionsArrayJson[i] : false;
          testData.push({
            cmdName,
            args,
            expectedResponse: expectedResponse.trim(),
            jsonataExpr
          });
        }
        else {
          throw Error(`Unknown command: .${cmdName}`);
        }
      }
      i++;
    }
  }
  return testData;
}

/**
 * Runs the tests based on the extracted test data.
 * @param {Array} testData The test data containing the commands and expected responses.
 * @param {object} cliInstance An instance of the CLI class that has the methods to be tested.
 * @param {function} printFunction The function is used to print response output to compare with expected response.
 */
function runMarkdownTests(testData, cliInstance, printFunction = StatedREPL.stringify) {
  testData.forEach(({ cmdName, args, expectedResponse, jsonataExpr }) => {
    test(`${cmdName} ${args.join(' ')}`, async () => {
      const method = cliInstance[cmdName];
      const response = await method.apply(cliInstance, [args.join(' ')]);
      let responseNormalized;
      try {
        responseNormalized = JSON.parse(printFunction(response));
      }catch(error){
        console.log(error);
        throw error;
      }
      if (jsonataExpr) {
        const compiledExpr = jsonata(jsonataExpr);
        const success = await compiledExpr.evaluate(responseNormalized);
        if(success===false){
          throw new Error(`Markdown codeblock contained custom jsonata test expression that returned false: ${jsonataExpr}`);
        }
      }
      else {
        let expected;
        try {
          expected = expectedResponse ? JSON.parse(expectedResponse) : undefined;
        }catch(error){
          console.log(error);
          throw error;
        }
        if (expected) {
          expect(responseNormalized).toEqual(expected);
        }
        else {
          expect(responseNormalized).toBeDefined();
        }
      }
    }, 30000); // set timeout to 30 seconds for each test
  });
}