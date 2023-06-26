#!/usr/bin/env node
/*
  Copyright 2023, Cisco Systems, Inc
 */
const repl = require('repl');
const JeepCliCore = require('./src/JeepCliCore');


class Jeep {
    constructor() {
        this.jeepCliCore = new JeepCliCore();
        this.r = repl.start({
            prompt: '> ',
        });
        this.registerCommands();
    }

    registerCommands() {
        [
            ["init", 'Initialize the template'],
            ["set", 'Set data to a JSON pointer path and show the executed output'],
            ["in", 'Show the input template'],
            ["out", 'Show the executed output'],
            ["state", 'Show the current state of the templateMeta'],
            ["from", 'Show the dependents of a given JSON pointer'],
            ["to", 'Show the dependencies of a given JSON pointer'],
            ["plan", 'Show the evaluation plan'],

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
            console.log(Jeep.stringify(result));
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
        const {_idleTimeout, _onTimeout} = value;
        if(_idleTimeout !== undefined && _onTimeout !== undefined){
            return "--interval/timeout--";
        }

        return value;
    }

    static stringify(o){
        return JSON.stringify(o, Jeep.printFunc, 2)
    }

}

module.exports = Jeep;
const jeep = new Jeep();


