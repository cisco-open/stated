// Copyright 2022 Cisco Systems, Inc.
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

const EMBEDDED_EXPR_REGEX = //used to test a string and see if it is of form ${<JSONata>}, that is to say a jsonata program inside dollars-moustache
    '\\s*' +              // Match optional whitespace
    '((\\/)|((\\.\\.\\/)*))' + // Match a forward slash '/' or '../' to represent relative paths
    '\\$\\{' +            // Match the literal characters '${'
    '([\\s\\S]+)' +       // Match one or more of any character. This is the JSONata expression/program (including newline, to accommodate multiline JSONata).\s\S is a little trick for capturing everything inclusing newline
    '\\}' +               // Match the literal character '}'
    '\\s*$';              // Match optional whitespace
module.exports = `
(   $setInfo := function($acc, $metaInfo, $flags){(
        $acc~>|$|{
                    "metaInfos":metaInfos~>$append($metaInfo~>|$|{"treeHasExpressions__":$flags.treeHasExpressions__}|),
                    "flags":flags~>|$|{"treeHasExpressions__":($acc.flags.treeHasExpressions__ or $flags.treeHasExpressions__)}|
                }|;   
    )};
    $getPaths := function($o, $acc, $path){
     (                              
                $type($o)="array"
                ?(  $flags := $acc.flags;   /*save flags before recurse into subtree*/
                    $acc := $acc~>|flags|{"treeHasExpressions__":false}|; /*init to false upon descending)*/
                    $acc := $o~>$reduce(function($acc, $v, $idx){
                        $getPaths($v, $acc, $append($path, $idx))
                    }, $acc);
                    $flags:=$flags~>|$|{"treeHasExpressions__":($acc.flags.treeHasExpressions__ or $flags.treeHasExpressions__)}|;
                    $setInfo($acc, { "materialized__": true, "jsonPointer__": $path, "dependees__": [], "dependencies__": []},$flags);
                )
                :$type($o)="object"
                    ?(  $flags := $acc.flags; 
                        $acc := $acc~>|flags|{"treeHasExpressions__":false}|; /*init to false upon descending)*/
                        $acc := $spread($o)?$spread($o)~>$reduce(function($acc, $kv){
                            (
                                $k := $keys($kv)[0];
                                $v := $lookup($kv, $k);
                                $nextPath := $append($path, $k);
                                $getPaths($v, $acc, $nextPath)
                            )
                        }, $acc):$acc;
                        $flags:=$flags~>|$|{"treeHasExpressions__":($acc.flags.treeHasExpressions__ or $flags.treeHasExpressions__)}|;
                        $setInfo($acc, { "materialized__": true,"jsonPointer__": $path, "dependees__": [], "dependencies__": []},$flags);
                    )
    
                    :(
                        $match := /${EMBEDDED_EXPR_REGEX}/($o); /* */
                        $keyEndsWithDollars := $type($path[-1])='string'?$path[-1]~>$contains(/\\$/):null; /* let's allow keys that end with '$' to tell us it's an expression in addition to dollars moustache */
                        $leadingSlash := $match[0].groups[1];
                        $leadingCdUp := $match[0].groups[2];
                        $slashOrCdUp := $leadingSlash ? $leadingSlash : $leadingCdUp;
                        $expr := $keyEndsWithDollars?$o:$match[0].groups[4];                         
                        $match or $keyEndsWithDollars
                                ? $setInfo($acc, { "materialized__": true,"exprRootPath__":$slashOrCdUp, "expr__": $expr, "jsonPointer__": $path, "dependees__": [], "dependencies__": []}, {"treeHasExpressions__":true})
                                : $setInfo($acc, { "materialized__": true,"jsonPointer__": $path, "dependees__": [], "dependencies__": []},{"treeHasExpressions__":false})
                    )
      ) }; 
    $getPaths($, {"metaInfos":[],"flags":{"treeHasExpressions__":false}}, []).metaInfos; 
)`;