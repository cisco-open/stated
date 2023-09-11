# stated

### Importing JS modules
stated supports importing JavaScript modules. The example below imports the `myFunction` function from an external
module. Note, that we are removing non-json representation of the classes and modules in the output to keep it a valid
json.
```json
> .init -f "example/ex25.json" --xf "example/module_exports.js"
{
  "b": "${ $myFunction() }"
}
> .out
{
  "b": "Hello from myFunction"
}
```