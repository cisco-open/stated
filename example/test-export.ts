const barFunc = (input: string): string => `bar: ${input}`;

// explicitly define exported functions and their names
export const foo = (): string => "foo";
export const bar = barFunc;
export const __init = (templateProcessor: { setData: (path: string, value: string) => void }): void => {
    templateProcessor.setData("/messageFromInitFunction", "__init sidecar succeeded");
}
