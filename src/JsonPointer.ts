/*
The MIT License (MIT)

Copyright (c) 2016 Manuel Stofer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

 */
/*
    This class is mostly a cut-n-paste of the MIT licensed source code noted above
 */
import {JsonPointerString, JsonPointerStructureArray} from "./MetaInfoProducer.js";
export type DescentCallback = (value:any, jsonPointer:JsonPointerString) => boolean;
export type DescentIterator = (value:any, localFieldName:string) => void;
export default class JsonPointer {
    /**
     * Convenience wrapper around jp.
     * Calls `.get` when called with an `object` and a `pointer`.
     * Calls `.set` when also called with `value`.
     * If only supplied `object`, returns a partially applied function, mapped to the object.
     *
     * @param {Object} obj
     * @param {String|Array} pointer
     * @param value
     * @returns {*}
     */
    public static api(obj:any, pointer:JsonPointerString|JsonPointerStructureArray, value:any):any {
        // .set()
        if (arguments.length === 3) {
            return JsonPointer.set(obj, pointer, value);
        }
        // .get()
        if (arguments.length === 2) {
            return JsonPointer.get(obj, pointer);
        }
        // Return a partially applied function on `obj`.
        // @ts-ignore
        const wrapped = JsonPointer.api.bind(JsonPointer, obj);

        // Support for oo style
        for (const name in JsonPointer) {
            if (JsonPointer.hasOwnProperty(name)) {
                (wrapped as any)[name] = (JsonPointer as any)[name].bind(wrapped, obj);
            }
        }
        return wrapped;
    }

    /**
     * Lookup a JSON pointer in an object
     *
     * @param {Object} obj
     * @param {String|Array} pointer
     * @returns {*}
     */
    static get(obj:object, pointer:JsonPointerString|JsonPointerStructureArray) {
        const refTokens = Array.isArray(pointer) ? pointer : JsonPointer.parse(pointer as JsonPointerString);
        //technically the json pointer for the root object is "". However I find this ridiculous and we adopt our
        //more sensible convention that "/" is the root pointer. So the if block below is there to treat "" as "/"
        if(refTokens[0] === "" && refTokens.length === 1){
            return obj;
        }
        for (let i = 0; i < refTokens.length; ++i) {
            const tok = refTokens[i];
            if (!(typeof obj === 'object' && tok in obj)) {
                throw new Error('Invalid reference token: ' + tok);
            }
            obj = (obj as any)[tok];
        }
        return obj;
    }

    /**
     * Sets a value on an object
     *
     * @param {Object} obj
     * @param {String|Array} pointer
     * @param value
     */
    static set(obj:object, pointer:JsonPointerString|JsonPointerStructureArray, value:any) {
        const refTokens = Array.isArray(pointer) ? pointer : JsonPointer.parse(pointer);
        let nextTok = refTokens[0];

        if (refTokens.length === 0) {
            throw Error('Can not set the root object');
        }

        for (let i = 0; i < refTokens.length - 1; ++i) {
            let tok = refTokens[i];
            if (typeof tok !== 'string' && typeof tok !== 'number') {
                tok = String(tok);
            }
            if (tok === "__proto__" || tok === "constructor" || tok === "prototype") {
                continue;
            }
            if (tok === '-' && Array.isArray(obj)) {
                tok = obj.length;
            }
            nextTok = refTokens[i + 1];

            if (!(tok in obj)) {
                if ((nextTok as any).match(/^(\d+|-)$/)) {
                    (obj as any)[tok] = [];
                } else {
                    (obj as any)[tok] = {};
                }
            }
            obj = (obj as any)[tok];
        }
        if (nextTok === '-' && Array.isArray(obj)) {
            nextTok = obj.length;
        }
        (obj as any)[nextTok] = value;
        return this;
    }

    /**
     * Removes an attribute
     *
     * @param {Object} obj
     * @param {String|Array} pointer
     */
    static remove(obj:object, pointer:JsonPointerString|JsonPointerStructureArray) {
        const refTokens = Array.isArray(pointer) ? pointer : JsonPointer.parse(pointer);
        const finalToken = refTokens[refTokens.length - 1];
        if (finalToken === undefined) {
            throw new Error('Invalid JSON pointer for remove: "' + pointer + '"');
        }

        const parent = JsonPointer.get(obj, refTokens.slice(0, -1));
        if (Array.isArray(parent)) {
            const index = +finalToken;
            if (finalToken === '' && isNaN(index)) {
                throw new Error('Invalid array index: "' + finalToken + '"');
            }

            Array.prototype.splice.call(parent, index, 1);
        } else {
            delete (parent as any)[finalToken];
        }
    }

