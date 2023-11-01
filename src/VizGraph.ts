/**
 * Convert an array of MetaInfo objects into DOT notation for graph representation.
 * @param metaInfos - Array of MetaInfo objects
 * @returns DOT notation string
 */
import TemplateProcessor from "./TemplateProcessor.js";
import {default as jp} from "./JsonPointer.js"
export default class VizGraph {
    public static dot(tp: TemplateProcessor) {
        const metaInfos = tp.metaInfoByJsonPointer['/'];
        let dotString = `digraph MetaInfoGraph {\n`;
        dotString += '    node [fontname="Arial", fontsize=12];\n'; // Set default node font
        const bgColor = "#282a36";
        dotString += `    bgcolor="${bgColor}";`; // Dracula background color

        for (let metaInfo of metaInfos) {
            let sourcePointer = metaInfo.jsonPointer__;

            // Skip nodes with an empty jsonPointer__
            if (sourcePointer === "") {
                continue;
            }

            // Convert data__ based on its type
            let dataPreview = "undefined";
            let data;
            if(metaInfo.temp__ === true){
                dataPreview = "--REMOVED (! var)--"
            }else if(jp.has(tp.output, metaInfo.jsonPointer__)){
                data = jp.get(tp.output, metaInfo.jsonPointer__);
                if (typeof data === 'object' && data !== null) {
                    dataPreview = Array.isArray(data) ? '[...]' : '{...}';
                } else if (data !== undefined) {
                    dataPreview = String(data).substr(0, 10);
                }
            }else{
                dataPreview = "--WARNING: data not found--";
            }

            // Color and style logic
            let fillColor = '#e2dfdf'; // Muted gray
            let fontColor = '#44475a'; // Dracula comment color
            let style = "filled"
            if (!metaInfo.materialized__) {
                fillColor = '#ffb86c'; // Muted gold
                style = style + ",dashed";
            } else if (metaInfo.expr__) {
                fillColor = '#87c095'; // Muted green
                fontColor = '#f8f8f2'; // Dracula foreground color
            }

            // Node label
            let label = `${sourcePointer}\nData: ${dataPreview}`;
            if (metaInfo.expr__) {
                label += `\n$\{${metaInfo.expr__}\}`; // Display expression within ${}
            }
            dotString += `    "${sourcePointer}" [label="${label}", style="${style}", fillcolor="${fillColor}", fontcolor="${fontColor}" ];\n`;
        }

        for (let metaInfo of metaInfos) {
            const sourcePointer = metaInfo.jsonPointer__;

            // Add dependencies__ edges
            for (let dependency of metaInfo.absoluteDependencies__) {
                const targetPointer = dependency;
                dotString += `    "${sourcePointer}" -> "${targetPointer}" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];\n`; // Dracula purple
            }

            /*
            // Add dependees__ edges
            for (let dependee of metaInfo.dependees__) {
                const targetPointer = dependee;
                dotString += `    "${sourcePointer}" -> "${targetPointer}" [label="dependee", color="#ff79c6", fontcolor="#ff79c6"];\n`; // Dracula pink
            }

             */

            // Add parentJsonPointer__ edge
            if (metaInfo.parent__) {
                const parentPointer = metaInfo.parent__;
                dotString += `    "${sourcePointer}" -> "${parentPointer}" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];\n`; // Dracula cyan
            }
        }

        dotString += '}\n';
        return dotString;
    }
}
