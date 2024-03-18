// Copyright 2023 Cisco Systems, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import jsonata from "jsonata";
import { default as jp } from './JsonPointer.js';

export interface MetaInfo{
    materialized__:boolean,
    jsonPointer__: JsonPointerStructureArray|JsonPointerString;
    parent__:JsonPointerStructureArray|JsonPointerString;
    dependees__:JsonPointerStructureArray[]|JsonPointerString[];
    dependencies__:JsonPointerStructureArray[]|JsonPointerString[];
    absoluteDependencies__:JsonPointerStructureArray[]|JsonPointerString[];
    treeHasExpressions__: boolean;
    tags__:Set<string>;
    exprRootPath__?: string;
    expr__?: string;
    compiledExpr__?: jsonata.Expression;
    temp__?:boolean; //temp field indicates this field is !${...} and will be removed after template is processed
    exprTargetJsonPointer__?:JsonPointerStructureArray|JsonPointerString //the pointer to the object that this expression executes on
    data__?:any
    isFunction__?:boolean
}

export type JsonPointerStructureArray = (string|number)[];
export type JsonPointerString = string;

export default class MetaInfoProducer {
    public static EMBEDDED_EXPR_REGEX = new RegExp(
        '\\s*' +                    // Match optional whitespace
        '(?:(@(?<tag>\\w+))?\\s*)' +   // Match the 'tag' like @DEV or @TPC on an expression
        '(?:(?<tempVariable>!)?\\s*)' +    // Match the ! symbol which means 'temp variable'
        '(?:(?<slashslash>\\/\\/)|(?<slash>\\/)|(?<relativePath>(\\.\\.\\/)+))?' + // Match a forward slash '/' or '../' to represent relative paths
        '\\$\\{' +                 // Match the literal characters '${'
        '(?<jsonataExpression>[\\s\\S]+)' + // Match one or more of any character. This is the JSONata expression/program (including newline, to accommodate multiline JSONata).
        '\\}' +                    // Match the literal character '}'
        '\\s*$'
    );


    static async getMetaInfos(template):Promise<MetaInfo[]> {

        const stack: MetaInfo[] = [];
        const emit: MetaInfo[] = [];

        async function getPaths(o, path: JsonPointerStructureArray = [], isTemp=false) {
            const type = typeof o;
            const metaInfo: MetaInfo = {
                "materialized__": true,
                "jsonPointer__": path,
                "dependees__": [],
                "dependencies__": [],
                "absoluteDependencies__": [],
                "treeHasExpressions__": false,
                "tags__": new Set(),
                "parent__": jp.parent(path),
                "temp__": isTemp
            };
            stack.push(metaInfo);
            if (Array.isArray(o)) {
                for (let idx = 0; idx < o.length; idx++) {
                    const nextPath = path.concat(idx);
                    await getPaths(o[idx], nextPath);
                }
            } else if (type === 'object') {
                for (const key in o) {
                    const _isTemp = key.endsWith('!');
                    const v = o[key];
                    const nextPath = path.concat(key);
                    await getPaths(v, nextPath, _isTemp);
                }
            } else {
                const match = MetaInfoProducer.EMBEDDED_EXPR_REGEX.exec(o);
                const getMatchGroup = (groupName) => match && match.groups[groupName];

                const keyEndsWithDollars = typeof path[path.length - 1] === 'string' && String(path[path.length - 1]).endsWith('$');
                const tag = getMatchGroup('tag');
                const exclamationPoint = !!getMatchGroup('tempVariable');
                const leadingSlashSlash = getMatchGroup('slashslash');
                const leadingSlash = getMatchGroup('slash');
                const leadingCdUp = getMatchGroup('relativePath');
                const slashOrCdUp = leadingSlashSlash || leadingSlash || leadingCdUp;
                const expr = keyEndsWithDollars ? o : getMatchGroup('jsonataExpression');
                const hasExpression = !!match || keyEndsWithDollars;

                if (hasExpression) {
                    stack[stack.length - 1] = {
                        ...metaInfo,
                        "exprRootPath__": slashOrCdUp,
                        "expr__": expr,
                        "exprTargetJsonPointer__": jp.parent(path)
                    };
                    if (tag) {
                        stack[stack.length - 1].tags__.add(tag);
                    }
                    //if the expression is like '! /${...}'
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
        /* this is an optimization that may eventually be important to get to
        // Prune subtrees with treeHasExpressions__ = false
        const prunedMetaInfos = fullResult.metaInfos.filter(info => info.treeHasExpressions__);

        return prunedMetaInfos;

         */
    }
}

