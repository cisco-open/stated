
// Utility to parse markdown and extract test data
import fs from 'fs';
import jsonata from "jsonata";
import StatedREPL  from './StatedREPL.js';
import { test, expect } from '@jest/globals';

/**
 * Read the markdown file and extract the code blocks for testing.
 * @param {string} markdownPath Path to the markdown file.
 * @param {object} cliInstance An instance of the CLI class that has the methods to be tested.
 * @return {Array} Array of test data including commands and expected responses.
 */
export function parseMarkdownTests(markdownPath, cliInstance) {
  const markdownContent = fs.readFileSync(markdownPath, 'utf-8');
  const codeBlockRegex = /```(?<codeBlock>[\s\S]*?)```/g;
  const jsonataExpressionsArrayRegex = /^[^\[]*(?<jsonataExpressionsArrayString>\s*\[.*?\]\s*)$/m;
  const commandRegex = /^> \.(?<command>.+[\r\n])((?<expectedResponse>(?:(?!^>|```)[\s\S])*))$/gm;

  let match;
  const testData = [];

  while ((match = codeBlockRegex.exec(markdownContent)) !== null) {
    const { codeBlock } = match.groups;
    let jsonataExpressionsArrayJson;
    let _match = jsonataExpressionsArrayRegex.exec(codeBlock);

    if (_match !== null) {
      const { jsonataExpressionsArrayString } = _match.groups;
      if (jsonataExpressionsArrayString !== undefined) {
        jsonataExpressionsArrayJson = JSON.parse(jsonataExpressionsArrayString);
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
        } else {
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
export function runMarkdownTests(testData, cliInstance, printFunction = StatedREPL.stringify) {
  testData.forEach(({ cmdName, args, expectedResponse, jsonataExpr }, i) => {
    test(`${cmdName} ${args.join(' ')}`, async () => {
      const method = cliInstance[cmdName];
      const response = await method.apply(cliInstance, [args.join(' ')]);
      const responseNormalized = JSON.parse(printFunction(response));

      if (jsonataExpr) {
        const compiledExpr = jsonata(jsonataExpr);
        expect(await compiledExpr.evaluate(responseNormalized)).toBe(true);
      } else {
        const expected = expectedResponse ? JSON.parse(expectedResponse) : undefined;
        if (expected) {
          expect(responseNormalized).toEqual(expected);
        } else {
          expect(responseNormalized).toBeDefined();
        }
      }
    }, 30000); // set timeout to 30 seconds for each test
  });
}