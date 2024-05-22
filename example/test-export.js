const barFunc = (input) => `bar: ${input}`;

// explicitly define exported functions and their names
export const foo = () => "foo";
export const bar = barFunc;
export const __init = (templateProcessor) =>{
    templateProcessor.setData("/messageFromInitFunction", "__init sidecar succeeded");
}
