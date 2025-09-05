'use strict'

const errors = require('./errors')
const extension = require('./extension')
const { customAlphabet } = require('nanoid')
const { makeLogger } = require('./logger')
const logger = makeLogger()
const requestContext = require('./request-context')
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 4)
const nodeUtil = require('util')

module.exports = function (app) {
  app.get('/', function (req, res) {
    res.json({ success: true })
  })

  app.get('/healthCheck', function (req, res) {
    res.json({ success: true })
  })

  app.get('/livez', function (req, res) {
    if (global.__isInTerminatingState__) {
      logger.error('logName=healthCheckFailure, message=applicationInTerminatingState')
      return res.sendStatus(503)
    }
    if (app.get('__server_live__')) {
      return res.sendStatus(200)
    }
    return res.sendStatus(400)
  })

  app.get('/readyz', function (req, res) {
    if (global.__isInTerminatingState__) {
      logger.error('logName=healthCheckFailure, message=applicationInTerminatingState')
      return res.sendStatus(503)
    }
    if (app.get('__server_ready__')) {
      return res.sendStatus(200)
    }
    return res.sendStatus(400)
  })

  app.post('/function',
    authenticate,
    callFunction
  )

  app.get('/openConnections',
    noOfConnectionsFn
  )

  app.get('/stopServer',
    stopServerFn
  )
}

function authenticate (req, res, next) {
  if (extension.isAuthorized(req)) return next()
  res.set('WWW-Authenticate', 'invalid system token')
  return res.status(401).json({ errors: [errors.get('ROUTES_INVALID_SYSTEM_TOKEN')] })
}

function callFunction (req, res, next) {
  req.body.traceId = req?.headers?.traceid
  req.body._reqId = Date.now() + nanoid()
  const heartBeatEvent = setTimeout(() => {
    if (!res.writableEnded) res.writeProcessing()
  }, 270000)

  const functionOptions = req.body.options || undefined
  const extensionOptions = req.body || undefined
  const ctx = {
    _integrationId: functionOptions?._integrationId,
    _flowId: functionOptions?._flowId,
    _exportId: functionOptions?._exportId,
    _importId: functionOptions?._importId,
    _connectionId: functionOptions?.connection?._id || functionOptions?._connectionId || extensionOptions.connectionId,
    _connectorId: extensionOptions?._connectorId,
    type: extensionOptions?.type,
    function: extensionOptions?.function,
    _reqId: extensionOptions?._reqId,
    traceId: extensionOptions?.traceId
  }

  requestContext.runWithContext(ctx, function () {
    extension.callFunction(functionOptions, extensionOptions, function (err, result) {
      clearTimeout(heartBeatEvent)
      if (err) {
        return res.status(err.statusCode).json({ errors: err.errors })
      }
      return res.json(result)
    })
  })
}

function getNoOfActiveConnections (req, callback) {
  req.socket.server.getConnections((err, noOfOpenConnections) => {
    if (err) {
      logger.error(`logName=shouldNeverHappen, message=failedToFetchNoOfConnections, err=${nodeUtil.inspect(err, null, { depth: 4 })}`)
    }
    return callback(noOfOpenConnections - 1)
  })
}

async function noOfConnectionsFn (req, res, next) {
  if (req.query?.terminate === 'true') {
    global.__isInTerminatingState__ = true
  }
  getNoOfActiveConnections(req, (noOfOpenConnections) => {
    let activeConnectionLog = `logName=noOfOpenConnections, noOfOpenConnections=${noOfOpenConnections}`;
      if (global.__isInTerminatingState__) {
        activeConnectionLog += ', isTerminating=true'
      }
    logger.info(activeConnectionLog)
    res.end(noOfOpenConnections + '')
  })
}

async function stopServerFn (req, res, next) {
  logger.info('logName=serverHit, u=/stopServer')
  getNoOfActiveConnections(req, (noOfOpenConnections) => {
    if (noOfOpenConnections > 1) {
      logger.error(`logName=shouldNeverHappen, message=killServerCalledWhileConnectionStillOpen, noOfOpenConnections=${noOfOpenConnections}`)
      return res.status(422).json({
        errors: [{
          code: 'connections_still_open',
          message: `${noOfOpenConnections} connection(s) still open.`
        }]
      })
    }
    req.socket.server.close(() => {
      logger.info('logName=serverStopped')
      process.exit(1)
    })
    res.end('preparing to shut down.')
  })
}
