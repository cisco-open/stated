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
import colorizeJson from "json-colorizer";
import chalk from 'chalk';
import { stringifyTemplateJSON as stringify } from './utils/stringify.js';
import TemplateProcessor from "./TemplateProcessor.js";


export default class StatedREPL {
    private readonly cliCore: CliCore;
    //@ts-ignore
    replServer: repl.REPLServer;
    private isColorized:boolean=false;
    constructor(templateProcessor: TemplateProcessor) {
        this.cliCore = new CliCore(templateProcessor);
    }

    // a list of commands that are available in the CLI
    // this list can be extended if CLICORE is extended as well
    static CLICORE_COMMANDS: string[][] = [
        ["open", 'interactive command to open select and open a template'],
        ["cd", "change directory for example 'cd ..' "],
        ["init", '-f <fname> to Initialize the template'],
        ["set", 'Set data to a JSON pointer path and show the executed output'],
        ["in", 'Show the input template'],
        ["out", '[jsonPointer] Show the executed output'],
        ["state", 'Show the current state of the templateMeta'],
        ["from", 'Show the dependents of a given JSON pointer'],
        ["to", 'Show the dependencies of a given JSON pointer'],
        ["flow", 'return an array or tree structures showing the data flow from sources to destinations'],
        ["plan", 'Show the evaluation plan'],
        ["note", "returns ═══ ... for creating documentation"],
        ["log", "set the log level [debug, info, warn, error]"],
        ["debug", "set debug commands (WIP)"],
        ["errors", "return an error report"],
        ["tail", 'tail "/ until count=100" will tail the template root until its count field is 100'],
        ["svg", 'serve SVG of depedency graph off http://localhost:3000'],
        ["restore", 'restore the template from a snapshot'],
    ];

    async initialize() {
        this.isColorized = false;
        const cmdLineArgsStr = process.argv.slice(2).map((s)=>{
            if(s.includes(" ")) {
                if(!s.startsWith('"')){
                    return '"' + s + '"';//we need to surround any arguments that have whitespace like "...Program Files ..." with quotes sp we don't break our own argument parsing
                }
            }
            return s;
        }).join(" ");
        const {oneshot} = CliCore.parseInitArgs(cmdLineArgsStr)
        const resp = await this.cliCore.init(cmdLineArgsStr)
        if(oneshot){
            console.log(stringify(resp));
            return; //do not start REPL. We produced oneshot output, now bail
        }
        //crank up the interactive REPL
        this.replServer = repl.start({
            prompt: '> ',
            useColors:true,
            useGlobal:true
        });
        //make variable called 'template' accessible in REPL
        this.replServer.context.template = this.cliCore.getTemplateProcessor();
        this.cliCore.replServer = this.replServer;
        this.registerCommands();
    }

    close(){
        this.cliCore.close();
        this.replServer.close();
    }

    registerCommands() {
        StatedREPL.CLICORE_COMMANDS.map(c=>{
            const [cmdName, helpMsg] = c;
            this.replServer.defineCommand(cmdName, {
                help: helpMsg,
                action: async (args) => {
                    await this.cli(cmdName, args);
                },
            });
        });
        this.replServer.defineCommand("color", {
            help: "[on|off] colorize JSON",
            action: async (args) => {
                if(args.trim()==="on"){
                    this.isColorized = true;
                }else if(args.trim()==="off"){
                    this.isColorized = false;
                }
                this.replServer.displayPrompt();
            },
        });

        //these other commands are REPL-only commands and are not part of the CLiCore that does
        //template processing
        this.replServer.defineCommand('help', {
            help: 'Display available commands and their descriptions',
            action: () => {
                try {
                    console.log('Available commands:');
                    Object.entries(this.replServer.commands).forEach(([name, command]) => {
                        //@ts-ignore
                        console.log(`  .${name} - ${command.help}`);
                    });
                } catch (e) {
                    console.error(e);
                }
                this.replServer.displayPrompt();
            },
        });
    }

    async cli(cliCoreMethodName:string, args:string){
        let result="";
        try{
            const method = (this.cliCore as any)[cliCoreMethodName].bind(this.cliCore);
            result = await method(args);
            if(!this.tookOverIO(cliCoreMethodName, result)){
                let s = stringify(result);
                if(this.isColorized){
                    s = StatedREPL.colorize(s);
                }
                console.log(s);
            }
        } catch (e:any) {
            console.error(stringify(e.message));
        }
        this.replServer.displayPrompt();
        return true;
    }

    static colorize(s:string):string{
        return colorizeJson(s).replace(/(true|false)/g, chalk.yellow('$1')) // booleans in yellow
            .replace(/\b(\d+)\b/g, chalk.green('$1')) // numbers green
            .replace(/'([^']*)'/g, chalk.cyanBright("'$1'"))
            .replace(/(".*?)(\$\{)\s*(.*?)\s*(\}")/g, (match,p0, p1, p2, p3) => {
                // p1 is the opening "${"
                // p2 is the JSONata expression
                // p3 is the closing "}"
                return p0 + chalk.gray(p1) + chalk.bgRed(chalk.bold(p2)) + chalk.gray(p3);
            })
            .replace(/\$(\w+)/g, (match) => {
                // Entire match will be replaced with this return value
                // Use chalk to add color - cyan in this case
                return chalk.cyan(match);
            });
    }

    private tookOverIO(methodName:string, result:any) {
        return methodName === 'open' || result?.__tailed
    }
}




