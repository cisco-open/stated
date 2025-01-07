import TemplateProcessor from "../TemplateProcessor.js";

export class GeneratorManager{
    private templateProcessor: TemplateProcessor;


    constructor(templateProcessor: TemplateProcessor) {
        this.templateProcessor = templateProcessor;
    }

    /**
     * Generates an asynchronous generator that yields items from the provided input,
     * separated by the specified timeout, and automatically registers the generator.
     *
     * @param input The item or array of items to yield. If generate me is a function, the function is called to
     * get a result, and recursively passed to generate()
     * @param options {valueOnly:boolean, interval?:number}={valueOnly:true, interval:-1} by default the generator will
     * yield/return only the value and not the verbose {value, done} object that is yielded from a JS AsyncGenerator.
     * The interval parameter is used to temporally space the yielding of array values when input is an array. When input
     * is a function .or simple value, the interval is used to repeatedly call the function or yield the value
     * @returns The registered asynchronous generator.
     */
    public generate = (input: AsyncGenerator|any[]|any| (() => any),  options:{valueOnly:boolean, interval?:number, maxYield?:number}={valueOnly:true, interval:-1, maxYield:-1}): AsyncGenerator<any, any, unknown> => {
        if(input===undefined) {
            this.templateProcessor.logger.warn("undefined cannot be passed to a generator.");
        }
        if (this.templateProcessor.isClosed) {
            throw new Error("generate() cannot be called on a closed TemplateProcessor");
        }
        const {interval=-1, valueOnly=true, maxYield=-1} = options;
        if(maxYield === 0){
            throw new Error('maxYield must be greater than zero');
        }
        if(GeneratorManager.isAsyncGenerator(input)){ //wrapping an existing async generator
            input["valueOnly"] = options.valueOnly;   //in effect, annotate the generator with the options, so that down the pike we can determine if we should pump just the value, or the entire shebang
            return input
        }
        const timerManager = this.templateProcessor.timerManager;
        const tp = this.templateProcessor;
        let g;
        //yield array items separated by timeout
        if(Array.isArray(input)) {
            g = async function* () {
                let max = input.length;
                if(maxYield > 0){
                    max = Math.min(max, maxYield);
                }
                let i;
                for (i=0; i < max-1 && !tp.isClosed; i++) {
                    yield input[i];
                    if (interval >= 0) {
                        await new Promise<void>((resolve) => timerManager.setTimeout(resolve, interval));
                    }
                }
                return input[i]; //last item is returned, not yielded, so don't is true with last item
            }();
        }
        //call function and return result
        else if(typeof input === 'function'){
            g = async function*(){
                if(interval < 0){ //no interval so call function once
                    return await (input as ()=>any)();//return not yield, for done:true
                }else{ //an interval is specified so we sit in a loop calling the function
                    let count = 0;
                    while(!tp.isClosed && (maxYield < 0 || count++ < maxYield-1)){
                        const funcRes = await (input as ()=>any)();
                        yield funcRes;
                        await new Promise<void>((resolve) => timerManager.setTimeout(resolve, interval));
                    }
                    if(tp.isClosed){
                        return null; //bail early
                    }
                    return await (input as ()=>any)();
                }
            }();
        }else {
            //yield individual item
            g = async function* () {
                if(interval < 0){ //no interval
                    return input; //return not yield, for done:true
                }else{
                    //interval is not supported for ordinary value as this will pump a duplicate same value over and over which will be deduped and ignored anyway
                    throw new Error("$generate cannot be used to repeat the same value on an 'interval' since Stated would simply dedup/ignore the repeated values.");
                }
            }();
        }
        (g as any)["valueOnly"] = valueOnly;
        return g;
    };

    /**
     * Checks if the provided object is a generator (synchronous or asynchronous).
     *
     * @param obj The object to check.
     * @returns `true` if the object is a generator; otherwise `false`.
     */
    public static isAsyncGenerator(obj: any): boolean {
        if (obj == null) return false;
        if (typeof obj.next === 'function' && typeof obj[Symbol.asyncIterator] === 'function') {
            return true;
        }
        return false;
    }


    /**
     * Pumps the remaining items (after the first item) from the generator into the TemplateProcessor.
     * Automatically returns the first item.
     *
     * @param generator The generator to pump items from.
     * @param metaInfo The meta info for processing.
     * @param templateProcessor The TemplateProcessor to set data in.
     * @returns The first generated item wrapped as {value, done, return}
     */
    public async pumpItems(
        generator: AsyncGenerator,
        metaInfo: any,
        templateProcessor: any
    ): Promise<any> {
        const {valueOnly=true} = generator as any;
        const first = await generator.next(); // Get the first item from the generator
        const {done} = first;
        if(!done) {
            if (GeneratorManager.isAsyncGenerator(generator)) {
                // Handle asynchronous generator. Do not await, because we want items to be pumped into the template async.
                // Also, fear not, pumpItems can only queue items which will queue the remaining items which won't be
                //drained out of the queue until the item returned by this method has been processed
                void this.pumpRemaining(generator, metaInfo, templateProcessor);
            } else {
                // Handle synchronous generator
                throw new Error('The provided generator is not an AsynchronousGenerator, it is a `{typeof generator}`}.');
            }
        }
        return valueOnly?first.value: {...first,  return: TemplateProcessor.wrapInOrdinaryFunction(generator.return.bind(generator))};
    }

    /**
     * Handles asynchronous generators, pumping remaining values into the template processor.
     */
    private async pumpRemaining(
        generator: AsyncGenerator<any, void, unknown>,
        metaInfo: any,
        templateProcessor: any
    ): Promise<void> {
        while (true) {
            try {
                const result = await generator.next();
                const {valueOnly=true} = generator as any;
                const { value, done } = result;

                // Create an object that includes value, done, and the return function
                const item = valueOnly?value:{
                    value,
                    done,
                    return: TemplateProcessor.wrapInOrdinaryFunction(generator.return.bind(generator))
                };
                //done with undefined value indicates generator function has finished without an explicit return value
                if(done && item===undefined){
                    break;
                }

                // Pass the entire item object to setData
                await templateProcessor.setData(metaInfo.jsonPointer__ as string, item, "forceSetInternal");

                // Break the loop if the generator is done
                if (done) break;
            } catch (error: any) {
                if (error.message.startsWith("Attempt to setData on a closed TemplateProcessor.")) {
                    await generator.return();
                    break;
                }
                throw error;
            }
        }
    }

}
