#!/usr/bin/env node --experimental-vm-modules
import StatedREPL from './src/StatedREPL.js'
(async () => {
    const repl = new StatedREPL();
    await repl.initialize();
})();
