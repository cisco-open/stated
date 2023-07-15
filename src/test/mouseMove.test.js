const TemplateProcessor = require("../TemplateProcessor");
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