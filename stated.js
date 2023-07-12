#!/usr/bin/env node
/*
  Copyright 2023, Cisco Systems, Inc
 */
const repl = require('repl');
const JeepCliCore = require('./src/JeepCliCore');


class Stated {
    constructor() {
        this.jeepCliCore = new JeepCliCore();
        this.r = repl.start({
            prompt: '> ',
        });
        this.registerCommands();
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
                    const method = this.jeepCliCore[cmdName].bind(this.jeepCliCore);
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
const jeep = new Stated();


