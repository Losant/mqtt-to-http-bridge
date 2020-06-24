const config = require('./config');
const bridge = require('./bridge');

/* eslint-disable no-console */

// If the process was executed with no arguments
// print some basic usage information.
if (process.argv.length < 3) {
  console.log('Usage: mqtt-to-http-bridge <config file path>');
  console.log('Example: mqtt-to-http-bridge "/path/to/config.toml"');
  process.exit(1);
}

// Attempt to load and parse the configuration file.
let conf = null;
try {
  conf = config(process.argv[2]);
} catch (err) {
  console.log(`ERROR: ${err.message}`);
  process.exit(1);
}

// Create all the bridges.
const log = require('./log')(conf.logLevel);
const bridges = [];
for (const name in conf.bridges) {
  if (Object.prototype.hasOwnProperty.call(conf.bridges, name)) {
    bridge(log, conf.bridges[name]).then((b) => bridges.push(b)).catch((err) => {
      console.log(`ERROR: ${err.message}`);
      process.exit(1);
    });
  }
}

// If diagnostics environment variable is set to true,
// print memory and queue lengths every minute.
if (process.env.PRINT_DIAGNOSTICS === 'true') {
  let lastMessageCount = 0;

  const printDiagnostics = function() {
    const diagnostics = {
      rss: process.memoryUsage().rss / 1024 / 1024,
      queueLengths: bridges.map((b) => b.getQueueLength()),
      messageCount: bridges.map((b) => b.getMessageCount()).reduce((a, c) => a + c)
    };

    diagnostics.incremental = diagnostics.messageCount - lastMessageCount;
    lastMessageCount = diagnostics.messageCount;

    log.diagnostics(diagnostics);
  };

  setInterval(printDiagnostics, 60000);
}
