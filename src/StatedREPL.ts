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
import repl from 'repl';
import CliCore from './CliCore.js';


export default class StatedREPL {
    private readonly cliCore: CliCore;
    r: repl.REPLServer;
    constructor() {
        this.cliCore = new CliCore();
    }

    async initialize() {
        const cmdLineArgsStr = process.argv.slice(2).join(" ");
        const {oneshot} = CliCore.parseInitArgs(cmdLineArgsStr)
        const resp = await this.cliCore.init(cmdLineArgsStr)
        if(oneshot){
            console.log(StatedREPL.stringify(resp));
            return; //do not start REPL. We produced oneshot output, now bail
        }
        //crank up the interactive REPL
        this.r = repl.start({
            prompt: '> ',
        });
        this.cliCore.replServer = this.r;
        this.registerCommands();
    }

    registerCommands() {
        [ //these are CLICore commands
            ["init", '-f <fname> to Initialize the template'],
            ["set", 'Set data to a JSON pointer path and show the executed output'],
            ["in", 'Show the input template'],
            ["out", '[jsonPointer] Show the executed output'],
            ["state", 'Show the current state of the templateMeta'],
            ["from", 'Show the dependents of a given JSON pointer'],
            ["to", 'Show the dependencies of a given JSON pointer'],
            ["plan", 'Show the evaluation plan'],
            ["note", "returns ═══ ... for creating documentation"],
            ["log", "set the log level [debug, info, warn, error]"],
            ["debug", "set debug commands (WIP)"],
            ["errors", "return an error report"],
            ["tail", "'tail /count 100' will tail 100 changes to the /count"],

        ].map(c=>{
            const [cmdName, helpMsg] = c;
            this.r.defineCommand(cmdName, {
                help: helpMsg,
                action: async (args) => {
                    await this.cli(cmdName, args);
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
            const method = this.cliCore[cliCoreMethod].bind(this.cliCore);
            const result = await method(args);
            console.log(StatedREPL.stringify(result));
        } catch (e) {
            console.error(e);
        }
        if(cliCoreMethod !== 'tail'){
            this.r.displayPrompt(); //all commands except tail should throw the prompt up aftert they return
        }
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
            if(value instanceof Set){
                return Array.from(value);
            }
        }
        return value;
    }

    static stringify(o:any, printFunction:(k:any,v:any)=>any=StatedREPL.printFunc){
        return JSON.stringify(o, printFunction, 2)
    }

}




