/* eslint no-unused-vars: 0 */
/**
 * The main server that wrap in the stream
 */
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const helmet = require('helmet');
const express = require('express');
const bodyParser = require('body-parser');
const httpProxy = require('http-proxy-middleware');
// Shorthands
const join = path.join;
const isarray = Array.isArray;
// Properties
const { createConfiguration } = require('./options');
// Modules
const { toArray } = require('./utils/helper');
const logutil = require('./utils/log');
const mockServer = require('./utils/mock-server');
const debuggerClient = require('./debugger/client');
const { scriptsInjector, filesInjector } = require('./injector');
/**
 * Export
 * @param {object} options
 * @return {object} app and config for destructing
 */
module.exports = function(options) {
  // Config the config options
  let config = options.__processed__ === true ? options : createConfiguration(options);
  // Init the app
  const app = express();
  let addDebugger = false;
  // Fixed on 1.4.0-beta.3
  let proxies = config.proxies;
  // Default callbacks
  const closeFn = { close: () => {} };
  let mockServerInstance = closeFn;
  let debuggerInstance = closeFn;
  // Properties
  let middlewares = proxies.length
    ? []
    : [bodyParser.urlencoded({ extended: true }), bodyParser.json()];
  if (config.development) {
    middlewares.push(helmet.noCache());
  }
  // Make sure the namespace is correct first
  if (config.debugger.enable && config.development) {
    const namespace = config.debugger.namespace;
    if (!namespace) {
      config.debugger.namespace = '/debugger-io';
    } else if (namespace.substr(0, 1) !== '/') {
      config.debugger.namespace = '/' + namespace;
    }
    addDebugger = config.debugger.client !== false;
  }
  // Live reload and inject debugger
  if (config.reload.enable || addDebugger) {
    middlewares.push(
      scriptsInjector(
        {
          reload: config.reload.enable,
          debugger: addDebugger
        },
        config
      )
    );
  }
  // Init the debugger
  if (addDebugger) {
    middlewares.push(debuggerClient(config.debugger));
  }
  // Enable inject here
  if (config.inject.enable) {
    middlewares.push(filesInjector(config.inject));
  }
  // Extra middlewares pass directly from config
  if (typeof config.middleware === 'function') {
    middlewares.push(config.middleware);
  } else if (isarray(config.middleware)) {
    middlewares = middlewares.concat(config.middleware);
  }
  // Now inject the middlewares
  if (middlewares.length) {
    middlewares.filter(m => typeof m === 'function').forEach(m => app.use(m));
  }
  // First need to setup the mock json server
  if (config.mock.enable && config.mock.json && config.development) {
    // Here we overwrite the proxies so the proxy get to the mock server
    // @TODO sort out particular url that shouldn't be mock?
    const _mock = mockServer(config);
    mockServerInstance = _mock.server;
    // Overwrite the proxies @TODO look at how to merge multiple proxies
    proxies = _mock.proxies;
  }

  // Proxy requests final
  proxies.forEach(proxyoptions => {
    if (!proxyoptions.target || !proxyoptions.source) {
      console.log(chalk.red('Missing target or source property for proxy setting!'));
      return; // ignore!
    }
    let source = proxyoptions.source;
    delete proxyoptions.source;
    app.use(source, httpProxy(proxyoptions));
  });
  // This is the end - we continue in the next level to construct the server
  return { app, config, mockServerInstance };
};
