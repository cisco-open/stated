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

import StatedREPL from "../../dist/src/StatedREPL.js";
import TemplateProcessor from "../../dist/src/TemplateProcessor.js";

test("test stringify", async () => {
  expect(StatedREPL.stringify({a: 1, b: 2})).toBe(
    `{
  "a": 1,
  "b": 2
}`);
});

test("test stringify custom print function", async () => {
  const customPrintFunc = (k,v) => {return k === "a" ? null : v}
  expect(StatedREPL.stringify({ a: 1, b: 2 }, customPrintFunc)).toBe(
    `{
  "a": null,
  "b": 2
}`);
});

/** Test that the onInit function is called when the .init command is called */
test("test onInit", async () => {
  const repl1 = new StatedREPL();
  await repl1.initialize();

  const repl2 = new StatedREPL();
  await repl2.initialize();

  try {
    let beenCalled1 = false;
    repl1.cliCore.onInit = () => {
      beenCalled1 = true;
    }
    let beenCalled2 = false;
    repl2.cliCore.onInit = () => {
      beenCalled2 = true;
    }
    await repl1.cliCore.init('-f "example/ex01.yaml"');
    expect(beenCalled1).toBe(true);
    expect(beenCalled2).toBe(false);

    await repl2.cliCore.init('-f "example/ex01.yaml"');
    expect(beenCalled2).toBe(true);
  }finally {
    repl1.close();
    repl2.close();
  }
});

// This test validates a bug when running an init command in StatedREPL overwrites context of provided TemplateProcessor
test("TemplateProcessor keeps context on init", async () => {
  const nozzle = (something) => "nozzle got some " + something;
  const context = {"nozzle": nozzle, "ZOINK": "ZOINK"}
  const tp = new TemplateProcessor({
    "a": "${$nozzle($ZOINK)}"
  }, context);
  const repl = new StatedREPL(tp);
  await repl.cliCore.init('-f "example/contextFunc.json"');
  expect(tp.output).toEqual(
    {
      "a": "nozzle got some ZOINK",
    }
  );
});

// Validates restore command
test("Extend CliCore with restore command", async () => {

  // ensure jest argv does not interfere with the test
  const originalCmdLineArgsStr = process.argv;
  process.argv = ["node", "dist/stated.js"]; // this is an argv when running stated.js repl.

  // extend CliCore with restore command
  const repl = new StatedREPL();

  try {
    await repl.initialize();

    // we call restore on the repl, which will expect it to be defined in CliCore.
    await repl.cli('restore', '-f example/restoreSnapshot.json');


    console.log(StatedREPL.stringify(repl.cliCore.templateProcessor.output));
    expect(repl.cliCore.templateProcessor.output).toBeDefined();
    expect(repl.cliCore.templateProcessor.output.count).toBeGreaterThanOrEqual(3); // should be 3 or more right after restoring from the snapshot
    expect(repl.cliCore.templateProcessor.output.count).toBeLessThan(10); // ... but less than 10


    while (repl.cliCore.templateProcessor.output.count < 10) { // validates that templateProcessor picks up where it was left in the snapshot.
      console.log("waiting for output.count to reach 10")
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    expect(repl.cliCore.templateProcessor.output.count).toBe(10);
  } finally {
    process.argv = originalCmdLineArgsStr;
    if (repl !== undefined) repl.close();
  }
});