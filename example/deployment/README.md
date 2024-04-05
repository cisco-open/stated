# demo of kubernetes approach

1. `render.sh` does this:
```shell
stated myKafkaProducer.yaml > tmp.yaml && stated tmp.yaml --tags=RUNTIME
```
It renders the template to tmp.yaml. The`tmp.yaml` file will contain 
unevaluated expressions because RUNTIME tag was not provided. 

The `tmp.yaml` file is then rendered with `--tags=RUNTIME` causing everything
in the file marked `@RUNTIME` to be evaluated. 

This demonstrates how a single stated template can contain expressions, some
of which evaluate *before* the kafka bootstrap URLS are available, and others
that execute at RUNTIME (i.e. *after* kafka bootsrap URLS become available) 


2. `myKafkaProducer.yaml` is a user's deployment.yaml
Temporary stated variables are used to import content. Temporary vars are 
removed on render of the template, therefore do not corrupt expected content.
`@`tags are used to identify expressions that run only at RUNTIME. 
```yaml
config: "!${$open('environments.yaml')~>$import}" # '!' marks this as removed from output after stated runs on this file
runtime: "@RUNTIME !${$open('runtime.yaml')~>$import}"
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: java-kafka-producer
  name: java-kafka-producer
spec:
  replicas: 1
  selector:
    matchLabels:
      app: java-kafka-producer
  template:
    metadata:
      labels:
        app: java-kafka-producer
    spec:
      containers:
        - name: java-kafka-producer
          image: quay.io/strimzi-examples/java-kafka-producer:latest
          env:
            - name: STRIMZI_LOG_LEVEL
              value: "@RUNTIME /${runtime.logLevel}"
            - name: KAFKA_BOOTSTRAP_SERVERS
              value: "@RUNTIME /${runtime.bootstrapServers}"
            - name: STRIMZI_TOPIC
              value: /${config.selected.topic}
            - name: STRIMZI_DELAY_MS
              value: /${config.selected.delayMs}
            - name: KAFKA_KEY_SERIALIZER
              value: /${config.selected.keySerializer}
            - name: KAFKA_VALUE_SERIALIZER
              value: /${config.selected.valueSerializer}
```
2. `environments.yaml` defines local environments, and imports
some standard environments from a git repo.
```yaml
selected: ${myLaptop}
standardConfigs: ${$import('https://raw.githubusercontent.com/geoffhendrey/jsonataplay/main/stdenvs.yaml')}
myTopicName: nozzles
myLaptop:
    - topic: /${myTopicName}
    - delayMs: 100
    - keySerializer: org.apache.kafka.common.serialization.StringSerializer"
    - valueSerializer: org.apache.kafka.common.serialization.StringSerializer"
myLocalk9s:
  - topic: /${myTopicName}
  - delayMs: 10
  - keySerializer: org.apache.kafka.common.serialization.StringSerializer"
  - valueSerializer: org.apache.kafka.common.serialization.StringSerializer"
```
3. `runtime.yaml` simulates some variables that are known about the 
runtime environment, that are not known at the time of initial template render. 
```yaml
bootstrapServers: https://foo.bar
logLevel: debug
```

4. the end result of `stated myKafkaProducer.yaml > tmp.yaml && stated tmp.yaml --tags=RUNTIME`
is:
```yaml
{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "labels": {
      "app": "java-kafka-producer"
    },
    "name": "java-kafka-producer"
  },
  "spec": {
    "replicas": 1,
    "selector": {
      "matchLabels": {
        "app": "java-kafka-producer"
      }
    },
    "template": {
      "metadata": {
        "labels": {
          "app": "java-kafka-producer"
        }
      },
      "spec": {
        "containers": [
          {
            "name": "java-kafka-producer",
            "image": "quay.io/strimzi-examples/java-kafka-producer:latest",
            "env": [
              {
                "name": "STRIMZI_LOG_LEVEL",
                "value": "debug"
              },
              {
                "name": "KAFKA_BOOTSTRAP_SERVERS",
                "value": "https://foo.bar"
              },
              {
                "name": "STRIMZI_TOPIC",
                "value": "nozzles"
              },
              {
                "name": "STRIMZI_DELAY_MS",
                "value": 100
              },
              {
                "name": "KAFKA_KEY_SERIALIZER",
                "value": "org.apache.kafka.common.serialization.StringSerializer\""
              },
              {
                "name": "KAFKA_VALUE_SERIALIZER",
                "value": "org.apache.kafka.common.serialization.StringSerializer\""
              }
            ]
          }
        ]
      }
    }
  }
}


```