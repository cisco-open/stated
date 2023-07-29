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
const DependencyFinder = require('../DependencyFinder');

test('$$.aaa', () => {
    const df = new DependencyFinder('$$.aaa');
    expect(df.findDependencies()).toEqual([["$", 'aaa']]);
});

test('$merge($.a.b, $i)', () => {
    const df = new DependencyFinder('$merge($.a.b, $i)');
    expect(df.findDependencies()).toEqual([["", 'a', 'b']]);
});

test(`'$reduce(function($acc, $i){(x.y.z)})`, () => {
    const df = new DependencyFinder('$reduce(function($acc, $i){(\n' +
        '                            x.y.z\n' +
        '                       )})');
    expect(df.findDependencies()).toEqual([["x", "y", "z"]]);
});
test('reduce 2', () => {
    const df = new DependencyFinder('$reduce(function($acc, $i){(\n' +
        '                            $merge($.a.b, $i);\n' +
        '                            x.y.z\n' +
        '                       )})');
    expect(df.findDependencies()).toEqual([["", 'a', 'b'], ["x", "y", "z"]]);
});
test("transform - pattern should be ignored", () => {
    const program = `k.z~>|$|{'foo':nozzle~>|bingus|{"dingus":klunk}|, 'zap':$$.aaaa}|`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["k", "z"], ["$", "aaaa"]]);
});
test("z[zz]", () => {
    const program = `z[zz]`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["z", "zz"], ["z"]]);
});
test("k.z[zz].[poop]", () => {
    const program = `k.z[zz].[poop]`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "k",
            "z",
            "zz"
        ],
        [
            "k",
            "z",
            "poop"
        ],
        [
            "k",
            "z"
        ]
    ]);
});
test("k.z[zz='foo' and yy=a][xx+b = $$.c]", () => {
    const program = `k.z[zz='foo' and yy=a][xx+b = $$.c]`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "k",
            "z",
            "zz"
        ],
        [
            "k",
            "z",
            "yy"
        ],
        [
            "k",
            "z",
            "a"
        ],
        [
            "k",
            "z",
            "xx"
        ],
        [
            "k",
            "z",
            "b"
        ],
        [
            "$",
            "c"
        ],
        [
            "k",
            "z"
        ]
    ]);
});

test("[1..count][$=count]", () => {
    const program = "[1..count][$=count]"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["count"]]);
});

test("transform 1", () => {
    const program = `(                        
                        $gorp:=k.z[zz].[poop]~>|$|{'foo':nozzle~>|bingus|{"dingus":klunk}|, 'zap':$$.aaaa}|;                        
                        )`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "k",
            "z",
            "zz"
        ],
        [
            "k",
            "z",
            "poop"
        ],
        [
            "k",
            "z"
        ],
        [
            "$",
            "aaaa"
        ]
    ]);
});


test("variables 1", () => {
    const program = `a`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["a"]]);
});
test("variables 2", () => {
    const program = `a.b.c`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["a", "b", "c"]]);
});
test("variables 3", () => {
    const program = `(                        
                            $a:=zoink;                       
                        )`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["zoink"]]);
});
test("variables 4", () => {
    const program = `(                        
                        $b:=$gimp.zoink;                       
                        )`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([]);
});
test("variables 5", () => {
    const program = "i";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["i"]]);
});

test("complex program 1", () => {
    const program = `(                        
                        $gorp:=k.z[zz].[poop]~>|$|{'foo':nozzle~>|bingus|{"dingus":klunk}|, 'zap':$$.aaaa}|;
                        $dink:=doink;
                        $loop := $map($.a, function($i){(
                                $a:=22;
                                $b:=$gimp.zoink;
                            )});
                       $loop ~> $reduce(function($acc, $i){(
                            $merge($.a.b, $i);
                            x.y.z
                       )});  
                        )`
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "k",
            "z",
            "zz"
        ],
        [
            "k",
            "z",
            "poop"
        ],
        [
            "k",
            "z"
        ],
        [
            "$",
            "aaaa"
        ],
        [
            "doink"
        ],
        [
            "",
            "a"
        ],
        [
            "",
            "a",
            "b"
        ],
        [
            "x",
            "y",
            "z"
        ]
    ]);
});

test("subtract", () => {
    const program = "c-a-b"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["c"], ["a"], ["b"]]);
});

test("filter numeric predicate (array)", () => {
    const program = "a[0]"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["a", 0]]);
});
test("filter numeric predicate (array 2d)", () => {
    const program = "a[0][1]"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["a", 0, 1]]);
});

test("filter field predicate (array)", () => {
    const program = "a[z]"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "a",
            "z"
        ],
        [
            "a"
        ]
    ]);
});


