'use strict';

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, colorize, printf, splat } = format;

const line = printf(({ level, message, timestamp }) => {
  return `${timestamp}: level=${level}, ${message}`;
});


function makeLogger(level = 'info') {
  return createLogger({
    level,
    format: combine(
      splat(),
      timestamp(),
      colorize(),
      line
    ),
    transports: [new transports.Console()],
  });
}

module.exports = { makeLogger };
