const fs = require('fs');
const toml = require('toml');
const url = require('url');

/**
 * Attempts to read, parse, and validate a TOML configuration file.
 * On a failure, raises an exception with specific details on what failed.
 */

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_MAX_QUEUE_LENGTH = 1000;
const DEFAULT_LOG_LEVEL = 'warn';
const DEFAULT_MAX_BROKER_CONNECT_WAIT = 300000;
const DEFAULT_BROKER_CONNECT_BACKOFF_MULTIPLIER = 2;

// All of the integer configuration fields that must be
// valid numbers greater than zero.
const integerConfigFields = [
  'concurrency', 'maxAttempts', 'backOffMultiplier', 'maxQueueLength',
  'timeout', 'maxBrokerConnectWait', 'brokerConnectBackoffMultiplier'
];

const logLevels = ['debug', 'warn', 'error', 'none'];

/**
 * Attempts to read and parse a TOML file from a path.
 * @param {string} path - the file path to read
 * @returns {Object} - parsed configuration file
 * @throws {Error} - throws if failed to read or parse
 */
const readFromFile = function(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }

  let configFileContents = null;
  try {
    configFileContents = fs.readFileSync(path);
  } catch (e) {
    throw new Error(`Failed to read contents of config file. ${e.message}`);
  }

  try {
    return toml.parse(configFileContents);
  } catch (e) {
    throw new Error(`Failed to parse config file. ${e.message}`);
  }
};

/**
 * Validates that a number is an integer and greater than zero.
 * Undefined values are considered valid, since they'll be replaced
 * by defaults.
 * @param {number} num - the number to validate
 * @returns {boolean} - valid=true, invalid=false
 */
const isValidNumber = function(num) {
  if (num === undefined) { return true; }
  return Number.isInteger(num) && num > 0;
};

/**
 * Validates that a value is an array of strings.
 * @param {Array} values - the array of values to check
 * @returns {boolean} - valid=true, invalid=false
 */
const isValidArrayOfStrings = function(values) {
  if (!Array.isArray(values)) { return false; }
  if (values.length === 0) { return false; }
  return values.find((v) => { return typeof v !== 'string'; }) === undefined;
};

/**
 * Validates that a value is an array of URLs with valid protocols.
 * @param {Array} urls - the array of URLs to check
 * @param {Array<String>} validProtocols - array of protocols. Ex ['mqtt:', 'ws:', 'wss:']
 * @returns {boolean} - valid=true, invalid=false
 */
const isValidArrayOfURLs = function(urls, validProtocols) {
  if (!Array.isArray(urls)) { return false; }
  if (urls.length === 0) { return false; }
  for (let idx = 0; idx < urls.length; idx++) {
    try {
      const u = new url.URL(urls[idx]);
      if (validProtocols.indexOf(u.protocol) < 0) {
        return false;
      }
    } catch (err) {
      return false;
    }
  }
  return true;
};

module.exports = (base) => {

  let config = null;
  if (typeof base === 'string') {
    config = readFromFile(base);
  } else {
    config = base;
  }

  if (config.logLevel ===  undefined) {
    config.logLevel = DEFAULT_LOG_LEVEL;
  } else {
    if (logLevels.indexOf(config.logLevel) < 0) {
      throw new Error('Invalid value for logLevel. Value be be "debug", "warn", or "error".');
    }
  }

  if (!config.bridges) {
    throw new Error('At least one bridge configuration is required.');
  }

  Object.keys(config.bridges).forEach((name) => {
    const bridge = config.bridges[name];

    integerConfigFields.forEach((field) => {
      if (!isValidNumber(bridge[field])) {
        throw new Error(`Invalid value for ${field}. Value must be an integer greater than 0.`);
      }
    });

    bridge.concurrency = bridge.concurrency || DEFAULT_CONCURRENCY;
    bridge.maxAttempts = bridge.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    bridge.timeout = bridge.timeout || DEFAULT_TIMEOUT;
    bridge.backoffMultiplier = bridge.backoffMultiplier || DEFAULT_BACKOFF_MULTIPLIER;
    bridge.maxQueueLength = bridge.maxQueueLength || DEFAULT_MAX_QUEUE_LENGTH;
    bridge.maxBrokerConnectWait = bridge.maxBrokerConnectWait || DEFAULT_MAX_BROKER_CONNECT_WAIT;
    bridge.brokerConnectBackoffMultiplier = bridge.brokerConnectBackoffMultiplier || DEFAULT_BROKER_CONNECT_BACKOFF_MULTIPLIER;

    if (!isValidArrayOfURLs(bridge.httpEndpoints, ['http:', 'https:'])) {
      throw new Error('Invalid value for httpEndpoints. Value must be an array of valid URLs. Ex: [ "https://example.com/bridge" ]');
    }

    if (!isValidArrayOfURLs([bridge.mqttEndpoint], ['mqtt:', 'mqtts:', 'ws:', 'wss:'])) {
      throw new Error('Invalid value for mqttEndpoint. Value must be a valid URL. Ex: "mqtt://localhost:1883"');
    }

    if (!isValidArrayOfStrings(bridge.topics)) {
      throw new Error('Invalid value for topics. Value must be an array of strings. Ex: [ "test/topic" ]');
    }
  });

  return config;
};
