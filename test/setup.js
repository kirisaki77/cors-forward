var http = require('node:http');
var https = require('node:https');
var fs = require('node:fs');
var path = require('node:path');
var createServer = require('../').createServer;
var cert = fs.readFileSync(path.join(__dirname, 'cert.pem'));
var httpAgent = new http.Agent();
var httpsAgent = new https.Agent();
var httpFixture = http.createServer(respond);
var httpsFixture = https.createServer({
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: cert,
}, respond);
var fixtureHosts = ['example.com', 'example.com.com', 'prefix.example.com', 'robots.txt'];

// Route fixture connections locally while preserving the original request headers and URL.
var fixtureAgent = {
  addRequest: function(req, options) {
    var secure = (options.protocol || (options._defaultAgent || http.globalAgent).protocol) === 'https:';
    var hostname = options.hostname || options.host;
    var connection = Object.assign({}, options);
    if (fixtureHosts.includes(hostname)) {
      connection.hostname = connection.host = '127.0.0.1';
      connection.port = (secure ? httpsFixture : httpFixture).address().port;
      if (secure) {
        connection.ca = cert;
        connection.servername = 'localhost';
      }
    } else if (!['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname)) {
      process.nextTick(function() {
        req.destroy(new Error('Unexpected external test destination: ' + hostname));
      });
      return;
    }
    (secure ? httpsAgent : httpAgent).addRequest(req, connection);
  },
};

exports.createServer = function(options) {
  options = options || {};
  return createServer(Object.assign({}, options, {
    httpProxyOptions: Object.assign({agent: fixtureAgent}, options.httpProxyOptions),
  }));
};

before(async function() {
  await Promise.all([httpFixture, httpsFixture].map(function(server) {
    return new Promise(function(resolve, reject) {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  }));
});

after(async function() {
  httpAgent.destroy();
  httpsAgent.destroy();
  await Promise.all([httpFixture, httpsFixture].map(function(server) {
    return new Promise(function(resolve, reject) {
      server.close(function(error) { if (error) { reject(error); } else { resolve(); } });
    });
  }));
});

function respond(req, res) {
  function reply(status, body, headers) {
    req.resume();
    res.writeHead(status, Object.assign({'Content-Type': 'text/plain'}, headers));
    res.end(body);
  }
  if (req.method === 'GET' && req.url === '/echoheaders') {
    var excluded = ['accept-encoding', 'user-agent', 'connection', 'x-forwarded-for', 'test-include-xfwd'];
    if (!('test-include-xfwd' in req.headers)) {
      excluded.push('x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto');
    }
    var headers = {};
    Object.keys(req.headers).forEach(function(name) {
      if (!excluded.includes(name)) { headers[name] = req.headers[name]; }
    });
    return reply(200, JSON.stringify(headers), {'Content-Type': 'application/json'});
  }
  if (req.method === 'GET' && req.url === '/') {
    var host = req.headers.host.replace(req.socket.encrypted ? /:443$/ : /:80$/, '');
    var origin = (req.socket.encrypted ? 'https://' : '') + host;
    return reply(200, req.headers.host === 'robots.txt' ? 'this is http://robots.txt' : 'Response from ' + origin);
  }
  if (req.method === 'POST' && req.url === '/echopost') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return req.pipe(res);
  }
  if (req.method === 'GET' && req.url === '/setcookie') {
    return reply(200, '', {'Set-Cookie': 'x', 'Set-Cookie2': 'y', 'Set-Cookie3': 'z'});
  }
  if (req.method === 'GET' && req.url === '/redirecttarget') {
    return reply(200, 'redirect target', {'Some-header': 'value'});
  }
  if (['GET', 'POST'].includes(req.method) && req.url === '/redirectposttarget') {
    return reply(200, req.method === 'POST' ? 'post target (POST)' : 'post target');
  }
  if (['GET', 'HEAD'].includes(req.method) && req.url === '/redirect') {
    return reply(302, 'redirecting...', {Location: '/redirecttarget', 'header-at-redirect': 'should not be here'});
  }
  if (req.method === 'POST' && ['/redirectpost', '/redirect307'].includes(req.url)) {
    return reply(req.url === '/redirect307' ? 307 : 302, 'redirecting...', {Location: '/redirectposttarget'});
  }
  if (req.method === 'GET') {
    switch (req.url) {
      case '/redirect2redirect': return reply(302, 'redirecting to redirect...', {Location: '/redirect'});
      case '/redirectloop': return reply(302, 'redirecting ad infinitum...', {Location: '/redirectloop'});
      case '/redirectwithoutlocation': return reply(302, 'maybe found');
      case '/redirectinvalidlocation': return reply(302, 'redirecting to junk...', {Location: 'http:///'});
      case '/proxyerror': return req.socket.destroy();
    }
  }
  reply(500, 'Unexpected fixture request: ' + req.method + ' ' + req.url);
}
