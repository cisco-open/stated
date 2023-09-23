# stated-workflow
Stated Workflow is a collection of functions for a lightweight and scalable event-driven workflow engine using Stated template engine.

## Example Workflow
Example workflow demonstrating of producing events to and consuming events from an Apache Pulsar. 
```json
# to run this locally you need to have pulsar running in standalone mode
send$: $setInterval(function(){$publish(pubParams)}, 100)
pubParams:
  type: /${ subscribeParams.type} #pub to same type we subscribe on
  data: "${ function(){  {'name': 'nozzleTime', 'rando': $random()}}  }"
recv$: $subscribe(subscribeParams)
subscribeParams: #parameters for subscribing to a cloud event
  source: cloudEvent
  type: 'my-topic'
  to: /${ function($e){(
            $console.log('received - ' & $string($e) );
            $set('/rxLog', rxLog~>$append($e));            
      )}  }
  subscriberId: dingus
  initialPosition: latest
rxLog: []
stop$: $count(rxLog)=20?$clearInterval(send$):'still going'
```
# Workflow deployment model
Workflows can be run on any nodejs runtime, but suggested production deployment is using contaner-based orchestration 
such as Kubernetes. This repo provides a helm chart for deploying stated-workflow to Kubernetes.
TODO: provide the helm chart :) 
## Workflow process
Workflow process is a nodejs process which is responsible for consuming events from an event source and processing them.

## Dispatcher 
The dispatcher is a nodejs workflow process which is responsible for consuming events from an event source and dispatching 
them to per-workflow queues, so it can be processed by the workflow process. This pattern is useful for ensuring that 
each workflow runs in its own event loop, and is not impacted by other workflows. 

## Building a continaer

Build a container
```yaml
docker build -t my_workflow_image .
```

Run a workflow in your docker desktop
```yaml
docker run -e STATED_TEMPLATE="`cat example/pubsub.yaml`" my_workflow_image
```

# Event sources
## HTTP Rest Server
```yaml
subscribeParams: #parameters for subscribing to a http request
  source: http
  to: /${ function($e){(
    $console.log('received - ' & $string($e) );
    )}  }
  parallelism: 2
```
## Kafka Consumer
A single stated workflow process which reads data from a kafka topic (all partitions) and runs it within its event loop. 
This is a perfect model when a kafka topic emits a reasonable number of events, which are mostly IO bound. 
```yaml
subscribeParams: #parameters for subscribing to a cloud event
  source: KafkaConsumer 
  type: 'my-topic'
  # processing function to invoke on each event. 
  # TODO: explain how the function can be outside of subscribeParams in stated 
  to: /${ function($e){(
            $console.log('received - ' & $string($e) );
      )}  }
  # where to start processing from (TODO: add all options here)
  initialPosition: latest
```
## Pulsar Consumer
```yaml
subscribeParams: #parameters for subscribing to a cloud event
  source: PulsarConsumer
  type: 'my-topic'
  # processing function to invoke on each event.
  # TODO: explain how the function can be outside of subscribeParams in stated 
  to: /${ function($e){( 
            $console.log('received - ' & $string($e) );
            $set('/rxLog', rxLog~>$append($e));            
      )}  }
  # optional subscriberId (TODO: describe what will be default behavior)
  subscriberId: dingus
  # where to start processing from (TODO: add all options here)
  initialPosition: latest
```
# Workflow Functions available to a developer

This module provides a set of functions which can be used to implement a workflow


### `generateDateAndTimeBasedID()`

Generates a unique ID based on the current date, time, and a random string.

- **Returns:** A string with the format: `YYYY-MM-DD-TIME-RANDOM_PART`.

### `serial(input, steps, options)`

Executes a series of steps (functions) in sequence (serially).

- **Parameters:**
    - `input`: Initial data for the steps.
    - `steps`: Array of functions to be executed serially.
    - `options`: Configuration object for the execution.
- **Returns:** Output from the last step in the sequence.

### `parallel(initialInput, stages, log)`

Executes a series of stages (functions) in parallel.

- **Parameters:**
    - `initialInput`: Initial data for the stages.
    - `stages`: Array of functions to be executed in parallel.
    - `log`: Logging object for recording the function invocations.
- **Returns:** An array containing the results of each stage.

### `nextCloudEvent(subscriptionParams)`

Subscribes to a cloud event. If in test mode, it pushes the test data for execution. In a real-life scenario, it reads messages from Pulsar.

- **Parameters:**
    - `subscriptionParams`: Configuration parameters for subscription.

### `onHttp(subscriptionParams)`

Sets up an HTTP server and handles incoming HTTP requests based on the provided subscription parameters.

- **Parameters:**
    - `subscriptionParams`: Configuration parameters for the HTTP server.

### `subscribe(subscribeOptions)`

Subscribes to a source. The source could be `http`, `cloudEvent`, or `data`.

- **Parameters:**
    - `subscribeOptions`: Configuration options for the subscription.

### `pulsarPublish(params)`

Publishes data to a Pulsar topic.

- **Parameters:**
    - `params`: Configuration parameters containing `type` and `data` for publishing.

### `logFunctionInvocation(stage, args, result, error, log)`

Logs the invocation details of a function, including any errors.

- **Parameters:**
    - `stage`: Current stage or step being logged.
    - `args`: Arguments provided to the function.
    - `result`: Result returned from the function.
    - `error`: Error object, if any error occurred.
    - `log`: Logging object to store the logs.

