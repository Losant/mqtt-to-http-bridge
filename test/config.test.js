const path = require('path');
const fs = require('fs');
const config = require('../src/config');

const invalidTomlContents = fs.readFileSync('./invalid.toml');

jest.mock('fs');

beforeEach(() => {
  fs.readFileSync.mockReturnValue('');
  fs.existsSync.mockReturnValue(true);
});

test('fails if path does not exist', () => {
  fs.existsSync.mockReturnValue(false);
  expect(() => { config('./not/a/path'); }).toThrow(/file not found/);
});

test('fails if unable to read from file', () => {
  fs.readFileSync.mockImplementation(() => { throw new Error('failed'); });
  fs.existsSync.mockReturnValue(true);

  expect(() => { config('./whatever'); }).toThrow(/Failed to read contents/);
});

test('fails if invalid toml contents', () => {
  fs.readFileSync.mockReturnValue(invalidTomlContents);

  expect(() => { config(path.join(__dirname, 'invalid.toml')); }).toThrow(/Failed to parse/);
});

test('fails if no bridges are defined', () => {
  const base = {};
  expect(() => { config(base); }).toThrow(/At least one bridge configuration/);
});

test('fails for invalid log level', () => {
  const base = { logLevel: 'invalid' };
  expect(() => { config(base); }).toThrow(/Invalid value for logLevel/);
});

test('fails if not all required fields for bridge are configured', () => {

  const base = { bridges: { test: { } } };

  expect(() => { config(base); }).toThrow(/Invalid value/);

  base.bridges.test.httpEndpoints = ['http://example.com'];

  expect(() => { config(base); }).toThrow(/Invalid value/);

  base.bridges.test.mqttEndpoint = 'mqtt://example.com';

  expect(() => { config(base); }).toThrow(/Invalid value/);

  base.bridges.test.topics = ['topic'];

  expect(() => { config(base); }).not.toThrow();

});

test('fails on invalid configuration values', () => {
  const base = { bridges: { test: { } } };
  base.bridges.test.httpEndpoints = ['http://example.com'];
  base.bridges.test.mqttEndpoint = 'mqtt://example.com';
  base.bridges.test.topics = ['topic'];

  expect(() => { config(base); }).not.toThrow();

  const fields = ['concurrency', 'maxAttempts', 'backOffMultiplier', 'maxQueueLength', 'timeout', 'maxBrokerConnectWait', 'brokerConnectBackoffMultiplier'];

  fields.forEach((field) => {
    base.bridges.test[field] = 'Not a number';
    expect(() => { config(base); }).toThrow(new RegExp(field));
    base.bridges.test[field] = -1;
    expect(() => { config(base); }).toThrow(new RegExp(field));
    base.bridges.test[field] = undefined;
  });
});

test('fails if invalid httpEndpoint URL or mqttEndpoint URL', () => {
  const base = { bridges: { test: { } } };
  base.bridges.test.httpEndpoints = ['http://example.com'];
  base.bridges.test.topics = ['topic'];

  base.bridges.test.mqttEndpoint = 'not a URL';
  expect(() => { config(base); }).toThrow(/Invalid value/);
  base.bridges.test.mqttEndpoint = 'mqtt://example.com';
  expect(() => { config(base); }).not.toThrow();

  base.bridges.test.httpEndpoints = ['Not a URL'];
  expect(() => { config(base); }).toThrow(/Invalid value/);
  base.bridges.test.httpEndpoints = ['http://example.com'];
  expect(() => { config(base); }).not.toThrow();

  base.bridges.test.mqttEndpoint = 'ftp://example.com';
  expect(() => { config(base); }).toThrow(/Invalid value/);
  base.bridges.test.mqttEndpoint = 'mqtt://example.com';
  expect(() => { config(base); }).not.toThrow();

  base.bridges.test.httpEndpoints = ['ftp://example.com'];
  expect(() => { config(base); }).toThrow(/Invalid value/);
  base.bridges.test.httpEndpoints = ['http://example.com'];
  expect(() => { config(base); }).not.toThrow();
});