    /**
     * Returns a (pointer -> value) dictionary for an object
     *
     * @param obj
     * @param {function} descend
     * @returns {}
     */
    static dict(obj:object, descend:DescentCallback) {
        const results = {};
        JsonPointer.walk(obj, function (value, pointer) {
            (results as any)[pointer as string] = value;
        }, descend);
        return results;
    }

    /**
     * Iterates over an object
     * Iterator: function (value, pointer) {}
     *
     * @param obj
     * @param {function} iterator
     * @param {function} descend
     */
    static walk(obj:object, iterator:DescentIterator, descend?:DescentCallback) {
        const refTokens = [];

        descend = descend || function (value:any, ptrString:JsonPointerString) {
            const type = Object.prototype.toString.call(value);
            return type === '[object Object]' || type === '[object Array]';
        };

        (function next(cur) {
            for (const [key, value] of Object.entries(cur)) {
                refTokens.push(String(key));
                const ptrString = JsonPointer.compile(refTokens);
                if (descend(value, ptrString)) {
                    next(value);
                } else {
                    iterator(value, ptrString);
                }
                refTokens.pop();
            }
        }(obj));
    }

    /**
     * Tests if an object has a value for a JSON pointer
     *
     * @param obj
     * @param pointer
     * @returns {boolean}
     */
    static has(obj:object, pointer:JsonPointerString|JsonPointerStructureArray) {
        try {
            JsonPointer.get(obj, pointer);
        } catch (e) {
            return false;
        }
        return true;
    }

    /**
     * Escapes a reference token
     *
     * @param str
     * @returns {string}
     */
    static escape(str:JsonPointerString|number) {
        return str.toString().replace(/~/g, '~0').replace(/\//g, '~1');
    }

    /**
     * Unescapes a reference token
     *
     * @param str
     * @returns {string}
     */
    static unescape(str:JsonPointerString) {
        return str.replace(/~1/g, '/').replace(/~0/g, '~');
    }

    /**
     * Converts a JSON pointer into an array of reference tokens
     *
     * @param pointer
     * @returns {Array}
     */
    static parse(pointer:JsonPointerString) {
        if (pointer === '') { return []; }
        if (pointer.charAt(0) !== '/') { throw new Error(`Stated's flavor of JSON pointer Requires JSON Pointers to begin with "/", and this did not: ${pointer}`); }
        return pointer.substring(1).split(/\//).map(JsonPointer.unescape);
    }

    /**
     * Builds a JSON pointer from an array of reference tokens
     *
     * @param refTokens
     * @returns {string}
     */
    static compile(refTokens:JsonPointerStructureArray) {
        if (refTokens.length === 0) { return ''; }
        return '/' + refTokens.map(JsonPointer.escape).join('/');
    }

    static parent(pointer:JsonPointerString|JsonPointerStructureArray){
        const asArray = Array.isArray(pointer);
        const refTokens =  Array.isArray(pointer) ? pointer : JsonPointer.parse(pointer);
        return asArray?refTokens.slice(0,-1):this.compile(refTokens.slice(0,-1));
    }

    /**
     * Returns true if potentialAncestor is an ancestor of jsonPtr.
     * For example, if jsonPtr is /a/b/c/d and potentialAncestor is /a/b, this returns true.
     * @param jsonPtr - The JSON pointer to check.
     * @param potentialAncestor - The potential ancestor JSON pointer.
     */
    static isAncestor(jsonPtr: JsonPointerString, potentialAncestor: JsonPointerString): boolean {
        // Parse the JSON pointers into arrays of path segments
        const jsonPtrArray = JsonPointer.parse(jsonPtr);
        const potentialAncestorArray = JsonPointer.parse(potentialAncestor);

        // If potentialAncestor has more segments than jsonPtr, it cannot be an ancestor
        if (potentialAncestorArray.length > jsonPtrArray.length) {
            return false;
        }

        // Check if each segment in potentialAncestor matches the beginning of jsonPtr
        for (let i = 0; i < potentialAncestorArray.length; i++) {
            if (jsonPtrArray[i] !== potentialAncestorArray[i]) {
                return false;  // If any segment does not match, potentialAncestor is not an ancestor
            }
        }

        return true;  // All segments matched, so potentialAncestor is an ancestor of jsonPtr
    }

    static rootish(ptrString:JsonPointerString){
        return ptrString === '' || ptrString==="/"; //support hideous but correct spec where root is '', as well as our nice convention that root is '/'
    }

}
