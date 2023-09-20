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
import StatedREPL from '../StatedREPL.js';

test("stringify default print function", async () => {
    const o = {"a": ["b", "c"], "d": false};
    const expectedResult = '{\n' +
        '  "a": [\n' +
        '    "b",\n' +
        '    "c"\n' +
        '  ],\n' +
        '  "d": false\n' +
        '}'
    const result = StatedREPL.stringify(o);
    expect(result).toEqual(expectedResult);
});

test("stringify custom print function", async () => {
    const o = {"a": ["b", "c"], "d": false};

    // Custom print function
    const printFunction = (key, value) => {
        if (Array.isArray(value)) {
            return "ARRAY";
        }
        if (value === false) {
            return "FALSE";
        }
        return value;
    }

    const expectedResult = '{\n' +
        '  "a": "ARRAY",\n' +
        '  "d": "FALSE"\n' +
        '}';

    const result = StatedREPL.stringify(o, printFunction);
    expect(result).toEqual(expectedResult);
});







