// Individual elements of the regex with comments
const EMBEDDED_EXPR_REGEX_STR = //used to test a string and see if it is of form ${<JSONata>}, that is to say a jsonata program inside dollars-moustache
    '\\s*' +              // Match optional whitespace
    '(@(\\w+))?\\s*' +       // Math the 'tag' like @DEV or @TPC on an expression
    '((\\/)|((\\.\\.\\/)*))' + // Match a forward slash '/' or '../' to represent relative paths
    '\\$\\{' +            // Match the literal characters '${'
    '([\\s\\S]+)' +       // Match one or more of any character. This is the JSONata expression/program (including newline, to accommodate multiline JSONata).\s\S is a little trick for capturing everything inclusing newline
    '\\}' +               // Match the literal character '}'
    '\\s*$';              // Match optional whitespace



// Create the regex using the RegExp constructor
const EMBEDDED_EXPR_REGEX = new RegExp(EMBEDDED_EXPR_REGEX_STR);
async function getMetaInfos(template) {

    const stack = [];
    const emit = [];
    async function getPaths(o, path=[]) {
        const type = typeof o;
        const metaInfo = {
            "materialized__": true,
            "jsonPointer__": path,
            "dependees__": [],
            "dependencies__": [],
            "treeHasExpressions__": false,
            "tags__": new Set()
        };
        stack.push(metaInfo);
        if (Array.isArray(o)) {
            for (let idx = 0; idx < o.length; idx++) {
                const nextPath = path.concat(idx);
                await getPaths(o[idx], nextPath);
            }
        } else if (type === 'object') {
            for (const key in o) {
                const v = o[key];
                const nextPath = path.concat(key);
                await getPaths(v, nextPath);
            }
        } else {
            const match = EMBEDDED_EXPR_REGEX.exec(o);
            const keyEndsWithDollars = typeof path[path.length - 1] === 'string' ? path[path.length - 1].endsWith('$') : null;
            const tag = match ? match[2] : null;
            const leadingSlash = match ? match[3] : null;
            const leadingCdUp = match ? match[4] : null;
            const slashOrCdUp = leadingSlash || leadingCdUp;
            const expr = keyEndsWithDollars ? o : (match ? match[7] : null);
            const hasExpression = match || keyEndsWithDollars;

            if (hasExpression) {
                stack[stack.length-1]={
                    ...metaInfo,
                    "materialized__": true,
                    "exprRootPath__": slashOrCdUp,
                    "expr__": expr,
                    "jsonPointer__": path,
                };
                if(tag){
                    stack[stack.length-1].tags__.add(tag);
                }
                //the stack now holds the path from root of object graph to this node. If this node has an expression,
                //then every node up to the root we set treeHasExpressions=true
                stack.forEach(metaInfo=>metaInfo.treeHasExpressions__=true);
            }
        }
        emit.push(stack.pop());
    }

    await getPaths(template);
    return emit;
    /*
    // Prune subtrees with treeHasExpressions__ = false
    const prunedMetaInfos = fullResult.metaInfos.filter(info => info.treeHasExpressions__);

    return prunedMetaInfos;

     */
}
module.exports = getMetaInfos;
