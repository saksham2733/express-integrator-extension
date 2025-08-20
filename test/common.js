const { logger } = require('@celigo/logger')

var consoleTransportOpts = {
  colorize: true,
  timestamp: true,
  prettyPrint: true
}

// @celigo/logger already configures console output; adjust level/format if needed
