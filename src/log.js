const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;

const logFormat = printf((m) => {
  return `${m.timestamp} [${m.level}]: ${typeof m.message === 'string' ? m.message : JSON.stringify(m.message, undefined, 2)}`;
});

const levels = {
  diagnostics: 0,
  error: 1,
  warn: 2,
  debug: 3
};

module.exports = (level) => {

  return createLogger({
    levels: levels,
    level: level,
    silent: level === 'none',
    format: combine(
      timestamp(),
      logFormat
    ),
    transports: [
      new transports.Console()
    ]
  });
};
