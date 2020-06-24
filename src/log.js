const debug = require('debug');

const logLevels = ['debug', 'warn', 'error', 'diagnostics', 'none'];

module.exports = (level) => {

  const levelIdx = logLevels.indexOf(level);
  const debugConfs = [];
  for (let idx = levelIdx; idx < logLevels.length; idx++) {
    debugConfs.push(`mqtt-http-bridge:${logLevels[idx]}`);
  }
  debug.enable(debugConfs.join(','));

  return {
    debug: debug('mqtt-http-bridge:debug'),
    warn: debug('mqtt-http-bridge:warn'),
    error: debug('mqtt-http-bridge:error'),
    diagnostics: debug('mqtt-http-bridge:diagnostics')
  };
};
