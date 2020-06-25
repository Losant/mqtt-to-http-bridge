const mqtt = require('async-mqtt');
const axios = require('axios');
const fastq = require('fastq');
const http = require('http');
const https = require('https');
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

/**
 * Attempts to requeue a failed message.
 * A delay is calculated by the number of attempts and the configured backoff multiplier.
 *   Ex. if multiplier is 2, delays will be 1sec, 2sec, 4sec, 8sec, etc.
 * Will fail if maximum attempts is exceeded.
 * @param {Object} log - logging object
 * @param {Object} config - bridge configuration
 * @param {Object} queues - maps HTTP endpoints to their corresponding queue
 * @param {String} httpEndpoint - the HTTP endpoint that will receive the message
 * @param {Object} queueMsg - the message to queue
 * @returns {number} - the delay timeout or undefined if requeue skipped
 */
const requeue = function(log, config, queues, httpEndpoint, queueMsg) {
  if (queueMsg.attempts < config.maxAttempts - 1) {
    const queue = queues[httpEndpoint];
    const timeout = Math.pow(config.backoffMultiplier, queueMsg.attempts) * 1000;
    log.debug('Requeuing message in %s milliseconds. %s -> %s', timeout, queueMsg.data.topic, httpEndpoint);
    setTimeout(() => { queue.push(queueMsg); }, timeout);
    queueMsg.attempts++;
    return timeout;
  } else {
    log.error('Failed. Maximum attempts exceeded (%s). Message dropped. %s -> %s',
      config.maxAttempts, queueMsg.data.topic, httpEndpoint);
  }
};

/**
 * Attempts to forward a message to an HTTP endpoint.
 * Will requeue the message on a total failure or specific HTTP status codes.
 * @param {Object} log - logging object
 * @param {Object} config - bridge configuration
 * @param {Object} queues - maps HTTP endpoints to their corresponding queue
 * @param {String} httpEndpoint - the HTTP endpoint that will receive the message
 * @param {Object} queueMsg - the message to queue
 * @param {function} done - callback function
 * @returns {undefined}
 */
const bridgeWorker = function(log, config, queues, httpEndpoint, queueMsg, done) {

  log.debug('Bridging message: %s -> %s', queueMsg.data.topic, httpEndpoint);

  axios.post(httpEndpoint, queueMsg.data,
    {
      timeout: config.timeout,
      httpAgent: httpAgent,
      httpsAgent: httpsAgent,
      headers: { 'content-type': 'application/json' }
    })
    .then(() => {
      log.debug('Success. %s -> %s', queueMsg.data.topic, httpEndpoint);
    })
    .catch((err) => {
      log.warn('Failed: %s. %s -> %s', err.message, queueMsg.data.topic, httpEndpoint);

      if (err.response) {
        if (err.response.status === 429 || err.response.status >= 500) {
          requeue(log, config, queues, httpEndpoint, queueMsg);
        }
      } else {
        requeue(log, config, queues, httpEndpoint, queueMsg);
      }

    })
    .then(done);
};

/**
 * Called whenever a message is received by the MQTT client.
 * Constructs the object that will be forwarded to the HTTP endpoint(s).
 * Will fail if the queue length has exceeded configured maximum.
 * @param {Object} log - logging object
 * @param {Object} config - bridge configuration
 * @param {Object} queues - maps HTTP endpoints to their corresponding queue
 * @param {string} topic - the MQTT topic
 * @param {string} message - the MQTT payload
 * @returns {undefined}
 */
const messageReceived = function(log, config, queues, topic, message) {
  const queueMsg = {
    data: {
      topic: topic,
      message: message.toString(),
      time: Date.now()
    },
    attempts: 0
  };

  Object.keys(queues).forEach((endpoint) => {
    const queue = queues[endpoint];
    if (queue.length() < config.maxQueueLength) {
      queues[endpoint].push(queueMsg);
    } else {
      log.error('Failed. Maximum queue length exceeded. Message dropped. Bridge: %s -> %s', topic, endpoint);
    }
  });
};

