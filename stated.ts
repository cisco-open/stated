#!/usr/bin/env node --experimental-vm-modules
import StatedREPL from './src/StatedREPL.js'
import TemplateProcessor from "./src/TemplateProcessor.js";
(async () => {
    const repl = new StatedREPL(new TemplateProcessor({}));
    await repl.initialize();
})();