test("$ filter numeric predicate", () => {
    const program = "$[0]"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["", 0]]);
});
test("$$ filter numeric predicate", () => {
    const program = "$$[0]"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["$", 0]]);
});
test("$$ filter numeric predicate 2d", () => {
    const program = "$$[0][1]"
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["$", 0, 1]]);
});

test("$[0][1] + $[2][3]", () => {
    const program = "$[0][1] + $[2][3]";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["", 0, 1], ["", 2, 3]]);
});

test("$[0][1][a]", () => {
    const program = "$[0][1][a]";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "",
            0,
            1,
            "a"
        ],
        [
            "",
            0,
            1
        ]
    ]);
});

test("$[0][1].a", () => {
    const program = "$[0][1].a";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "",
            0,
            1,
            "a"
        ]
    ]);
});

test("$[0][1].(a)", () => {
    const program = "$[0][1].a";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "",
            0,
            1,
            "a"
        ]
    ]);
});

test("$[0][1][a=b]", () => {
    const program = "$[0][1][a=b]";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "",
            0,
            1,
            "a"
        ],
        [
            "",
            0,
            1,
            "b"
        ],
        [
            "",
            0,
            1
        ]
    ]);
});

test("$[0][1].a", () => {
    const program = "$[0][1].a";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["", 0, 1, "a"]]);
});

test("$[0]($[1])", () => {
    const program = "$[0]($[1])";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([["", 1], ["", 0]]);
});

//we cannot note products.quantity and products.price cannot be inferred as dependencies. This is because we
//do not know from this expression if products is an object, or an array of objects
test("products.$sum(quantity * price)", () => {
    const program = "products.$sum(quantity * price)";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "products",
            "quantity"
        ],
        [
            "products",
            "price"
        ],
        [
            "products"
        ]
    ]);
});

test("$sum(quantity * price)", () => {
    const program = "$sum(quantity * price)";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "quantity"
        ],
        [
            "price"
        ]
    ]);
});

test("count.{'cloud.provider': $$.providerName}", () => {
    const program = "count.{'cloud.provider': $$.providerName}";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "$",
            "providerName"
        ],
        [
            "count"
        ]
    ]);
});

test("[1..count].{'cloud.provider': $$.providerName}", () => {
    const program = "[1..count].{'cloud.provider': $$.providerName}";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "count"
        ],
        [
            "$",
            "providerName"
        ]
    ]);
});

test("[1..count].{'database_instance.name':'MySQL instance' & $}", () => {
    const program = "[1..count].{'database_instance.name':'MySQL instance' & $}";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "count"
        ]
    ]);
});
test("[1..count][$=1]", () => {
    const program = "[1..count]";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "count"
        ]
    ]);
});
test("count.{'database_instance.host':'mysql-instance-' & $ & '.cluster-473653744458.us-west-2.rds.amazonaws.com'}", () => {
    const program = "count.{'database_instance.host':'mysql-instance-' & $ & '.cluster-473653744458.us-west-2.rds.amazonaws.com'}\n";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "count"
        ]
    ]);
});
test("count.{'cloud.provider': $$.providerName}", () => {
    const program = "count.{'cloud.provider': $$.providerName}";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "$",
            "providerName"
        ],
        [
            "count"
        ]
    ]);
});
//this is an interesting one. When the entire expression is a function, it is not something that should ever be
//evaluated more than once. In other words, if we hace ${ function($a){ $a+42}+$$.x} }  it does not matter if $$.x changes
//somewhere else in the template. This should not cause us to recompile the function.
test("top level function", () => {
    const program = "function($a){ $a+42 +$$.x+$.y*$foo}";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
        [
            "$",
            "x"
        ],
        [
            "",
            "y"
        ]
    ]);
});

test("data.duration.data[0].expression.[{\"name\": \"Duration\", \"data\": expression}]", () => {
    const program = "data.duration.data[0].expression.[{\"name\": \"Duration\", \"data\": expression}]";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual(
        [
            [
                "data",
                "duration",
                "data",
                0,
                "expression"
            ]
        ]);
});

test("$import('nozzle.com/boink.json')", () => {
    const program = "$import('nozzle.com/boink.json')";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual(
        [
        ]);
});
test("console.log", () => {
    const program = "$console.log(norad)";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual(
        [['norad']
        ]);
});



test("chained function", () => {
    const program = "function($urlArray){$fetch($urlArray~>$join('/')) ~> handleRes}";
    const df = new DependencyFinder(program);
    expect(df.findDependencies()).toEqual([
            [
                "handleRes"
            ]
        ]);
});












