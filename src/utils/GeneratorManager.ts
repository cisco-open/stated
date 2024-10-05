import TemplateProcessor from "../TemplateProcessor.js";

export class GeneratorManager{
    private templateProcessor: TemplateProcessor;


    constructor(templateProcessor: TemplateProcessor) {
        this.templateProcessor = templateProcessor;
    }

    /**
     * Generates an asynchronous generator that yields items from the provided array,
     * separated by the specified timeout, and automatically registers the generator.
     *
     * @param array The array of items to yield.
     * @param timeout The delay in milliseconds between yields. Defaults to 0.
     * @returns The registered asynchronous generator.
     */
    public generate = (array: any[], timeout: number = 0): AsyncGenerator<any, void, unknown> => {
        if (this.templateProcessor.isClosed) {
            throw new Error("generate() cannot be called on a closed TemplateProcessor");
        }
        const timerManager = this.templateProcessor.timerManager;

        const generator = async function* () {
            for (let i = 0; i < array.length; i++) {
                yield array[i];
                if (timeout > 0 && i < array.length - 1) {
                    await new Promise<void>((resolve) => timerManager.setTimeout(resolve, timeout));
                }
            }
        }();
        return generator;
    };



    /**
     * Extracts the first item from a generator, whether it is synchronous or asynchronous.
     * Automatically registers the generator.
     *
     * @param gen The generator (sync or async) to extract the first item from.
     * @returns A promise that resolves to the first item or `undefined` if empty.
     */
    public async firstItem(gen: AsyncGenerator | Generator): Promise<any> {
        if (!GeneratorManager.isGenerator(gen)) {
            throw new Error('The provided generator is not an AsynchronousGenerator, it is a `{typeof generator}`}.');
        }

        const asyncGen = gen as AsyncGenerator;
        const result = await asyncGen.next();
        return result.done ? undefined : result.value;
    }

    /**
     * Checks if the provided object is a generator (synchronous or asynchronous).
     *
     * @param obj The object to check.
     * @returns `true` if the object is a generator; otherwise `false`.
     */
    public static isGenerator(obj: any): boolean {
        if (obj == null) return false;
        if (typeof obj.next === 'function' && typeof obj[Symbol.asyncIterator] === 'function') {
            return true;
        }
        return false;
    }

    /**
     * Pumps the remaining items from the generator into the TemplateProcessor.
     * Automatically registers the generator and returns the first item.
     *
     * @param generator The generator to pump items from.
     * @param metaInfo The meta info for processing.
     * @param templateProcessor The TemplateProcessor to set data in.
     * @returns The first generated item.
     */
    public async pumpItems(
        generator: AsyncGenerator | Generator,
        metaInfo: any,
        templateProcessor: any
    ): Promise<any> {
        const first = await this.firstItem(generator);  // Get the first item from the generator
        // Check if the generator is asynchronous
        if (this.isAsyncGenerator(generator)) {
            // Handle asynchronous generator. Do not await, because we want items to be pumped into the template async
            void this.handleAsyncGenerator(generator, metaInfo, templateProcessor);
        } else {
            // Handle synchronous generator
            throw new Error('The provided generator is not an AsynchronousGenerator, it is a `{typeof generator}`}.');
        }

        return first;
    }

    /**
     * Handles asynchronous generators, pumping values into the template processor.
     */
    private async handleAsyncGenerator(
        generator: AsyncGenerator<any, void, unknown>,
        metaInfo: any,
        templateProcessor: any
    ): Promise<void> {
        for await (const item of generator) {
            try {
                await templateProcessor.setData(metaInfo.jsonPointer__ as string, item, "forceSetInternal");
            }catch(error:any){
                if(error.message === "Attempt to setData on a closed TemplateProcessor."){
                    await generator.return();
                    break;
                }
                throw error;
            }
        }
    }


    /**
     * Determines if a generator is asynchronous.
     */
    private isAsyncGenerator(generator: any): generator is AsyncGenerator {
        return typeof generator[Symbol.asyncIterator] === 'function';
    }


}
