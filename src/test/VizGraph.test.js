import MetaInfoProducer from "../../dist/src/MetaInfoProducer.js";
import StatedREPL from "../../dist/src/StatedREPL.js";
import VizGraph from "../../dist/src/VizGraph.js";
import TemplateProcessor from "../../dist/src/TemplateProcessor.js";


test("temp vars 2", async () => {
    const template = {
        "a":42,
        "b":{
            "b1":10,
            "b2":"!${b1}",
            "b3": "!${b2+10}",
            "b4":{
                "b5":"!../${b3+b2}",
                "b6":"  !  /${b.b3+b.b2}",
                "b7":"  !/${b.b3+b.b2}",
                "b8":" !  ../${b3+b2}",
            }
        },
        "c": "${b4}"
    };
    const tp = new TemplateProcessor(template);
    await tp.initialize();
    const dot = VizGraph.dot(tp);
    expect(dot).toStrictEqual(`digraph MetaInfoGraph {
    node [fontname="Arial", fontsize=12];
    bgcolor="#282a36";    "/a" [label="JSONPointer: /a
Data: 42", style="filled", fillcolor="#e2dfdf", fontcolor="#44475a" ];
    "/b" [label="JSONPointer: /b
Data: {
  &quot;b1&quot;: 10,
  &quot;b4&quot;: {}
}", style="filled", fillcolor="#e2dfdf", fontcolor="#44475a" ];
    "/b/b1" [label="JSONPointer: /b/b1
Data: 10", style="filled", fillcolor="#e2dfdf", fontcolor="#44475a" ];
    "/b/b2" [label="JSONPointer: /b/b2
Data: --REMOVED (! var)--
Expression: \${b1}", style="filled", fillcolor="#87c095", fontcolor="#f8f8f2" ];
    "/b/b3" [label="JSONPointer: /b/b3
Data: --REMOVED (! var)--
Expression: \${b2+10}", style="filled", fillcolor="#87c095", fontcolor="#f8f8f2" ];
    "/b/b4" [label="JSONPointer: /b/b4
Data: {}", style="filled", fillcolor="#e2dfdf", fontcolor="#44475a" ];
    "/b/b4/b5" [label="JSONPointer: /b/b4/b5
Data: --REMOVED (! var)--
Expression: \${b3+b2}", style="filled", fillcolor="#87c095", fontcolor="#f8f8f2" ];
    "/b/b4/b6" [label="JSONPointer: /b/b4/b6
Data: --REMOVED (! var)--
Expression: \${b.b3+b.b2}", style="filled", fillcolor="#87c095", fontcolor="#f8f8f2" ];
    "/b/b4/b7" [label="JSONPointer: /b/b4/b7
Data: --REMOVED (! var)--
Expression: \${b.b3+b.b2}", style="filled", fillcolor="#87c095", fontcolor="#f8f8f2" ];
    "/b/b4/b8" [label="JSONPointer: /b/b4/b8
Data: --REMOVED (! var)--
Expression: \${b3+b2}", style="filled", fillcolor="#87c095", fontcolor="#f8f8f2" ];
    "/c" [label="JSONPointer: /c
Data: null
Expression: \${b4}", style="filled", fillcolor="#87c095", fontcolor="#f8f8f2" ];
    "/b4" [label="JSONPointer: /b4
Data: ", style="filled,dashed", fillcolor="#ffb86c", fontcolor="#44475a" ];
    "/b/b1" -> "/b" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/b/b2" -> "/b/b1" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b2" -> "/b" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/b/b3" -> "/b/b2" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b3" -> "/b" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/b/b4" -> "/b" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/b/b4/b5" -> "/b/b3" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b5" -> "/b/b2" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b5" -> "/b/b4" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/b/b4/b6" -> "/b/b3" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b6" -> "/b/b2" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b6" -> "/b/b4" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/b/b4/b7" -> "/b/b3" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b7" -> "/b/b2" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b7" -> "/b/b4" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/b/b4/b8" -> "/b/b3" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b8" -> "/b/b2" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
    "/b/b4/b8" -> "/b/b4" [label="parent", color="#8be9fd", fontcolor="#8be9fd"];
    "/c" -> "/b4" [label="depends on", color="#bd93f9", fontcolor="#bd93f9" ];
}
`);
});