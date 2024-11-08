import TemplateProcessor, {FunctionGenerator} from "../TemplateProcessor.js";

export const accumulate = (array:any[],item:any):{sideEffect__:boolean, value:any[]} => {
        array.push(item);
        return { sideEffect__:true, value:array} //sideEffect__ is checked for and will trigger change handlers even though the returned value may be a pointer to an array that does not change when array is pushed to
}

/* this was the approach when push needed to be a generator function
export const push:FunctionGenerator<MetaInfo> = (metaInfo:MetaInfo, tp?:TemplateProcessor)=>{
    const {output} = tp as any;
    const {jsonPointer__} = metaInfo;
    return (item:any)=>{
        let array = jp.get(output, jsonPointer__) as any[];
        if (!Array.isArray(array)) {
            array = [];
            jp.set(output,jsonPointer__, array ); //initialize array as needed
        }
        array.push(item);
        return TemplateProcessor.SIDE_EFFECT;
    }
}
 */