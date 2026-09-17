// © 2013 - 2016 Rob Wu <rob@robwu.nl>
// Released under the MIT license

'use strict';

var httpProxy = require('httpxy');
var net = require('net');
var url = require('url');
var regexp_tld = require('./regexp-top-level-domain');
var getProxyForUrl = require('proxy-from-env').getProxyForUrl;

var sensitiveHeaders = ['authorization', 'proxy-authorization', 'cookie', 'cookie2', 'x-api-key', 'x-auth-token'];

function canonicalHostname(hostname) {
  // Legacy url.parse preserves IPv6 spelling; equivalent literals share an origin.
  return net.isIPv6(hostname) ? new URL('http://[' + hostname + ']/').hostname : hostname;
}

function sameOrigin(left, right) {
  return left.protocol === right.protocol && canonicalHostname(left.hostname) === canonicalHostname(right.hostname) &&
    Number(left.port || (left.protocol === 'https:' ? 443 : 80)) ===
    Number(right.port || (right.protocol === 'https:' ? 443 : 80));
}

var help_text = {};
function showUsage(help_file, headers, response) {
  var isHtml = /\.html$/.test(help_file);
  headers['content-type'] = isHtml ? 'text/html' : 'text/plain';
  if (help_text[help_file] != null) {
    response.writeHead(200, headers);
    response.end(help_text[help_file]);
  } else {
    require('fs').readFile(help_file, 'utf8', function(err, data) {
      if (err) {
        console.error(err);
        response.writeHead(500, headers);
        response.end();
      } else {
        help_text[help_file] = data;
        showUsage(help_file, headers, response); // Recursive call, but since data is a string, the recursion will end
      }
    });
  }
}

/**
 * Check whether the specified hostname is valid.
 *
 * @param hostname {string} Host name (excluding port) of requested resource.
 * @return {boolean} Whether the requested resource can be accessed.
 */
function isValidHostName(hostname) {
  return !!(
    regexp_tld.test(hostname) ||
    net.isIPv4(hostname) ||
    net.isIPv6(hostname)
  );
}

/**
 * Adds CORS headers to the response headers.
 *
 * @param headers {object} Response headers
 * @param request {ServerRequest}
 */
function withCORS(headers, request) {
  headers['access-control-allow-origin'] = '*';
  var corsMaxAge = request.corsAnywhereRequestState.corsMaxAge;
  if (request.method === 'OPTIONS' && corsMaxAge) {
    headers['access-control-max-age'] = corsMaxAge;
  }
  if (request.headers['access-control-request-method']) {
    headers['access-control-allow-methods'] = request.headers['access-control-request-method'];
    delete request.headers['access-control-request-method'];
  }
  if (request.headers['access-control-request-headers']) {
    headers['access-control-allow-headers'] = request.headers['access-control-request-headers'];
    delete request.headers['access-control-request-headers'];
  }

  headers['access-control-expose-headers'] = Object.keys(headers).join(',');

  return headers;
}

/**
 * Performs the actual proxy request.
 *
 * @param req {ServerRequest} Incoming http request
 * @param res {ServerResponse} Outgoing (proxied) http request
 * @param proxy {HttpProxy}
 */
