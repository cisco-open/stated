# JEEP: JSONata Embedded Expression Processor
<img src="https://cdn.pixabay.com/photo/2021/05/13/08/16/jeep-6250207_1280.png" alt="Jeep" width="300">


JEEP, or JSONata Embedded Expression Processor, is a library and CLI for running JSON files with embedded
[JSONata](http://docs.jsonata.org/) programs.
```bash
ghendrey$ jeep.js
> .init -f "example/hello.json"
{
"to": "world",
"msg": "${'hello ' & to}"
}
> .out
{
"to": "world",
"msg": "hello world"
}
````

## Getting Started

1. **Installation**: Clone the repo
```bash
git clone ssh://git@bitbucket.corp.appdynamics.com:7999/arch/templates.git;
cd templates
```
3. then install JEEP by running the following command:

```bash
yarn install
````

2. **Start JEEP**: Once installed, you can start using JEEP by running the following command:

```bash
node jeep.js
````

If your environment is set up correctly with the path for Node.js, you can simply run this command to
start the jeep REPL:

```bash
./jeep.js
````
## CLI Commands

JEEP provides a set of CLI commands to interact with the system:

JEEP Commands:
- **.init**: Initialize the template.
- **.set**: Set data to a JSON pointer path.
- **.in**: Show the input template.
- **.out**: Show the current state of the template.
- **.state**: Show the current state of the templateMeta.
- **.from**: Show the dependents of a given JSON pointer.
- **.to**: Show the dependencies of a given JSON pointer.


## Expressions
JEEP allows expressions to be embedded in a JSON document using `${}` syntax. You can use expressions in fields or arrays.
The content between `${}` can be any valid JSONata program. The JEEP repl lets you experiment with templates.
```bash
> .init -f "example/ex09.json"
{
  "a": [
    0,
    1,
    "${ $[0] + $[1] }"
  ]
}
> .out
{
  "a": [
    0,
    1,
    1
  ]
}

```
### Expression Scope
What is the input to the JSONata program? The input, by default, is the object or array that the expression resides in. 
In the example **above**, you can see that the JSONata `$` variable refers to the array itself. Therefore, expressions like `$[0]`
refer to the first element of the array. 

## Complex Data Processing
The example below uses JSONata `$zip` function to combine related data.
```bash
> .init -f "example/ex03.json"
{
  "data": {
    "fn": [
      "john",
      "jane"
    ],
    "ln": [
      "doe",
      "smith"
    ]
  },
  "names": "${ $zip(data.fn, data.ln) }"
}
> .out
{
  "data": {
    "fn": [
      "john",
      "jane"
    ],
    "ln": [
      "doe",
      "smith"
    ]
  },
  "names": [
    [
      "john",
      "doe"
    ],
    [
      "jane",
      "smith"
    ]
  ]
}
```
The example below uses the `$sum` function to compute a total cost of 
```bash
> .init -f "example/ex10.json"
{
  "totalCost": "${$sum(costs)}",
  "costs": "${products.$sum(quantity * price)}",
  "products": [
    {
      "name": "Apple",
      "quantity": 5,
      "price": 0.5,
      "cost": "/${totalCost[0]}"
    },
    {
      "name": "Orange",
      "quantity": 10,
      "price": 0.75,
      "cost": "/${totalCost[1]}"
    },
    {
      "name": "Banana",
      "quantity": 8,
      "price": 0.25,
      "cost": "/${totalCost[2]}"
    }
  ]
}
> .plan
[
  "/costs",
  "/totalCost",
  "/products/0/cost",
  "/products/1/cost",
  "/products/2/cost"
]
> .out
{
  "totalCost": 12,
  "costs": [
    2.5,
    7.5,
    2
  ],
  "products": [
    {
      "name": "Apple",
      "quantity": 5,
      "price": 0.5,
      "cost": 12
    },
    {
      "name": "Orange",
      "quantity": 10,
      "price": 0.75
    },
    {
      "name": "Banana",
      "quantity": 8,
      "price": 0.25
    }
  ]
}

```
Here is a different approach in which cost of each product is computed locally
then rolled up to the totalCost. Note the difference in the execution `plan`
```bash
> .init -f "example/ex11.json"
{
  "totalCost": "${ $sum(products.cost) }",
  "products": [
    {
      "name": "Apple",
      "quantity": 5,
      "price": 0.5,
      "cost": "${ quantity*price }"
    },
    {
      "name": "Orange",
      "quantity": 10,
      "price": 0.75,
      "cost": "${ quantity*price }"
    },
    {
      "name": "Banana",
      "quantity": 8,
      "price": 0.25,
      "cost": "${ quantity*price }"
    }
  ]
}
> .plan
[
  "/products/0/cost",
  "/products/1/cost",
  "/products/2/cost",
  "/totalCost"
]
> .out
{
  "totalCost": 12,
  "products": [
    {
      "name": "Apple",
      "quantity": 5,
      "price": 0.5,
      "cost": 2.5
    },
    {
      "name": "Orange",
      "quantity": 10,
      "price": 0.75,
      "cost": 7.5
    },
    {
      "name": "Banana",
      "quantity": 8,
      "price": 0.25,
      "cost": 2
    }
  ]
}

```
### Rerooting Expressions
You can reroot an expression in a different part of the document using relative rooting `../${<expr>}` syntax or you can root an
at the absolute doc root with `/${<expr>}`. The example below shows how expressions located below the root object, can 
explicitly set their input using the rooting syntax.

```bash
> .init -f "example/ex04.json"
{
  "greeting": "Hello",
  "player1": "Joshua",
  "player2": "Professor Falken",
  "dialog": {
    "partI": [
      "../../${greeting & ', ' &  player1}",
      "../../${greeting & ', ' &  player2}"
     ],
    "partII": {
      "msg3": "/${player1 & ', would you like to play a game?'}",
      "msg4": "/${'Certainly, '& player2 & '. How about a nice game of chess?'}"
    }
  }
}
> .out
{
  "greeting": "Hello",
  "player1": "Joshua",
  "player2": "Professor Falken",
  "dialog": {
    "partI": [
      "Hello, Joshua",
      "Hello, Professor Falken"
    ],
    "partII": {
      "msg3": "Joshua, would you like to play a game?",
      "msg4": "Certainly, Professor Falken. How about a nice game of chess?"
    }
  }
}

```
### DAG
Templates can grow complex, and embedded expressions have dependencies on both literal fields and other calculated 
expressions. JEEP is at its core a data flow engine. It builds a Directed Acyclic Graph (DAG) and ensures that when 
fields in your JSON change, that the changes flow through the DAG in an optimal order that avoids redundant expression 
calculation.

JEEP helps you track and debug transitive dependencies in your templates. You can use the
``from`` and ``to`` commands to track the flow of data. Their output is an ordered list of JSON Pointers, showing
you the order in which changes propagate.

```bash
> .init -f "example/ex01.json"
{
"a": 42,
"b": "${a}",
"c": "${'the answer is: '& b}"
}
> .out
{
"a": 42,
"b": 42,
"c": "the answer is: 42"
}
> .from /a
[
"/a",
"/b",
"/c"
]
> .to /b
[
"/a",
"/b"
]
> .to /c
[
"/a",
"/b",
"/c"
]
```
The `.plan` command shows you the execution plan for evaluating the entire template as a whole, which is what happens
when you run the `out` command. The execution plan always ensures the optimal data flow so that no expression is 
evaluated twice.
```bash
> .init -f "example/ex08.json"
{
  "a": "${c}",
  "b": "${d+1+e}",
  "c": "${b+1}",
  "d": "${e+1}",
  "e": 1
}
> .plan
[
  "/e",
  "/d",
  "/b",
  "/c",
  "/a"
]
> .out
{
  "a": 5,
  "b": 4,
  "c": 5,
  "d": 2,
  "e": 1
}

```
## Functions
JEEP let's you define and call functions.
### Simple Function Example
```bash
> .init -f "example/ex05.json"
{
  "hello": "${ (function($to){'hello ' & $to & '. The current time is ' & $now()})}",
  "to": "dave",
  "greeting": "${ hello(to)}"
}
> .out
{
  "hello": "{function:}",
  "to": "dave",
  "greeting": "hello dave. The current time is 2023-06-12T07:23:00.243Z"
}
```
### More Complex Function Example
Here is an elaborate example of functions. The `fibonnaci` function itself is pulled into the last element of `x` 
using the expression ``/${fibonacci}``. The first element of the array contains `$[2]($[1])`. Can you see that 
it invokes the `fibonacci` function passing it the value 6? Hint: `$[2]` is the last element of the array which 
will pull in the `fibonacci` function and `$[1]` is the middle element of the array, holding the static value `6`. 
So `$[2]($[1])` expands to `fibonacci(6)`. The value 6th fibonacci number is 8, which is what `fibonacci(6)` returns. 
```bash
> .init -f "example/ex06.json"
{
  "x": [
    "${$[2]($[1])}",
    6,
    "/${fibonacci}"
  ],
  "fibonacci": "${ function($n){$n=1?1:$n=0?0:fibonacci($n-1)+fibonacci($n-2)}}"
}
> .out
{
  "x": [
    8,
    6,
    "{function:}"
  ],
  "fibonacci": "{function:}"
}

```
### Setting Values in the JEEP CLI

The JEEP CLI also allows you to manually set values in your templates, further aiding in debugging and development:

```bash
> .set /to "Dr. David Bowman"
setData Execution Time: 1.732ms
{
  "hello": "{function:}",
  "to": "Dr. David Bowman",
  "greeting": "hello Dr. David Bowman. The current time is 2023-06-12T07:23:00.243Z"
}
> 
````

## Why Do We Need Jeep?

JSONata assumes a single input document and provides a powerful complete language for manipulating that input and 
producing an output. However, JSONata programs are a superset of JSON so they are not themselves pure JSON. JEEP 
provides a way to have a pure JSON document, with many embedded JSONata expressions. The entire syntax of JSONata
is supported. 

For small examples it may not seem obvious why JEEP goes to the trouble of computing a DAG and optimizing expression
evaluation order. But when templates are driven by use cases like data dashboarding, relatively large amounts of data 
(such as database query results) can be set into the template dynamically. In a dashboard containing many panel, each
with dozens of jsonata expressions, it is critical the processing of the data be optimized and efficient. This
was one of the motivating use cases for JEEP: performance critical data rendering applications.

