// Create the regex using the RegExp constructor


export default class MetaInfoProducer {
    static EMBEDDED_EXPR_REGEX = new RegExp(
        '\\s*' +                    // Match optional whitespace
        '(?:(@(?<tag>\\w+))?\\s*)' +   // Match the 'tag' like @DEV or @TPC on an expression
        '(?:(?<tempVariable>!)?\\s*)' +    // Match the ! symbol which means 'temp variable'
        '(?:(?<slash>\\/)|(?<relativePath>(\\.\\.\\/)+))?' + // Match a forward slash '/' or '../' to represent relative paths
        '\\$\\{' +                 // Match the literal characters '${'
        '(?<jsonataExpression>[\\s\\S]+)' + // Match one or more of any character. This is the JSONata expression/program (including newline, to accommodate multiline JSONata).
        '\\}' +                    // Match the literal character '}'
        '\\s*$'
    );


    static async getMetaInfos(template) {

        const stack = [];
        const emit = [];

        async function getPaths(o, path = []) {
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
                const match = MetaInfoProducer.EMBEDDED_EXPR_REGEX.exec(o);
                const getMatchGroup = (groupName) => match && match.groups[groupName];

                const keyEndsWithDollars = typeof path[path.length - 1] === 'string' && path[path.length - 1].endsWith('$');
                const tag = getMatchGroup('tag');
                const exclamationPoint = !!getMatchGroup('tempVariable');
                const leadingSlash = getMatchGroup('slash');
                const leadingCdUp = getMatchGroup('relativePath');
                const slashOrCdUp = leadingSlash || leadingCdUp;
                const expr = keyEndsWithDollars ? o : getMatchGroup('jsonataExpression');
                const hasExpression = !!match || keyEndsWithDollars;

                if (hasExpression) {
                    stack[stack.length - 1] = {
                        ...metaInfo,
                        "materialized__": true,
                        "exprRootPath__": slashOrCdUp,
                        "expr__": expr,
                        "jsonPointer__": path,
                    };
                    if (tag) {
                        stack[stack.length - 1].tags__.add(tag);
                    }
                    if (exclamationPoint) {
                        stack[stack.length - 1].temp__ = true
                    }
                    //the stack now holds the path from root of object graph to this node. If this node has an expression,
                    //then every node up to the root we set treeHasExpressions=true
                    stack.forEach(metaInfo => metaInfo.treeHasExpressions__ = true);
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
}