function proxyRequest(req, res, proxy) {
  var location = req.corsAnywhereRequestState.location;
  req.url = location.path;

  var proxyOptions = Object.assign({}, req.corsAnywhereRequestState.httpProxyOptions, {
    changeOrigin: false,
    prependPath: false,
    target: {
      protocol: location.protocol,
      hostname: location.hostname,
      port: location.port,
    },
    followRedirects: false,
    headers: {
      host: location.host,
    },
  });

  // The HTTP server already answers Expect: 100-continue. Do not initiate a
  // second handshake upstream; this also keeps the proxyReq hook available.
  delete req.headers.expect;

  var proxyThroughUrl = req.corsAnywhereRequestState.getProxyForUrl(location.href);
  if (proxyThroughUrl) {
    proxyOptions.target = proxyThroughUrl;
    proxyOptions.toProxy = true;
    // If a proxy URL was set, req.url must be an absolute URL. Then the request will not be sent
    // directly to the proxied URL, but through another proxy.
    req.url = location.href;
  }

  // Enforce the policy after configured headers and on every redirect hop.
  var blockedHeaders = req.corsAnywhereRequestState.blockedSensitiveHeaders;
  Object.keys(req.headers).forEach(function(header) {
    if (blockedHeaders.indexOf(header.toLowerCase()) !== -1) {
      delete req.headers[header];
    }
  });
  // httpxy mutates ssl as its outgoing request options; isolate every hop.
  if (proxyOptions.ssl) {
    proxyOptions.ssl = Object.assign({}, proxyOptions.ssl);
  }
  if (blockedHeaders.indexOf('authorization') !== -1) {
    delete proxyOptions.auth;
    if (proxyOptions.ssl) {
      delete proxyOptions.ssl.auth;
    }
  }

  // Start proxying the request
  try {
    proxy.web(req, res, proxyOptions).catch(function(err) {
      proxy.emit('error', err, req, res);
    });
  } catch (err) {
    proxy.emit('error', err, req, res);
  }
}

/**
 * This method modifies the response headers of the proxied response.
 * If a redirect is detected, the response is not sent to the client,
 * and a new request is initiated.
 *
 * client (req) -> CORS Relay -> (proxyReq) -> other server
 * client (res) <- CORS Relay <- (proxyRes) <- other server
 *
 * @param proxy {HttpProxy}
 * @param proxyRes {ServerResponse} The response from the other server.
 * @param req {IncomingMessage} Incoming HTTP request, augmented with property corsAnywhereRequestState
 * @param req.corsAnywhereRequestState {object}
 * @param req.corsAnywhereRequestState.location {object} See parseURL
 * @param req.corsAnywhereRequestState.getProxyForUrl {function} See proxyRequest
 * @param req.corsAnywhereRequestState.proxyBaseUrl {string} Base URL of the CORS API endpoint
 * @param req.corsAnywhereRequestState.maxRedirects {number} Maximum number of redirects
 * @param req.corsAnywhereRequestState.redirectCount_ {number} Internally used to count redirects
 * @param res {ServerResponse} Outgoing response to the client that wanted to proxy the HTTP request.
 *
 * @returns {boolean} true if httpxy should continue to pipe proxyRes to res.
 */
function onProxyResponse(proxy, proxyRes, req, res) {
  var requestState = req.corsAnywhereRequestState;

  var statusCode = proxyRes.statusCode;

  if (!requestState.redirectCount_) {
    res.setHeader('x-request-url', requestState.location.href);
  }
  // Handle redirects
  if (statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) {
    var locationHeader = proxyRes.headers.location;
    var parsedLocation;
    if (locationHeader) {
      locationHeader = url.resolve(requestState.location.href, locationHeader);
      parsedLocation = parseURL(locationHeader);
    }
    if (parsedLocation) {
      if (statusCode === 301 || statusCode === 302 || statusCode === 303) {
        // Exclude 307 & 308, because they are rare, and require preserving the method + request body
        requestState.redirectCount_ = requestState.redirectCount_ + 1 || 1;
        if (requestState.redirectCount_ <= requestState.maxRedirects) {
          // Handle redirects within the server, because some clients (e.g. Android Stock Browser)
          // cancel redirects.
          // Set header for debugging purposes. Do not try to parse it!
          res.setHeader('X-CORS-Redirect-' + requestState.redirectCount_, statusCode + ' ' + locationHeader);

          req.method = 'GET';
          req.headers['content-length'] = '0';
          delete req.headers['content-type'];
          delete req.headers['transfer-encoding'];
          if (!sameOrigin(requestState.location, parsedLocation)) {
            // Once an origin boundary is crossed, never restore credentials in this chain.
            requestState.blockedSensitiveHeaders = sensitiveHeaders;
          }
          requestState.location = parsedLocation;

          // Drain this response before the next hop. httpxy owns stream cleanup;
          // aborting it would also close the downstream response. Use an empty
          // body for the redirected GET even if the original upload is unfinished.
          requestState.httpProxyOptions = Object.assign({}, requestState.httpProxyOptions, {
            buffer: require('stream').Readable.from([]),
          });
          proxyRes.once('end', function() {
            if (!res.destroyed) {
              proxyRequest(req, res, proxy);
            }
          });
          proxyRes.resume();
          return false;
        }
      }
      proxyRes.headers.location = requestState.proxyBaseUrl + '/' + locationHeader;
    }
  }

  // Strip cookies
  delete proxyRes.headers['set-cookie'];
  delete proxyRes.headers['set-cookie2'];

  proxyRes.headers['x-final-url'] = requestState.location.href;
  withCORS(proxyRes.headers, req);
  return true;
}


