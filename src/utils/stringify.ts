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

import TemplateProcessor from "../TemplateProcessor.js";

export const UNDEFINED_PLACEHOLDER:string = '__UNDEFINED__';
export const NOOP_PLACEHOLDER:string = '__NOOP__';

export const circularReplacer = (key: any, value: any) => {
  if (value === undefined) {
    return null;
  }
  if (value?._jsonata_lambda || value?._stated_function__) {
    return "{function:}";
  }
  if (value === TemplateProcessor.NOOP) {
    return NOOP_PLACEHOLDER;
  }
  if (key === 'compiledExpr__') {
    return "--compiled expression--";
  }
  if (null !== value) {
    const tag = Object.prototype.toString.call(value);
    const { _idleTimeout, _onTimeout } = value;
    if (tag === '[object Timeout]'|| (_idleTimeout !== undefined && _onTimeout !== undefined)) { //Node.js
      return "--interval/timeout--";
    }
    if (tag === '[object Function]') {
      return "{function:}";
    }
    // Check if value is a module-like object
    // Check if the object has Symbol.toStringTag with value "Module"
    if (value[Symbol.toStringTag] === '[object Module]') {
      return "{module:}";
    }

    if (value instanceof Set) {
      return Array.from(value);
    }
  }
  return value;
}

export const stringifyTemplateJSON = (o: any, printFunction = circularReplacer) => {
  return JSON.stringify(o, printFunction, 2);
}