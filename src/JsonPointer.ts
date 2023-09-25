export default class JSONPointer {
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
    static api(obj, pointer, value) {
        // .set()
        if (arguments.length === 3) {
            return JSONPointer.set(obj, pointer, value);
        }
        // .get()
        if (arguments.length === 2) {
            return JSONPointer.get(obj, pointer);
        }
        // Return a partially applied function on `obj`.
        const wrapped = JSONPointer.api.bind(JSONPointer, obj);

        // Support for oo style
        for (const name in JSONPointer) {
            if (JSONPointer.hasOwnProperty(name)) {
                wrapped[name] = JSONPointer[name].bind(wrapped, obj);
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
    static get(obj, pointer) {
        const refTokens = Array.isArray(pointer) ? pointer : JSONPointer.parse(pointer);

        for (let i = 0; i < refTokens.length; ++i) {
            const tok = refTokens[i];
            if (!(typeof obj === 'object' && tok in obj)) {
                throw new Error('Invalid reference token: ' + tok);
            }
            obj = obj[tok];
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
    static set(obj, pointer, value) {
        const refTokens = Array.isArray(pointer) ? pointer : JSONPointer.parse(pointer);
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
                if (nextTok.match(/^(\d+|-)$/)) {
                    obj[tok] = [];
                } else {
                    obj[tok] = {};
                }
            }
            obj = obj[tok];
        }
        if (nextTok === '-' && Array.isArray(obj)) {
            nextTok = obj.length;
        }
        obj[nextTok] = value;
        return this;
    }

    /**
     * Removes an attribute
     *
     * @param {Object} obj
     * @param {String|Array} pointer
     */
    static remove(obj, pointer) {
        const refTokens = Array.isArray(pointer) ? pointer : JSONPointer.parse(pointer);
        const finalToken = refTokens[refTokens.length - 1];
        if (finalToken === undefined) {
            throw new Error('Invalid JSON pointer for remove: "' + pointer + '"');
        }

        const parent = JSONPointer.get(obj, refTokens.slice(0, -1));
        if (Array.isArray(parent)) {
            const index = +finalToken;
            if (finalToken === '' && isNaN(index)) {
                throw new Error('Invalid array index: "' + finalToken + '"');
            }

            Array.prototype.splice.call(parent, index, 1);
        } else {
            delete parent[finalToken];
        }
    }

    /**
     * Returns a (pointer -> value) dictionary for an object
     *
     * @param obj
     * @param {function} descend
     * @returns {}
     */
    static dict(obj, descend) {
        const results = {};
        JSONPointer.walk(obj, function (value, pointer) {
            results[pointer] = value;
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
    static walk(obj, iterator, descend) {
        const refTokens = [];

        descend = descend || function (value) {
            const type = Object.prototype.toString.call(value);
            return type === '[object Object]' || type === '[object Array]';
        };

        (function next(cur) {
            for (const [key, value] of Object.entries(cur)) {
                refTokens.push(String(key));
                if (descend(value)) {
                    next(value);
                } else {
                    iterator(value, JSONPointer.compile(refTokens));
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
    static has(obj, pointer) {
        try {
            JSONPointer.get(obj, pointer);
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
    static escape(str) {
        return str.toString().replace(/~/g, '~0').replace(/\//g, '~1');
    }

    /**
     * Unescapes a reference token
     *
     * @param str
     * @returns {string}
     */
    static unescape(str) {
        return str.replace(/~1/g, '/').replace(/~0/g, '~');
    }

    /**
     * Converts a JSON pointer into an array of reference tokens
     *
     * @param pointer
     * @returns {Array}
     */
    static parse(pointer) {
        if (pointer === '') { return []; }
        if (pointer.charAt(0) !== '/') { throw new Error('Invalid JSON pointer: ' + pointer); }
        return pointer.substring(1).split(/\//).map(JSONPointer.unescape);
    }

    /**
     * Builds a JSON pointer from an array of reference tokens
     *
     * @param refTokens
     * @returns {string}
     */
    static compile(refTokens) {
        if (refTokens.length === 0) { return ''; }
        return '/' + refTokens.map(JSONPointer.escape).join('/');
    }
}
