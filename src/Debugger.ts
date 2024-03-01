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

import {default as jp} from './JsonPointer.js';

/**
 * Debugger class that manages breakpoints.
 */
export default class Debugger {
    private _breakpoints: Map<any, any>;
    private _templateMeta: any;
    logger: any;
    constructor(metaInfosByJsonPointer, logger) {
        /**
         * Stores the breakpoints set by the user.
         * @type {Map<string, any>}
         * @private
         */
        this._breakpoints = new Map();
        this._templateMeta = metaInfosByJsonPointer;
        this.logger = logger;
    }

    processCommands(commands){
        const resp = {messages:[], breakpoints:[]};
        Object.keys(commands).forEach(cmd=>{
            const val = commands[cmd];
            let jsonPointer;
            let metaInfo;
            try {
                if (cmd === "break") {
                    if(typeof val === 'string'){
                        try{
                            jp.parse(val);
                            jsonPointer = val; //survived parse so must be valid format json pointer
                            if(!jp.has(this._templateMeta, jsonPointer)){
                                throw new Error(`${jsonPointer} non-existent`);
                            }
                            metaInfo = jp.get(this._templateMeta, jsonPointer);
                            this.setBreakpoint(metaInfo, ()=>{});
                            const {enable} = commands;
                            if(enable !== undefined) {
                                const enableBoolean = new Boolean(enable.toLowerCase() === 'true');
                                if (['true', 'false'].includes(enable.toLowerCase())) {
                                    this.enableBreakpoint(metaInfo, enableBoolean);
                                    resp.messages.push(`Breakpoint at ${jsonPointer} ${enableBoolean===true?"enabled":"disabled"}`);
                                } else {
                                    resp.messages.push(`Enable must be "true" or "false"`);
                                }
                            }else{
                                resp.messages.push(`Breakpoint set at ${val}`);
                            }
                        }catch(e){
                            resp.messages.push(e.message);
                        }
                    }
                }
            }catch(e){
                if(this.logger) this.logger.error(e);
                resp.messages.push(`debug command failed (check logs for error)`);
            }
        });
        resp.breakpoints.push(this.listBreakpoints());
        return resp;
    }

    /**
     * Sets a breakpoint at the specified identifier.
     *
     * @param {string} identifier - The identifier where the breakpoint should be set.
     */
    setBreakpoint(metaInfo, handler) {
        this._breakpoints.set(metaInfo.jsonPointer__, {...metaInfo, ...{handler, enabled:true}});
        metaInfo.break__ = handler;
    }

    /**
     * Clears a breakpoint at the specified identifier.
     *
     * @param {string} identifier - The identifier of the breakpoint to be cleared.
     */
    removeBreakpoint(metaInfo) {
        this._breakpoints.delete(metaInfo.jsonPointer__);
        delete metaInfo.break__;
    }

    enableBreakpoint(metaInfo, enabled) {
        this._breakpoints.get(metaInfo.jsonPointer__).enabled = enabled;
        if(enabled===true) {
            metaInfo.break__ = {}//handler;
        }else{
            delete metaInfo.break__;
        }
    }

    /**
     * Lists all breakpoints.
     *
     * @returns {string[]} - An array of breakpoint identifiers.
     */
    listBreakpoints() {
        return Object.fromEntries(this._breakpoints);
    }
}

