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

import { rateLimit } from "../../../dist/src/utils/ratelimit.js";
import {expect, jest} from '@jest/globals'

describe('rateLimit function', () => {
  jest.useFakeTimers();
  /**
   * Below test validates the following scenario
   * rateLimitedFunction('First call'); // called at 0ms and Executed immediately
   * rateLimitedFunction('Second call');  // called at 500ms, deferred till execution at 1000ms
   * rateLimitedFunction('Third call');  // called at 700ms, deferred till execution at 1000ms, and replaces the Second call
   * // at 1000ms 'Third call' gets executed.
   * rateLimitedFunction('Forth call'); //  called at 1100ms and gets executed in 2000ms
   **/
  it('should rate limit function calls as specified', () => {
    const mockFunction = jest.fn();
    const maxWait = 1000;
    const rateLimitedFunction = rateLimit(mockFunction, maxWait);

    // First call - executed immediately
    rateLimitedFunction('First call');
    expect(mockFunction).toHaveBeenCalledTimes(1);
    expect(mockFunction).toHaveBeenCalledWith('First call');

    // Second call - deferred
    jest.advanceTimersByTime(500);
    rateLimitedFunction('Second call');
    expect(mockFunction).toHaveBeenCalledTimes(1);

    // Third call - replaces second, also deferred
    jest.advanceTimersByTime(200);
    rateLimitedFunction('Third call');
    expect(mockFunction).toHaveBeenCalledTimes(1);

    // Executing the deferred 'Third call'
    jest.advanceTimersByTime(350);
    expect(mockFunction).toHaveBeenCalledTimes(2);
    expect(mockFunction).toHaveBeenCalledWith('Third call');

    // Fourth call - at 1100ms from start gets defferred till 2000ms
    jest.advanceTimersByTime(100);
    rateLimitedFunction('Forth call');
    jest.advanceTimersByTime(900);
    expect(mockFunction).toHaveBeenCalledTimes(3);
    expect(mockFunction).toHaveBeenCalledWith('Forth call');

    // no more calls expected
    jest.advanceTimersByTime(1000);
    expect(mockFunction).toHaveBeenCalledTimes(3);
  });
});


