'use strict'

const { AsyncLocalStorage } = require('async_hooks')

const asyncLocalStorage = new AsyncLocalStorage()

function runWithContext (context, fn) {
  return asyncLocalStorage.run(context || {}, fn)
}

function getStore () {
  return asyncLocalStorage.getStore()
}

module.exports = {
  runWithContext,
  getStore
}

