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
import TemplateProcessor from "../../dist/src/TemplateProcessor.js";

test("mouse move", async () => {
    const tp = new TemplateProcessor({
       "x":-1,
        "y": -1,
        "zap$": "'mouse at x:'&x&', y:'&y",
        "z0$":"zap$",
        "z1$":"z0$",
        "z2$":"z1$&z0$",
    });
    await tp.initialize();
    let callCount = 0;
    tp.setDataChangeCallback("/z2$", (v)=>{
        callCount++
    });
    let i;
    const startTime = performance.now();
    const MAX = 10000;
    for(i=0;i<MAX;i++){
        await tp.setData("/x", i);
    }
    const endTime = performance.now();
    const elapsedTime = endTime - startTime;
    const avgTime = elapsedTime/MAX;
    console.log(`Elapsed time: ${elapsedTime} milliseconds. Avg time = ${avgTime}`);
    expect(callCount).toEqual(i);
});