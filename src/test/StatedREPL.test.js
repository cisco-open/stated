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
  const repl2 = new StatedREPL();

  let beenCalled1 = false;
  repl1.cliCore.onInit = () => { beenCalled1 = true;}
  let beenCalled2 = false;
  repl2.cliCore.onInit = () => { beenCalled2 = true;}
  await repl1.cliCore.init('-f "example/ex01.yaml"');
  expect(beenCalled1).toBe(true);
  expect(beenCalled2).toBe(false);

  await repl2.cliCore.init('-f "example/ex01.yaml"');
  expect(beenCalled2).toBe(true);
});


test("test wait condition", async () => {
  const repl = new StatedREPL();

  await repl.cliCore.init('-f "example/ex01.yaml"');
  const result = await repl.cliCore.wait(`-w 'c="the answer is: 42" -t 50`);
  expect(StatedREPL.stringify(result)).toBe(StatedREPL.stringify({
    "a": 42,
    "b": 42,
    "c": "the answer is: 42"
  }));
});

test("test wait condition timeout", async () => {
  const repl = new StatedREPL();

  await repl.cliCore.init('-f "example/ex14.yaml"');
  const result = await repl.cliCore.wait(`-w 'status$="done" -t 10`);
  expect(result.error.message).toBe("wait condition status$=\"done\" timed out in 10ms");
});
