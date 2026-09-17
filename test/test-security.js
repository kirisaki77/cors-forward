var assert = require('assert');
var http = require('http');
var httpProxy = require('http-proxy');
var createServer = require('../').createServer;

describe('Proxy dependency security regressions', function() {
  var upstream;
  var server;
  var target;

  beforeEach(function(done) {
    upstream = http.createServer(function(req, res) {
      var body = '';
      req.setEncoding('utf8');
      req.on('data', function(chunk) { body += chunk; });
      req.on('end', function() {
        res.setHeader('Content-Type', 'text/plain');
        res.end(body || 'ok');
      });
    });
    upstream.listen(0, '127.0.0.1', function() {
      target = 'http://127.0.0.1:' + upstream.address().port;
      done();
    });
  });

  afterEach(function(done) {
    function closeUpstream() { upstream.close(done); }
    if (server) {
      server.close(closeUpstream);
      server = null;
    } else {
      closeUpstream();
    }
  });

  function post(path, expectContinue, callback) {
    var body = 'x'.repeat(65536);
    var headers = {'content-length': Buffer.byteLength(body)};
    if (expectContinue) {
      headers.expect = '100-continue';
    }
    var req = http.request({
      hostname: '127.0.0.1', port: server.address().port,
      path: path, method: 'POST', headers: headers, agent: false,
    }, function(res) {
      var result = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { result += chunk; });
      res.on('end', function() {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(result, body);
        callback(res);
      });
    });
    req.on('error', function(err) { throw err; });
    req.end(body);
  }

  // GHSA-6x33-pw7p-hmpq: Expect causes headers to be sent before the
  // proxyReq hook. Calling setHeader there must not crash the process.
  it('skips the header mutation hook for Expect, but retains it for normal POST', function(done) {
    var proxy = httpProxy.createProxyServer({target: target});
    var hookCalls = 0;
    proxy.on('proxyReq', function(proxyReq) {
      ++hookCalls;
      proxyReq.setHeader('x-regression-test', 'present');
    });
    proxy.on('error', done);
    server = http.createServer(function(req, res) { proxy.web(req, res); });
    server.listen(0, '127.0.0.1', function() {
      post('/', true, function() {
        assert.strictEqual(hookCalls, 0);
        post('/', false, function() {
          assert.strictEqual(hookCalls, 1);
          done();
        });
      });
    });
  });

  [false, true].forEach(function(expectContinue) {
    it('forwards a large POST through CORS Anywhere (Expect=' + expectContinue + ')', function(done) {
      server = createServer({getProxyForUrl: function() { return ''; }});
      server.listen(0, '127.0.0.1', function() {
        post('/' + target, expectContinue, function(res) {
          assert.strictEqual(res.headers['access-control-allow-origin'], '*');
          assert.strictEqual(res.headers['x-final-url'], target + '/');
          done();
        });
      });
    });
  });
});
