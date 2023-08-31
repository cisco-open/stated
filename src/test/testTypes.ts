import TemplateProcessor from "../TemplateProcessor";

(async () => {
    // Instantiate the class
    const processor:TemplateProcessor = new TemplateProcessor({
        "a": "aaa",
        "b": "${a}"
    });

    // Use some methods
    const input = processor.input;
    const output = processor.output;
    const meta = processor.templateMeta;

    await processor.initialize();

    // Test the callback method
    const received = [];
    processor.setDataChangeCallback("/a", (data, jsonPtr) => {
        received.push({data, jsonPtr});
        console.log(JSON.stringify({data, jsonPtr}));
    });
    processor.setDataChangeCallback("/b", (data, jsonPtr) => {
        received.push({data, jsonPtr});
        console.log(JSON.stringify({data, jsonPtr}));
    });
    await processor.setData("/a", 42);

    // Log some details
    console.log(JSON.stringify(received));
})();
