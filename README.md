# MQTT to HTTP Bridge
MQTT to HTTP Bridge is a service that forwards messages from MQTT brokers to HTTP endpoints.

```
Broker(s) -> Bridge -> HTTP Endpoint(s)
```

## How it Works
The MQTT to HTTP Bridge forms client connections to one or more MQTT brokers. It then subscribes to one or more MQTT topics. Any messages received over those topics are POSTed as JSON to one or more HTTP endpoints.

The brokers, topics, and HTTP endpoints are configured using a TOML file that is passed to the service as a command-line argument.

## Example
Example `config.toml` file:
```
[bridges]

  [bridges.anyCustomName]
  mqttEndpoint = "mqtts://example.com"
  clientId = "your-mqtt-client-id"
  username = "your-mqtt-username"
  password = "your-mqtt-password"
  topics = ["your/topic"]
  httpEndpoints = ["https://example.com/data"]
```

To run the service:
```
mqtt-to-http-bridge /path/to/config.toml
```

This example creates a single bridge connection to the MQTT broker at `mqtts://example.com`. It then subscribes to `your/topic`. Any message received on that topic is forwarded to `https://example.com/data`.

If the message received was "Hello World" the endpoint receives the following JSON body:

```
{
  "topic": "your/topic",
  "time": <unix timestamp>,
  "message": "Hello World"
}
```

