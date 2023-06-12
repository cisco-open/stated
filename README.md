# JEEP: JSONata Embedded Expression Processor

JEEP, or Jsonata Embedded Expression Processor, is a library and CLI for running JSON files with embedded
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
Templates can grow complex, and embedded expressions have dependencies on both literal fields and other calculated 
expressions. JEEP is at its core a data flow engine. It builds a Directed Acyclic Graph (DAG) and ensures that when 
fields in your JSON change, that the changes flow through the DAG in an optimal order that avoids redundant expression 
calculation.

JEEP helps you track and debug transitive dependencies in your templates. You can use the
``from`` and ``to`` commands to track the flow of data

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

JEEP brings the data manipulation powers of JSONata:
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
JEEP let's you define and call functions
```bash
> .init -f "example/ex05.json"
{
  "hello": "${ (function($to){'hello ' & $to})}",
  "greeting": "${ hello('dave')}"
}
> .out
{
  "hello": "{function:}",
  "greeting": "hello dave"
}

```
## Getting Started

1. **Installation**: Clone the repo, then install JEEP by running the following command:

```bash
yarn install
````

2. **Start JEEP**: Once installed, you can start using JEEP by running the following command:

```bash
node jeep.js
````

If your environment is set up correctly with the path for Node.js, you can simply run:

```bash
./jeep.js
````



### Setting Values in the JEEP CLI

The JEEP CLI also allows you to manually set values in your templates, further aiding in debugging and development:

```bash
> .set /a 100
setData Execution Time: 0.881ms
{
"a": 100,
"b": 100,
"c": "the answer is: 100"
}
````

## Why Do We Need Jeep?

JSONata assumes a single input document and provides a powerful complete language for manipulating that input and producing an output. However, JSON templating requires expressions that ride along inside the document itself. Each expression is a JSONata program. In JEEP, JSONata programs are embedded using `${ ...JSONata Expression...}`.

The embedded JSONata expressions take their enclosing object or array as their JSONata input. JEEP temlates are easy to understand because the JSONata expressions assign their value directly to the field where they reside.

```bash
> .init -f "example/ex02.json"
{
  "a": "nothing to see here",
  "b": {
    "to": "world",
    "msg": "${ 'hello' & to }"
  }
}
> .out
{
  "a": "nothing to see here",
  "b": {
    "to": "world",
    "msg": "helloworld"
  }
}
```
You can reroot an expression in a different part of the document using `../${}` syntax
```bash
> .init -f "example/ex04.json"
{
  "greeting": "hello",
  "other": {
    "msg": "../${greeting & ' there!'}",
    "other": {
      "msg1": "../../${greeting & ' from msg1'}",
      "msg2": "${msg1 & '(from msg2)'}"
    }
  }
}
> .out
{
  "greeting": "hello",
  "other": {
    "msg": "hello there!",
    "other": {
      "msg1": "hello from msg1",
      "msg2": "hello from msg1(from msg2)"
    }
  }
}
> 

```

## CLI Commands

JEEP provides a set of CLI commands to interact with the system:

Standard Node REPL Commands:
- **.break**: Sometimes you get stuck, this gets you out.
- **.clear**: Break, and also clear the local context.
- **.exit**: Exit the REPL.
- **.help**: Display available commands and their descriptions.
- **.save**: Save all evaluated commands in this REPL session to a file.
- **.load**: Load JS from a file into the REPL session.
- **.editor**: Enter editor mode.

JEEP-Specific Commands:
- **.init**: Initialize the template.
- **.set**: Set data to a JSON pointer path.
- **.in**: Show the input template.
- **.out**: Show the current state of the template.
- **.state**: Show the current state of the templateMeta.
- **.from**: Show the dependents of a given JSON pointer.
- **.to**: Show the dependencies of a given JSON pointer.
```
