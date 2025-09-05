'use strict'

var express = require('express')
var bodyParser = require('body-parser')
var routes = require('./routes')
var http = require('http')
var https = require('https')
var errors = require('./errors')
const { makeLogger } = require('./logger')
var logger = makeLogger()
var expressWinston = require('express-winston')
var extension = require('./extension')
var requestContext = require('./request-context')
var nodeUtil = require('util')

var server, port

function createServer (config, callback) {
  if (server) return callback(errors.getError('SERVER_ALREADY_CREATED'))

  extension.loadConfiguration(config, function (err) {
    if (err) return callback(err)
    // Set default to Infinity
    http.globalAgent.maxSockets = config.maxSockets || Infinity
    https.globalAgent.maxSockets = config.maxSockets || Infinity

    var app = express()

    app.use(bodyParser.json({ limit: '50mb' }))

    if (config.winstonInstance) logger = config.winstonInstance
    // creating ignore list to be logged in logger
    const routeIgnorelist = ['/livez', '/readyz']

    var expressLogConfig = {
      ignoreRoute: function (req, res) {
        return routeIgnorelist.indexOf(req.path) !== -1;
      },
      winstonInstance: logger,
      msg: 'logName=reqFinished, method={{req.method}}, url={{req.url}}, statusCode={{res.statusCode}}, responseTime={{res.responseTime}}ms{{req.url === "/function" ? ", _reqId=" + req.body._reqId : ""}}, traceId={{req.body.traceId}}',
      meta: false
    }

    app.use(expressWinston.logger(expressLogConfig))
    app.use(expressWinston.errorLogger(expressLogConfig))

    routes(app)
    port = config.port || 80

    server = app.listen(port, function () {
      logger.info('Express integrator-extension server listening on port: ' + port)
      return callback()
    })
    app.set('__server_ready__', true)
    app.set('__server_live__', true)

    server.on('error', function (err) {
      logger.error('Express integrator-extension server error - ' + err.toString())
    })

    // Timeout should be greater than the server's/load balancer's idle timeout to avoid 504 errors.
    server.timeout = config.timeout || 315000

    // we need to have a higher keep-alive timeout for the server than the idle-timeout
    // of the load balancer. This is recommended by AWS.
    server.keepAliveTimeout = config.keepAliveTimeout || 301000
    server.headersTimeout = config.headersTimeout || 305000

    function logFatalError (err, origin) {
      try {
        var ctx = requestContext.getStore() || {}
        var log = 'logName=fatalError, origin=' + (origin || 'unknown') + ', name=' + (err && err.name) + ', message=' + (err && err.message)
        if (ctx._integrationId) log += ', _integrationId=' + ctx._integrationId
        if (ctx._flowId) log += ', _flowId=' + ctx._flowId
        if (ctx._exportId) log += ', _exportId=' + ctx._exportId
        if (ctx._importId) log += ', _importId=' + ctx._importId
        if (ctx._connectionId) log += ', _connectionId=' + ctx._connectionId
        if (ctx._connectorId) log += ', _connectorId=' + ctx._connectorId
        if (ctx.type) log += ', type=' + ctx.type
        if (ctx.function) log += ', function=' + ctx.function
        if (ctx._reqId) log += ', _reqId=' + ctx._reqId
        if (ctx.traceId) log += ', traceId=' + ctx.traceId
        logger.error(log + ', err=' + nodeUtil.inspect(err, { depth: 3 }))
      } catch (e) {
        logger.error('logName=fatalErrorLoggingFailed, err=' + nodeUtil.inspect(e, { depth: 2 }))
      }
    }

    process.on('uncaughtException', function (err) {
      logFatalError(err, 'uncaughtException')
    })
    process.on('unhandledRejection', function (reason) {
      var err = reason instanceof Error ? reason : new Error(nodeUtil.inspect(reason))
      logFatalError(err, 'unhandledRejection')
    })
  })
}

function stopServer (callback) {
  if (!server) return callback(errors.getError('SERVER_NOT_FOUND'))
  server.close(function (err) {
    if (err) return callback(err)
    server = undefined

    logger.info('Express integrator-extension server stopped listening on port: ' + port)
    return callback()
  })
}

exports.createServer = createServer
exports.stopServer = stopServer
