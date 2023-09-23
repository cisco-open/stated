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
export class WorkflowDispatcher {
    constructor(subscribeParams) {
        const {to: workflowFunction, parallelism, type, subscriberId} = subscribeParams;
        this.workflowFunction = workflowFunction;
        this.parallelism = parallelism || 1;
        this.subscriberId = subscriberId;
        this.type = type;
        this.queue = [];
        this.active = 0;
        this.promises = [];
        this.batchMode = false;
        this.batchCount = 0; // Counter to keep track of items in the batch
    }

    _getKey() {
        return WorkflowDispatcher._generateKey(this.type, this.subscriberId);
    }

    static dispatchers = new Map();       // key is type, value is a Set of keys
    static dispatcherObjects = new Map(); // key is composite key, value is WorkflowDispatcher object

    static _generateKey(type, subscriberId) {
        return `${type}-${subscriberId}`;
    }

    static _addDispatcher(dispatcher) {
        if (!this.dispatchers.has(dispatcher.type)) {
            this.dispatchers.set(dispatcher.type, new Set());
        }
        const key = dispatcher._getKey();
        this.dispatchers.get(dispatcher.type).add(key);
        this.dispatcherObjects.set(key, dispatcher);
    }

    static getDispatcher(subscriptionParams) {
        const {type, subscriberId} = subscriptionParams;
        const key = this._generateKey(type, subscriberId);
        if (!this.dispatcherObjects.has(key)) {
            const newDispatcher = new WorkflowDispatcher(subscriptionParams);
            this._addDispatcher(newDispatcher);
        }
        return this.dispatcherObjects.get(key);
    }

    static dispatchToAllSubscribers(type, data) {
        const keysSet = this.dispatchers.get(type);
        if (keysSet) {
            for (let key of keysSet) {
                const dispatcher = this.dispatcherObjects.get(key);
                dispatcher.addToQueue(data); // You can pass the actual data you want to dispatch here
            }
        } else {
            console.log(`No subscribers found for type ${type}`);
        }
    }

    _dispatch() {
        while (this.active < this.parallelism && this.queue.length > 0) {
            this.active++;
            const eventData = this.queue.shift();

            const promise = this.workflowFunction.apply(null, [eventData])
                .catch(error => {
                    console.error("Error executing workflow:", error);
                })
                .finally(() => {
                    this.active--;
                    if (this.batchMode) {
                        this.batchCount--;
                    }
                    const index = this.promises.indexOf(promise);
                    if (index > -1) {
                        this.promises.splice(index, 1);
                    }
                    this._dispatch();
                });

            this.promises.push(promise);
        }
    }

    addToQueue(data) {
        this.queue.push(data);
        this._dispatch();
    }

    //this is used for testing
    addBatch(dataArray) {
        this.batchMode = true;
        this.batchCount += dataArray.length;
        dataArray.forEach(data => this.addToQueue(data));
    }

    //this is used for testing
    async drainBatch() {
        while (this.batchMode && this.batchCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 50)); // Poll every 50ms
        }
        this.batchMode = false;
    }
}