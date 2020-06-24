/**
 * This test creates a local MQTT server and local HTTP server.
 * It then publishes messages and monitors the HTTP server for bridged results.
 */

const http = require('http');
const net = require('net');
const mqtt = require('async-mqtt');
const aedes = require('aedes')();
const killable = require('killable');
const bridge = require('../src/bridge');
const config = require('../src/config');
const log = require('../src/log')('none');

Date.now = jest.fn();
Date.now.mockImplementation(() => 1592425256831);

const TEST_MQTT_SERVER_PORT = 1885;
const TEST_HTTP_SERVER_PORT = 1881;

let httpServer = null;
let mqttClient = null;
let bridgeClient = null;
const mqttServer = killable(net.createServer(aedes.handle));

const bridgeConfig = config({
  bridges: {
    test: {
      mqttEndpoint: `mqtt://localhost:${TEST_MQTT_SERVER_PORT}`,
      clientId: 'BRIDGE_CLIENT',
      username: 'user',
      password: 'pass',
      topics: ['test/topic1', 'test/topic2', 'telemetry/#'],
      httpEndpoints: [`http://localhost:${TEST_HTTP_SERVER_PORT}`]
    }
  }
}).bridges.test;

beforeAll(() => {
  mqttServer.listen(TEST_MQTT_SERVER_PORT);
});

afterAll(async () => {
  await new Promise((r) => { aedes.close(r); });
  await new Promise((r) => { mqttServer.kill(r); });
});

afterEach(async () => {
  if (httpServer) { await new Promise((r) => { httpServer.kill(r); }); }
  if (mqttClient) { await mqttClient.end(); }
  if (bridgeClient) { await bridgeClient._mqttClient.end(); }
});


test('number of http messages equals number of mqtt publishes on a single topic', async () => {

  const publishCount = 100;
  let httpCount = 0;

  httpServer = killable(http.createServer((req, res) => {
    httpCount++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  }));

  httpServer.listen(TEST_HTTP_SERVER_PORT);

  bridgeClient = await bridge(log, bridgeConfig);
  mqttClient = await mqtt.connectAsync(`mqtt://localhost:${TEST_MQTT_SERVER_PORT}`, { clientId: 'TEST_CLIENT' });

  const pubs = [];
  for (let idx = 0; idx < publishCount; idx++) {
    pubs.push(mqttClient.publish('test/topic1', 'Hello'));
  }

  await Promise.all(pubs);

  await new Promise((resolve) => {
    const check = () => {
      if (httpCount === publishCount) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };

    check();
  });

  expect(httpCount).toBe(publishCount);
});

test('number of http messages equals number of mqtt publishes on two topics', async () => {

  const publishCount = 25;
  let httpCount = 0;

  httpServer = killable(http.createServer((req, res) => {
    httpCount++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  }));

  httpServer.listen(TEST_HTTP_SERVER_PORT);

  bridgeClient = await bridge(log, bridgeConfig);
  mqttClient = await mqtt.connectAsync(`mqtt://localhost:${TEST_MQTT_SERVER_PORT}`, { clientId: 'TEST_CLIENT' });


  const pubs = [];
  for (let idx = 0; idx < publishCount; idx++) {
    pubs.push(mqttClient.publish('test/topic1', 'Hello'));
    pubs.push(mqttClient.publish('test/topic2', 'Hello'));
  }

  await Promise.all(pubs);

  await new Promise((resolve) => {
    const check = () => {
      if (httpCount === publishCount * 2) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };

    check();
  });

  expect(httpCount).toBe(publishCount * 2);
});

test('published message is in the http body', async () => {

  const responsePromise = new Promise((resolve) => {
    httpServer = killable(http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        resolve(body);
      });
    }));
  });

  httpServer.listen(TEST_HTTP_SERVER_PORT);

  bridgeClient = await bridge(log, bridgeConfig);
  mqttClient = await mqtt.connectAsync(`mqtt://localhost:${TEST_MQTT_SERVER_PORT}`, { clientId: 'TEST_CLIENT' });

  await mqttClient.publish('test/topic1', 'Hello');

  const response = await responsePromise;
  expect(response).toBe('{"topic":"test/topic1","message":"Hello","time":1592425256831}');
});

test('wildcards work', async () => {

  const responsePromise = new Promise((resolve) => {
    httpServer = killable(http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        resolve(body);
      });
    }));
  });

  httpServer.listen(TEST_HTTP_SERVER_PORT);

  bridgeClient = await bridge(log, bridgeConfig);
  mqttClient = await mqtt.connectAsync(`mqtt://localhost:${TEST_MQTT_SERVER_PORT}`, { clientId: 'TEST_CLIENT' });

  await mqttClient.publish('telemetry/00:1B:44:11:3A:B7/temperature', 'Hello');

  const response = await responsePromise;
  expect(response).toBe('{"topic":"telemetry/00:1B:44:11:3A:B7/temperature","message":"Hello","time":1592425256831}');

});
