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

import path from "path";
import os from "os";
import CliCore from "../../dist/src/CliCore.js";

const homeDir = os.homedir();

const testCases = [
  {
    filePath: "file/Path",
    importPath: undefined,
    expected: path.resolve(process.cwd(), "file/Path"),
    description: "should resolve a relative filePath"
  },
  {
    filePath: "file/Path",
    importPath: "import/Path",
    expected: path.resolve(process.cwd(), "import/Path", "file/Path"),
    description: "should resolve a relative import path with both filePath and importPath"
  },
  {
    filePath: "file/Path",
    importPath: "/import/Path",
    expected: path.resolve("/", "import/Path", "file/Path"),
    description: "should resolve an absolute import path"
  },
  {
    filePath: "file/Path",
    importPath: "~/import/Path",
    expected: path.resolve(homeDir, "import/Path", "file/Path"),
    description: "should resolve a tilde in importPath with filePath"
  },
  {
    filePath: "~/file/Path",
    importPath: undefined,
    expected: path.resolve(homeDir, "file/Path"),
    description: "should resolve a tilde in filePath"
  },
  {
    filePath: "/absolute/file/Path",
    importPath: undefined,
    expected: "/absolute/file/Path",
    description: "should return absolute filePath as is"
  }
];

testCases.forEach(({ filePath, importPath, expected, description }) => {
  test(description, async () => {
    expect(path.normalize(CliCore.resolveImportPath(filePath, importPath))).toBe(path.normalize(expected));
  });
});

const errorTestCases = [
  {
    filePath: "~file/Path",
    importPath: "/import/Path",
    error: "Cannot use file path starting with '~' with importPath",
    description: "should throw error when tilde is in filePath and importPath is present"
  },
  {
    filePath: "/file/Path",
    importPath: "/import/Path",
    error: "Cannot use file path starting with '/' with importPath",
    description: "should throw error when filePath starts with '/' and importPath is present"
  },
  {
    filePath: null,
    importPath: undefined,
    error: "filepath is required",
    description: "should throw error when filepath is not provided"
  }
];

errorTestCases.forEach(({ filePath, importPath, error, description }) => {
  test(description, async () => {
    expect(() => CliCore.resolveImportPath(filePath, importPath)).toThrowError(error);
  });
});

// Note: Since Jest runs in a Node environment, simulating a browser environment
// could be more complex. However, you could use jest.mock or another approach to
// simulate this behavior.

test("should return filepath as is when not in Node environment", () => {
  const originalProcess = global.process;
  global.process = undefined;

  const filePath = "some/file/Path";
  expect(CliCore.resolveImportPath(filePath)).toBe(filePath);

  global.process = originalProcess;
});

test("tail", async () => {
  const cliCore = new CliCore();
  const res = await cliCore.init('-f example/tail.json --tail "/counter 5"');
  expect(res).toStrictEqual({
    "__tailed": true,
    "data": 5
  });
  await cliCore.close();
});

test("xf", async () => {
  const cliCore = new CliCore();
  const res = await cliCore.init('.init -f "example/useEnv.json" --xf=example/env.json');
  expect(res).toStrictEqual({
    "name": "Dr. Stephen Falken",
    "address": "Goose Island, OR, USA"
  });
  await cliCore.close();
});

test("import JS", async () => {
  const cliCore = new CliCore();
  const res = await cliCore.init('.init -f example/importJS.json --xf=example/test-export.js');
  expect(res).toStrictEqual({
    "messageFromInitFunction": "__init sidecar succeeded",
    "res": "bar: foo"
  });
  await cliCore.close();
});

test("import and run __init function", async () => {

  let resolve;
  let reject;
  const promise = new Promise((r, rej)=>{
    resolve = r;
    reject = rej;
  });
  let cliCore = new CliCore();
  const res = await cliCore.init('.init -f example/importJS.json --xf=example/test-export.js');

  let count=0;
  const x = setInterval(()=>{
    if(count++>20){
     reject();
    }
    const {messageFromInitFunction=undefined} = cliCore.templateProcessor.output;
    if(messageFromInitFunction !== undefined){
      resolve();
      expect(messageFromInitFunction).toBe("__init sidecar succeeded");
    }
  }, 1)
  try {
    await promise;
  }finally {
    await cliCore.close();
   clearInterval(x);
  }
});




