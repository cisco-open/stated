const TemplateProcessor=require('./TemplateProcessor');
const DependencyFinder = require("./DependencyFinder");

test("test 1", async () => {
    const tp = new TemplateProcessor({
        "a":"aaa",
        "b":"${a}"
    });
    await tp.initialize();
    const received = [];
    tp.setDataChangeCallback("", (data, jsonPtr)=>{received.push({data, jsonPtr})});
    tp.setDataChangeCallback("/a", (data, jsonPtr)=>{received.push({data, jsonPtr})});
    tp.setDataChangeCallback("/b", (data, jsonPtr)=>{received.push({data, jsonPtr})});
    await tp.setData("/a", 42);
    expect(received).toEqual([
        {"data":42, "jsonPtr": "/a"},
        {"data":42, "jsonPtr":"/b"}
    ]);
});