## Installation
MQTT to HTTP Bridge is a command-line tool written in [Node.js](https://nodejs.org). To install the service, run one of the following commands:

```
yarn global add mqtt-to-http-bridge
```
or
```
npm install --global mqtt-to-http-bridge
```

## Usage
The `mqtt-to-http-bridge` command line tool accepts a single argument, which is the path to your TOML configuration file.

```
mqtt-to-http-bridge /path/to/config.toml
```

## Configuration
The configuration TOML file requires at least one bridge to be configured.

```
logLevel = "warn"

[bridges]

  [bridges.anyCustomName]
  mqttEndpoint = "mqtts://example.com:8883"
  clientId = "your-mqtt-client-id"
  username = "your-mqtt-username"
  password = "your-mqtt-password"
  topics = ["your/topic1", "your/topic2"]
  httpEndpoints = ["https://example.com/data", "https://example.com/anotherEndpoint"]
  concurrency = 10
  maxAttempts = 5
  backOffMultiplier = 2
  timeout = 60000
  maxQueueLength = 1000
  maxBrokerConnectWait = 300000
  brokerConnectBackoffMultiplier = 2

  [bridges.anotherCustomName]
  ...
```

### Global Configuration Fields
* `logLevel` - (Optional) Sets the logging level. Logs are written to stdout. Defaults to "warn".

### Bridge Configuration Fields
* `mqttEndpoint` - (Required) Full URL to the MQTT Broker. Supports `mqtt`, `mqtts`, `ws`, and `wss` connections.
* `clientId` - (Optional) The client ID that will be used when connecting to the MQTT broker. If not set, a random ID will be generated.
* `username` - (Optional) The username that will be used when connecting to the MQTT broker.
* `password` - (Optional) The password that will be used when connecting to the MQTT broker.
* `topics`  - (Required) The topics on which to subscribe. Must be an array containing at least one topic. Wildcards are supported.
* `httpEndpoints` - (Required) The HTTP endpoints that will be POSTed any received MQTT message. Must be an array containing at least one URL. `http` and `https` endpoints are supported. For basic auth support, add the username and password to the URL: `https://user:pass@example.com`.
* `concurrency` - (Optional) The maximum number of concurrent requests that will be open to any configured HTTP endpoint. Defaults to 10.
* `maxAttempts` - (Optional) The maximum number of times a message will attempt to be forwarded to an HTTP endpoint. Defaults to 5.
* `backOffMultiplier` - (Optional) The delay multiplier applied between forward attempts. Ex: if set to 2, forward attempts will occur in 1000, 2000, 4000, 8000, etc. milliseconds. Defaults to 2.
* `timeout` - (Optional) The maximum amount of time, in milliseconds, to wait for a response from the HTTP endpoint before retrying. Defaults to 60000.
* `maxQueueLength` - (Optional) The maximum number of messages to queue per HTTP Endpoint. Defaults to 1000.
* `maxBrokerConnectWait` - (Optional) The maximum amount of time, in milliseconds, to delay between broker reconnect attempts. Defaults to 300000 (5 minutes).
* `brokerConnectBackoffMultiplier` - (Optional) The delay multiplier applied between broker reconnect attempts. Ex: if set to 2, reconnect attempts will occur in 1000, 2000, 4000, 8000, etc. milliseconds (up to the `maxBrokerConnectWait` value). Defaults to 2.

## Log Levels
Three log levels are supported: `debug`, `warn`, `error`. The default is `warn`. The configured log level will print messages for that level and any message at a higher level. All messages are printed to stdout.

* `debug` - Prints the details of every message received. Useful during early configuration or to debug why messages may not be forwarded as expected.
* `warn` - Prints a message if a forward fails for any reason. With retries, multiple warnings could be printed per message.
* `error` - Prints a message when a forward fails and will not be received by the HTTP endpoint. Examples: exceeded the maximum number of retries or maximum queue length exceeded.

## Message Queues
Each bridge is configured with one or more HTTP endpoints that receive forwarded messages. To circumvent potential intermittent network interruptions, an in-memory queue is created for each configured HTTP endpoint. The `maxQueueLength` configuration field controls how large each queue is allowed to be (in number of messages) before new messages are discarded.

If a message fails to be forwarded, it will be requeued with a delay. The delay is controlled by the `backOffMultiplier` configuration field. For example, if the multiplier is set to 2, the delay between attempts will be 1000, 2000, 4000, 8000, etc., milliseconds. A message will be attempted a maximum number of times, which is set by the `maxAttempts` configuration field.

## Message Encoding
The MQTT specification does not does provide any requirements or recommendations for how your messages are encoded. This service encodes any message received as a UTF-8 string. That string is then encoded as JSON as part of the final body sent to the HTTP endpoint.

## Initial Connections and Errors
When this service starts, it will attempt to make an initial connection to each configured MQTT broker indefinitely. Once a connection is established, each client then attempts to subscribe to all configured topics. If a subscription fails, it will not be re-attempted and the process will exit.

There are many reasons why an MQTT broker may not be available when the process starts, however it is unlikely that if a subscription fails, it will work on subsequent retries. The most likely cause of a failed subscription will be due to the authentication configuration of the MQTT broker.

## Example: Bridge HiveMQ Broker to Losant Webhook
The most recent version of [HiveMQ](https://www.hivemq.com/) does not have built-in support for MQTT to MQTT bridging. Because of this, an MQTT to HTTP bridge is a good option to forward data from your local HiveMQ broker to an IoT platform like [Losant](https://www.losant.com).

These instructions are assuming the following HiveMQ configuration:

* `url` - "mqtt://localhost:1883"
* `topic` - "telemetry/{device-mac-address}/{sensor-type}"

For example, a device with a MAC address of `00:1B:44:11:3A:B7` reporting a temperature value publishes a message to the following topic:

```
telemetry/00:1B:44:11:3A:B7/temperature
```

### 1. Create Losant Webhook
A [Losant Webhook](https://docs.losant.com/applications/webhooks/) provides a unique URL that can be used to report data into the Losant Enterprise IoT Platform. For this example, the webhook was configured with basic authentication with the username and password set to `WebhookUser` and `WebhookPass` respectively.

This results in a webhook URL in the following format:

```
https://triggers.losant.com/webhooks/{your-unique-id}
```

### 2. Create Configuration File
To bridge messages from the MQTT broker to the webhook, create a file named `config.toml` with the following contents:

```
[bridges]

  [bridges.HiveMQ]
  mqttEndpoint = "mqtt://localhost:1883"
  topics = ["telemetry/#"]
  httpEndpoints = ["https://WebhookUser:WebhookPass@triggers.losant.com/webhooks/{your-unique-id}"]
```

This configuration uses a wildcard topic, `telemetry/#` to receive all telemetry data from every device. The `clientId` field is left blank, which means an ID will be automatically generated.

### 3. Run the MQTT to HTTP Bridge Service
The bridge service can now be run using the following command:

```
mqtt-to-http-bridge /path/to/config.toml
```

To ensure the service restarts on any expected errors or system restarts, it's recommended that it be run using some process monitoring service or init system (i.e. Upstart on Ubuntu).

---

Copyright (c) 2022 Losant IoT, Inc

https://www.losant.com
