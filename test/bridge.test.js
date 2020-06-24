const EventEmitter = require('events');
const mqtt = require('async-mqtt');
const axios = require('axios');
const bridge = require('../src/bridge');
const log = require('../src/log')('none');
const config  = require('../src/config');

jest.mock('async-mqtt');
jest.mock('axios');
jest.useFakeTimers();

const mockClient = new EventEmitter();
mockClient.subscribe = jest.fn();

mqtt.connectAsync.mockResolvedValue(mockClient);

Date.now = jest.fn();
Date.now.mockImplementation(() => 1592425256831);

beforeEach(() => {
  axios.post.mockResolvedValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
  mockClient.removeAllListeners();
});

const bridgeConfig = config({
  bridges: {
    test: {
      mqttEndpoint: 'mqtts://broker.losant.com',
      clientId: 'my-client-id',
      username: 'my-username',
      password: 'my-password',
      topics: ['topic1', 'topic2'],
      httpEndpoints: ['http://example.com/1', 'http://example.com/2', 'http://example.com/3']
    }
  }
}).bridges.test;

test('created with correct MQTT connect options', async () => {

  const b = await bridge(log, bridgeConfig);
  expect(b._mqttOptions.clientId).toBe(bridgeConfig.clientId);
  expect(b._mqttOptions.username).toBe(bridgeConfig.username);
  expect(b._mqttOptions.password).toBe(bridgeConfig.password);
});

test('connect called with correct options', async () => {
  await bridge(log, bridgeConfig);
  expect(mqtt.connectAsync.mock.calls.length).toBe(1);
  expect(mqtt.connectAsync).toHaveBeenCalledWith(
    bridgeConfig.mqttEndpoint,
    {
      clientId: bridgeConfig.clientId,
      username: bridgeConfig.username,
      password: bridgeConfig.password
    }
  );
});

test('subscribe called with correct topics', async () => {
  await bridge(log, bridgeConfig);
  mockClient.emit('connect');
  expect(mockClient.subscribe.mock.calls.length).toBe(2);
  expect(mockClient.subscribe).toHaveBeenCalledWith(bridgeConfig.topics[0]);
  expect(mockClient.subscribe).toHaveBeenCalledWith(bridgeConfig.topics[1]);
});

test('messages published to correct http endpoints', async () => {
  const b = await bridge(log, bridgeConfig);
  mockClient.emit('message', bridgeConfig.topics[0], 'Message Body 1');
  mockClient.emit('message', bridgeConfig.topics[1], 'Message Body 2');

  const drains = [];
  for (const endpoint in b._queues) {
    if (Object.prototype.hasOwnProperty.call(b._queues, endpoint)) {
      drains.push(b._queues[endpoint].drain());
    }
  }
  await Promise.all(drains);

  expect(axios.post.mock.calls.length).toBe(6);

  expect(axios.post).toHaveBeenCalledWith(bridgeConfig.httpEndpoints[0],
    { topic: bridgeConfig.topics[0], message: 'Message Body 1', time: 1592425256831 },
    expect.anything());

  expect(axios.post).toHaveBeenCalledWith(bridgeConfig.httpEndpoints[1],
    { topic: bridgeConfig.topics[0], message: 'Message Body 1', time: 1592425256831 },
    expect.anything());
});

test('requeue is skipped when max attempts is reached', async () => {
  const b = await bridge(log, bridgeConfig);
  const testConfig = {
    maxAttempts: 10
  };

  const queueMsg = {
    attempts: 0,
    data: { topic: 'topic' }
  };

  const queues = { endpoint: [] };

  for (let idx = 0; idx < 20; idx++) {
    b._requeue(log, testConfig, queues, 'endpoint', queueMsg);
  }

  expect(queueMsg.attempts).toBe(9);
  expect(setTimeout).toHaveBeenCalledTimes(9);
});

test('backoff multiplier is applied when requeuing', async () => {
  const b = await bridge(log, bridgeConfig);

  const testConfig = {
    maxAttempts: 10,
    backoffMultiplier: 2
  };

  const queueMsg = {
    attempts: 0,
    data: { topic: 'topic' }
  };

  const queues = { endpoint: [] };

  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(1000);
  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(2000);
  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(4000);
  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(8000);

  testConfig.backoffMultiplier = 3;
  queueMsg.attempts = 0;

  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(1000);
  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(3000);
  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(9000);
  expect(b._requeue(log, testConfig, queues, 'endpoint', queueMsg)).toBe(27000);
});

test('requeue on 429 status code or any 500 status code', async () => {
  const b = await bridge(log, bridgeConfig);

  const queueMsg = {
    attempts: 0,
    data: { topic: 'topic', message: 'hello' }
  };

  const queues = { endpoint: [] };


  const work = () => {
    return new Promise((r) => {
      b._bridgeWorker(log, bridgeConfig, queues, 'endpoint', queueMsg, r);
    });
  };

  axios.post.mockRejectedValue({ response: { status: 429 } });
  await work();

  axios.post.mockRejectedValue({ response: { status: 500 } });
  await work();

  axios.post.mockRejectedValue({ response: { status: 505 } });
  await work();

  expect(queueMsg.attempts).toBe(3);
});

test('requeue on any request error that does not include a response', async () => {
  const b = await bridge(log, bridgeConfig);

  const queueMsg = {
    attempts: 0,
    data: { topic: 'topic', message: 'hello' }
  };

  const queues = { endpoint: [] };

  const work = () => {
    return new Promise((r) => {
      b._bridgeWorker(log, bridgeConfig, queues, 'endpoint', queueMsg, r);
    });
  };

  axios.post.mockRejectedValue({ });
  await work();

  axios.post.mockRejectedValue({ foo: 'bar' });
  await work();

  expect(queueMsg.attempts).toBe(2);
});

test('does not requeue on any non 429 or 500 status code', async () => {
  const b = await bridge(log, bridgeConfig);

  const queueMsg = {
    attempts: 0,
    data: { topic: 'topic', message: 'hello' }
  };

  const queues = { endpoint: [] };

  const work = () => {
    return new Promise((r) => {
      b._bridgeWorker(log, bridgeConfig, queues, 'endpoint', queueMsg, r);
    });
  };

  axios.post.mockRejectedValue({ response: { status: 200 } });
  await work();

  axios.post.mockRejectedValue({ response: { status: 404 } });
  await work();

  axios.post.mockRejectedValue({ response: { status: 300 } });
  await work();

  axios.post.mockRejectedValue({ response: { status: 204 } });
  await work();

  expect(queueMsg.attempts).toBe(0);
});

test('does not queue message when over maximum queue length', async () => {
  const b = await bridge(log, bridgeConfig);

  const msgs = [];

  const queues = {
    endpoint: {
      push: (m) =>  { msgs.push(m); },
      length: () => { return msgs.length; }
    }
  };

  const testConfig = {
    maxQueueLength: 5
  };

  b._messageReceived(log, testConfig, queues, 'topic', 'hello');
  b._messageReceived(log, testConfig, queues, 'topic', 'hello');
  b._messageReceived(log, testConfig, queues, 'topic', 'hello');
  b._messageReceived(log, testConfig, queues, 'topic', 'hello');
  b._messageReceived(log, testConfig, queues, 'topic', 'hello');
  expect(queues.endpoint.length()).toBe(5);

  b._messageReceived(log, testConfig, queues, 'topic', 'hello');
  b._messageReceived(log, testConfig, queues, 'topic', 'hello');
  expect(queues.endpoint.length()).toBe(5);

});
