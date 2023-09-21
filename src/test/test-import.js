import TemplateProcessor from "stated-js"

async function foo(){
    const t = new TemplateProcessor({"a":"hello", "b$":"a"});
    await t.initialize();
    console.log(JSON.stringify(t.output));
}

foo();