/**
 * @param req_url {string} The requested URL (scheme is optional).
 * @return {object} URL parsed using url.parse
 */
function parseURL(req_url) {
  var match = req_url.match(/^(?:(https?:)?\/\/)?(([^\/?]+?)(?::(\d{0,5})(?=[\/?]|$))?)([\/?][\S\s]*|$)/i);
  //                              ^^^^^^^          ^^^^^^^^      ^^^^^^^                ^^^^^^^^^^^^
  //                            1:protocol       3:hostname     4:port                 5:path + query string
  //                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //                                            2:host
  if (!match) {
    return null;
  }
  if (!match[1]) {
    if (/^https?:/i.test(req_url)) {
      // The pattern at top could mistakenly parse "http:///" as host="http:" and path=///.
      return null;
    }
    // Scheme is omitted.
    if (req_url.lastIndexOf('//', 0) === -1) {
      // "//" is omitted.
      req_url = '//' + req_url;
    }
    req_url = (match[4] === '443' ? 'https:' : 'http:') + req_url;
  }
  var parsed = url.parse(req_url);
  if (!parsed.hostname) {
    // "http://:1/" and "http:/notenoughslashes" could end up here.
    return null;
  }
  return parsed;
}

// Request handler factory
function getHandler(options, proxy, httpProxyOptions) {
  var corsAnywhere = {
    handleInitialRequest: null,     // Function that may handle the request instead, by returning a truthy value.
    getProxyForUrl: getProxyForUrl, // Function that specifies the proxy to use
    maxRedirects: 5,                // Maximum number of redirects to be followed.
    originBlacklist: [],            // Requests from these origins will be blocked.
    originWhitelist: [],            // If non-empty, requests not from an origin in this list will be blocked.
    checkRateLimit: null,           // Function that may enforce a rate-limit by returning a non-empty string.
    redirectSameOrigin: false,      // Redirect the client to the requested URL for same-origin requests.
    requireHeader: null,            // Require a header to be set?
    removeHeaders: [],              // Strip these request headers.
    allowSensitiveHeaders: [],      // Explicitly allow selected credential headers on the initial origin.
    setHeaders: {},                 // Set these request headers.
    corsMaxAge: 0,                  // If set, an Access-Control-Max-Age header with this value (in seconds) will be added.
    helpFile: __dirname + '/help.txt',
  };

  Object.keys(corsAnywhere).forEach(function(option) {
    if (Object.prototype.hasOwnProperty.call(options, option)) {
      corsAnywhere[option] = options[option];
    }
  });

  if (!Array.isArray(corsAnywhere.allowSensitiveHeaders)) {
    throw new TypeError('allowSensitiveHeaders must be an array of sensitive header names');
  }
  var allowedHeaders = corsAnywhere.allowSensitiveHeaders.map(function(header) {
    if (typeof header !== 'string' || sensitiveHeaders.indexOf(header.toLowerCase()) === -1) {
      throw new TypeError('Unknown sensitive header in allowSensitiveHeaders: ' + header);
    }
    return header.toLowerCase();
  });
  var blockedHeaders = sensitiveHeaders.filter(function(header) {
    return allowedHeaders.indexOf(header) === -1;
  });

  // Convert corsAnywhere.requireHeader to an array of lowercase header names, or null.
  if (corsAnywhere.requireHeader) {
    if (typeof corsAnywhere.requireHeader === 'string') {
      corsAnywhere.requireHeader = [corsAnywhere.requireHeader.toLowerCase()];
    } else if (!Array.isArray(corsAnywhere.requireHeader) || corsAnywhere.requireHeader.length === 0) {
      corsAnywhere.requireHeader = null;
    } else {
      corsAnywhere.requireHeader = corsAnywhere.requireHeader.map(function(headerName) {
        return headerName.toLowerCase();
      });
    }
  }
  var hasRequiredHeaders = function(headers) {
    return !corsAnywhere.requireHeader || corsAnywhere.requireHeader.some(function(headerName) {
      return Object.hasOwnProperty.call(headers, headerName);
    });
  };

  return function(req, res) {
    req.corsAnywhereRequestState = {
      httpProxyOptions: httpProxyOptions,
      getProxyForUrl: corsAnywhere.getProxyForUrl,
      maxRedirects: corsAnywhere.maxRedirects,
      blockedSensitiveHeaders: blockedHeaders,
      corsMaxAge: corsAnywhere.corsMaxAge,
    };

    var cors_headers = withCORS({}, req);
    if (req.method === 'OPTIONS') {
      // Pre-flight request. Reply successfully:
      res.writeHead(200, cors_headers);
      res.end();
      return;
    }

    var location;
    try {
      location = parseURL(req.url.slice(1));
    } catch {
      // Legacy URL parsing can throw for malformed IPv6 or escaped userinfo.
      res.writeHead(400, 'Invalid URL', cors_headers);
      res.end('The URL is invalid.');
      return;
    }

    if (corsAnywhere.handleInitialRequest && corsAnywhere.handleInitialRequest(req, res, location)) {
      return;
    }

    if (!location) {
      // Special case http:/notenoughslashes, because new users of the library frequently make the
      // mistake of putting this application behind a server/router that normalizes the URL.
      // See https://github.com/Rob--W/cors-anywhere/issues/238#issuecomment-629638853
      if (/^\/https?:\/[^/]/i.test(req.url)) {
        res.writeHead(400, 'Missing slash', cors_headers);
        res.end('The URL is invalid: two slashes are needed after the http(s):.');
        return;
      }
      // Invalid API call. Show how to correctly use the API
      showUsage(corsAnywhere.helpFile, cors_headers, res);
      return;
    }

    if (location.host === 'iscorsneeded') {
      // Is CORS needed? This path is provided so that API consumers can test whether it's necessary
      // to use CORS. The server's reply is always No, because if they can read it, then CORS headers
      // are not necessary.
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end('no');
      return;
    }

    if (location.port > 65535) {
      // Port is higher than 65535
      res.writeHead(400, 'Invalid port', cors_headers);
      res.end('Port number too large: ' + location.port);
      return;
    }

    if (!/^\/https?:/.test(req.url) && !isValidHostName(location.hostname)) {
      // Don't even try to proxy invalid hosts (such as /favicon.ico, /robots.txt)
      res.writeHead(404, 'Invalid host', cors_headers);
      res.end('Invalid host: ' + location.hostname);
      return;
    }

    if (!hasRequiredHeaders(req.headers)) {
      res.writeHead(400, 'Header required', cors_headers);
      res.end('Missing required request header. Must specify one of: ' + corsAnywhere.requireHeader);
      return;
    }

    var origin = req.headers.origin || '';
    if (corsAnywhere.originBlacklist.indexOf(origin) >= 0) {
      res.writeHead(403, 'Forbidden', cors_headers);
      res.end('The origin "' + origin + '" was blacklisted by the operator of this proxy.');
      return;
    }

    if (corsAnywhere.originWhitelist.length && corsAnywhere.originWhitelist.indexOf(origin) === -1) {
      res.writeHead(403, 'Forbidden', cors_headers);
      res.end('The origin "' + origin + '" was not whitelisted by the operator of this proxy.');
      return;
    }

    var rateLimitMessage = corsAnywhere.checkRateLimit && corsAnywhere.checkRateLimit(origin);
    if (rateLimitMessage) {
      res.writeHead(429, 'Too Many Requests', cors_headers);
      res.end('The origin "' + origin + '" has sent too many requests.\n' + rateLimitMessage);
      return;
    }

    if (corsAnywhere.redirectSameOrigin && origin && location.href[origin.length] === '/' &&
        location.href.lastIndexOf(origin, 0) === 0) {
      // Send a permanent redirect to offload the server. Badly coded clients should not waste our resources.
      cors_headers.vary = 'origin';
      cors_headers['cache-control'] = 'private';
      cors_headers.location = location.href;
      res.writeHead(301, 'Please use a direct request', cors_headers);
      res.end();
      return;
    }

    var isRequestedOverHttps = req.connection.encrypted || /^\s*https/.test(req.headers['x-forwarded-proto']);
    var proxyBaseUrl = (isRequestedOverHttps ? 'https://' : 'http://') + req.headers.host;

    corsAnywhere.removeHeaders.forEach(function(header) {
      delete req.headers[header];
    });

    Object.keys(corsAnywhere.setHeaders).forEach(function(header) {
      req.headers[header] = corsAnywhere.setHeaders[header];
    });

    req.corsAnywhereRequestState.location = location;
    req.corsAnywhereRequestState.proxyBaseUrl = proxyBaseUrl;

    proxyRequest(req, res, proxy);
  };
}