/**
 * Attempts to connect to the MQTT broker.
 * Tries to connect indefinitely with a delay between attempts.
 * The delay is based on the attempt number and the configured backoff multiplier.
 * @param {Object} log - logging object
 * @param {Object} config - bridge configuration
 * @return {Promise<AsyncMqttClient, Object>} - returns the mqtt client and the connection object
 */
const connectToBroker = function(log, config) {

  const mqttOptions = {
    clientId: config.clientId,
    username: config.username,
    password: config.password
  };

  let attempt = 0;

  return new Promise((resolve) => {

    const attemptConnection = function() {

      mqtt.connectAsync(config.mqttEndpoint, mqttOptions).then((mqttClient) => {
        resolve([mqttClient, mqttOptions]);
      }).catch((err) => {
        let timeout = Math.pow(config.brokerConnectBackoffMultiplier, attempt) * 1000;
        if (timeout > config.maxBrokerConnectWait) {
          timeout = config.maxBrokerConnectWait;
        }
        log.error('Failed to connect to broker: %s. %s. Retrying in %s milliseconds.', config.mqttEndpoint, err.message, timeout);
        setTimeout(attemptConnection, timeout);
        attempt++;
      });
    };

    attemptConnection();
  });
};

/**
 * Attempts to subscribe to all configured topics.
 * @param {Object} config - bridge configuration
 * @param {AsyncMqttClient} mqttClient - The mqtt client
 * @returns {undefined}
 * @throws {Error} - throw if any subscription fails
 */
const subscribeToTopics = async function(config, mqttClient) {

  const subs = config.topics.map((topic) => {
    return mqttClient.subscribe(topic);
  });

  try {
    await Promise.all(subs);
  } catch (err) {
    throw new Error(`Failed to subscribe to all topics on ${config.mqttEndpoint}. Reason: ${err.message}`);
  }
};

module.exports = async (log, config) => {
  log.debug('Creating Bridge...');
  log.debug(config);

  const queues = {};
  let messagesCount = 0;

  const [ mqttClient, mqttOptions ] = await connectToBroker(log, config);
  log.debug('Successfully connected to broker: %s', config.mqttEndpoint);

  await subscribeToTopics(config, mqttClient);

  mqttClient.on('error', (err) => { log.error('Connection error to broker %s. Error: %s', config.mqttEndpoint, err.message); });
  mqttClient.on('offline', () => { log.error('Disconnected from broker (OFFLINE) %s', config.mqttEndpoint); });
  mqttClient.on('close', () => { log.error('Disconnected from broker (CLOSE) %s', config.mqttEndpoint); });
  mqttClient.on('disconnect', () => { log.error('Disconnect initiated by broker %s', config.mqttEndpoint); });
  mqttClient.on('connect', () => { log.debug('Connected to broker %s', config.mqttEndpoint); });

  // Each configured HTTP endpoint has its own queue.
  config.httpEndpoints.forEach((endpoint) => {
    queues[endpoint] = fastq(bridgeWorker.bind(null, log, config, queues, endpoint), config.concurrency);
  });

  mqttClient.on('message', (topic, message) => {
    messagesCount++;
    messageReceived(log, config, queues, topic, message);
  });

  /*
   * Returns the total number of messages processed by this bridge since
   * application launch.
   */
  const getMessageCount = () => { return messagesCount; };

  /*
   * Returns the length of each queue.
   * Value is an object that maps HTTP Endpoint -> Queue Length.
   */
  const getQueueLength = () => {
    const result = {};
    Object.keys(queues).forEach((endpoint) => {
      result[endpoint] = queues[endpoint].length();
    });
    return result;
  };

  return {
    getQueueLength: getQueueLength,
    getMessageCount: getMessageCount,
    _config: config,
    _mqttOptions: mqttOptions,
    _mqttClient: mqttClient,
    _queues: queues,
    _messageReceived: messageReceived,
    _requeue: requeue,
    _bridgeWorker: bridgeWorker
  };
};
