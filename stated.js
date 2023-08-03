#!/usr/bin/env node
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
const repl = require('repl');
const CliCore = require('./src/CliCore');


class Stated {
    constructor() {
        this.cliCore = new CliCore();
    }

    async initialize() {
        const filePath = this.getOneShotFilePath();
        if (filePath) {
            const result = await this.cliCore.oneShot(filePath);
            console.log(Stated.stringify(result));
            return;
        }

        // Otherwise, we crank up the interactive REPL
        this.r = repl.start({
            prompt: '> ',
        });
        this.registerCommands();
    }

    getOneShotFilePath() {
        // Assuming the file path argument is passed as the first command line argument
        if (process.argv.length > 2) {
            return process.argv[2];
        }
        return null;
    }

    registerCommands() {
        [ //these are CLICore commands
            ["init", '-f <fname> to Initialize the template'],
            ["set", 'Set data to a JSON pointer path and show the executed output'],
            ["in", 'Show the input template'],
            ["out", 'Show the executed output'],
            ["state", 'Show the current state of the templateMeta'],
            ["from", 'Show the dependents of a given JSON pointer'],
            ["to", 'Show the dependencies of a given JSON pointer'],
            ["plan", 'Show the evaluation plan'],
            ["note", "returns ═══ ... for creating documentation"],
            ["log", "set the log level [debug, info, warn, error]"]

        ].map(c=>{
            const [cmdName, helpMsg] = c;
            this.r.defineCommand(cmdName, {
                help: helpMsg,
                action: async (args) => {
                    const method = this.cliCore[cmdName].bind(this.cliCore);
                    await this.cli(method, args);
                },
            });
        });

        //these other commands are REPL-only commands and are not part of the CLiCore that does
        //template processing
        this.r.defineCommand('help', {
            help: 'Display available commands and their descriptions',
            action: () => {
                try {
                    console.log('Available commands:');
                    Object.entries(this.r.commands).forEach(([name, command]) => {
                        console.log(`  .${name} - ${command.help}`);
                    });
                } catch (e) {
                    console.error(e);
                }
                this.r.displayPrompt();
            },
        });
    }

    async cli(cliCoreMethod, args){
        try{
            const result = await cliCoreMethod(args);
            console.log(Stated.stringify(result));
        } catch (e) {
            console.error(e);
        }
        this.r.displayPrompt();
    }

    static printFunc(key, value) {
        if(value === undefined){
            return null;
        }
        if (value?._jsonata_lambda) {
            return "{function:}";
        }
        if (key === 'compiledExpr__') {
            return "--compiled expression--";
        }
        if(null !== value) {
            const {_idleTimeout, _onTimeout} = value;
            if (_idleTimeout !== undefined && _onTimeout !== undefined) {
                return "--interval/timeout--";
            }
        }

        return value;
    }

    static stringify(o){
        return JSON.stringify(o, Stated.printFunc, 2)
    }

}

module.exports = Stated;
//if we run states.js directly from the command line, it has no parent, and it means we want to
//fire it up. This allows us to import it in other places to get the stringify method without triggering this
if (!module.parent) {
    (async () => {
        const stated = new Stated();
        await stated.initialize();
    })();
}