// Create server with default and given values
// Creator still needs to call .listen()
exports.createServer = function createServer(options) {
  options = options || {};

  // Default options:
  var httpProxyOptions = {
    agent: false,          // Preserve per-request connections unless explicitly configured.
    xfwd: true,            // Append X-Forwarded-* headers
    secure: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  };
  // Allow user to override defaults and add own options
  if (options.httpProxyOptions) {
    Object.keys(options.httpProxyOptions).forEach(function(option) {
      httpProxyOptions[option] = options.httpProxyOptions[option];
    });
  }

  // Pass user options per request: httpxy server options take precedence over them.
  var proxy = httpProxy.createProxyServer({prependPath: false});
  proxy.on('proxyReq', function(proxyReq, req, res, proxyOptions) {
    if (proxyOptions.toProxy) {
      // httpxy 0.5.5 prefixes absolute-form request targets with a slash.
      proxyReq.path = req.url;
    }
    proxyReq.prependListener('response', function(proxyRes) {
      try {
        if (!onProxyResponse(proxy, proxyRes, req, res)) {
          proxyOptions.selfHandleResponse = true;
        }
      } catch (err) {
        proxyOptions.selfHandleResponse = true;
        proxyRes.resume();
        proxy.emit('error', err, req, res);
      }
    });
  });
  var requestHandler = getHandler(options, proxy, httpProxyOptions);
  var server;
  if (options.httpsOptions) {
    server = require('https').createServer(options.httpsOptions, requestHandler);
  } else {
    server = require('http').createServer(requestHandler);
  }

  // When the server fails, just show a 404 instead of Internal server error
  proxy.on('error', function(err, req, res) {
    if (res.destroyed) {
      return;
    }
    if (res.headersSent) {
      // This could happen when a protocol error occurs when an error occurs
      // after the headers have been received (and forwarded). Do not write
      // the headers because it would generate an error.
      // Prior to Node 13.x, the stream would have ended.
      // As of Node 13.x, we must explicitly close it.
      if (res.writableEnded === false) {
        res.end();
      }
      return;
    }

    // When the error occurs after setting headers but before writing the response,
    // then any previously set headers must be removed.
    var headerNames = res.getHeaderNames ? res.getHeaderNames() : Object.keys(res._headers || {});
    headerNames.forEach(function(name) {
      res.removeHeader(name);
    });

    res.writeHead(404, {'Access-Control-Allow-Origin': '*'});
    res.end('Not found because of proxy error: ' + err);
  });

  return server;
};
