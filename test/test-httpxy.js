var assert = require('assert');
var http = require('http');
var request = require('supertest');
var createServer = require('../').createServer;

describe('httpxy integration', function() {
  var upstream;
  var target;

  before(function(done) {
    upstream = http.createServer(function(req, res) {
      if (req.url === '/redirect' || req.url === '/upload-redirect') {
        req.resume();
        res.writeHead(req.url === '/redirect' ? 302 : 303, {
          Location: '/echo//path?value=a%2Fb',
          'Set-Cookie': 'intermediate=secret',
          'X-Intermediate': 'hidden',
        });
        res.end('intermediate body');
        return;
      }
      if (req.url === '/307' || req.url === '/308') {
        req.resume();
        res.writeHead(Number(req.url.slice(1)), {Location: '/echo'});
        res.end('redirect body');
        return;
      }
      var body = '';
      req.setEncoding('utf8');
      req.on('data', function(chunk) { body += chunk; });
      req.on('end', function() {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Set-Cookie', 'final=secret');
        res.end(JSON.stringify({method: req.method, url: req.url, body: body, host: req.headers.host}));
      });
    });
    upstream.listen(0, '127.0.0.1', function() {
      target = 'http://127.0.0.1:' + upstream.address().port;
      done();
    });
  });

  after(function(done) { upstream.close(done); });

  function directServer(options) {
    return createServer(Object.assign({getProxyForUrl: function() { return ''; }}, options));
  }

  it('preserves repeated slashes and escaped query strings', function(done) {
    request(directServer())
      .get('/' + target + '/echo//path?value=a%2Fb')
      .expect(200)
      .expect(function(res) {
        assert.strictEqual(res.body.url, '/echo//path?value=a%2Fb');
        assert.strictEqual(res.body.host, '127.0.0.1:' + upstream.address().port);
      }).end(done);
  });

  it('connects to an IPv6 destination', function(done) {
    var context = this;
    var ipv6 = http.createServer(function(req, res) { res.end('IPv6 response'); });
    ipv6.once('error', function(err) {
      if (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT') {
        context.skip();
        return;
      }
      done(err);
    });
    ipv6.listen(0, '::1', function() {
      request(directServer())
        .get('/http://[::1]:' + ipv6.address().port + '/')
        .expect(200, 'IPv6 response')
        .end(function(err) { ipv6.close(function() { done(err); }); });
    });
  });

  it('follows real redirects without leaking intermediate headers or body', function(done) {
    var destinations = [];
    request(createServer({getProxyForUrl: function(url) { destinations.push(url); return ''; }}))
      .get('/' + target + '/redirect')
      .redirects(0)
      .expect(200)
      .expect('Access-Control-Allow-Origin', '*')
      .expect('x-cors-redirect-1', '302 ' + target + '/echo//path?value=a%2Fb')
      .expect('x-final-url', target + '/echo//path?value=a%2Fb')
      .expect(function(res) {
        assert.strictEqual(res.body.url, '/echo//path?value=a%2Fb');
        assert.strictEqual(res.headers['set-cookie'], undefined);
        assert.strictEqual(res.headers['x-intermediate'], undefined);
        assert.deepStrictEqual(destinations, [target + '/redirect', target + '/echo//path?value=a%2Fb']);
      }).end(done);
  });

  it('turns a chunked POST redirect into an empty GET', function(done) {
    var upload = request(directServer())
      .post('/' + target + '/upload-redirect')
      .set('Transfer-Encoding', 'chunked')
      .redirects(0)
      .expect(200)
      .expect(function(res) {
        assert.strictEqual(res.body.method, 'GET');
        assert.strictEqual(res.body.body, '');
      });
    upload.write('upload body');
    upload.end(done);
  });

  [307, 308].forEach(function(status) {
    it('returns ' + status + ' to the client with a rewritten Location', function(done) {
      request(directServer())
        .post('/' + target + '/' + status)
        .send('upload body')
        .redirects(0)
        .expect(status, 'redirect body')
        .expect(function(res) {
          assert.ok(res.headers.location.endsWith('/' + target + '/echo'));
        }).end(done);
    });
  });

  it('sends absolute-form URLs through a forward proxy, including Expect POSTs', function(done) {
    request(createServer({getProxyForUrl: function() { return target; }}))
      .post('/http://destination.example/echo?value=a%2Fb')
      .set('Expect', '100-continue')
      .send('upload body')
      .expect(200)
      .expect(function(res) {
        assert.strictEqual(res.body.url, 'http://destination.example/echo?value=a%2Fb');
        assert.strictEqual(res.body.host, 'destination.example');
        assert.strictEqual(res.body.body, 'upload body');
      }).end(done);
  });

  it('keeps the selected destination when advanced options contain another target', function(done) {
    request(directServer({httpProxyOptions: {target: 'http://127.0.0.1:1', changeOrigin: true}}))
      .get('/' + target + '/echo')
      .expect(200)
      .expect(function(res) {
        assert.strictEqual(res.body.host, '127.0.0.1:' + upstream.address().port);
      }).end(done);
  });
});

describe('redirect lifecycle', function() {
  function listen(server) {
    return new Promise(function(resolve) { server.listen(0, '127.0.0.1', resolve); });
  }

  function close(server) {
    return new Promise(function(resolve) { server.close(resolve); server.closeAllConnections(); });
  }

  ['prependListener', 'on'].forEach(function(register) {
    it('releases completed hop listeners and preserves caller listeners registered with ' + register, async function() {
      var incoming;
      var downstream;
      var counts = [];
      var callerError = function() {};
      var closeCount = 0;
      var onceCloseCount = 0;
      var pipeCloseCount = 0;
      var callerClose = function() { closeCount++; };
      var callerResponseError = function() {};
      var pipeError = function() {};
      var upstream = http.createServer(function(req, res) {
        counts.push([incoming.listenerCount('error'), downstream.listenerCount('close'), downstream.listenerCount('error')]);
        var hop = Number(req.url.slice(1));
        if (hop < 20) {
          res.writeHead(302, {Location: '/' + (hop + 1)});
          res.end('discard this hop');
        } else {
          res.end('finished');
        }
      });
      var proxy = createServer({maxRedirects: 20, getProxyForUrl: function() { return ''; }});
      proxy[register]('request', function(req, res) {
        incoming = req;
        downstream = res;
        req.on('error', callerError);
        res.on('close', callerClose);
        res.once('close', function() { onceCloseCount++; });
        res.on('error', callerResponseError);
        res.on('pipe', function() {
          res.on('error', pipeError);
          res.once('close', function() { pipeCloseCount++; });
        });
      });
      try {
        await listen(upstream);
        await request(proxy).get('/http://127.0.0.1:' + upstream.address().port + '/0')
          .redirects(0).expect(200, 'finished');
        await new Promise(setImmediate);
        assert.strictEqual(counts.length, 21);
        counts.forEach(function(count) {
          assert.ok(count[0] <= 2 && count[1] <= 5 && count[2] <= 2, 'listeners grew: ' + count);
        });
        assert.deepStrictEqual(incoming.listeners('error'), [callerError]);
        assert.deepStrictEqual(downstream.listeners('error'), [callerResponseError, pipeError]);
        assert.ok(downstream.listeners('close').includes(callerClose));
        assert.strictEqual(closeCount, 1);
        assert.strictEqual(onceCloseCount, 1);
        assert.strictEqual(pipeCloseCount, 1);
      } finally {
        await close(proxy);
        await close(upstream);
      }
    });
  });

  it('closes an unfinished redirect when the client disconnects without following it', async function() {
    this.timeout(4000);
    var hits = [];
    var client;
    var sawRedirect;
    var redirectStarted = new Promise(function(resolve) { sawRedirect = resolve; });
    var sawClose;
    var redirectClosed = new Promise(function(resolve) { sawClose = resolve; });
    var upstream = http.createServer(function(req, res) {
      hits.push(req.url);
      if (req.url === '/slow') {
        res.writeHead(302, {Location: '/unexpected'});
        res.write('unfinished redirect body');
        res.once('close', sawClose);
        sawRedirect();
      } else {
        res.end('healthy');
      }
    });
    var proxy = createServer({getProxyForUrl: function() { return ''; }});
    try {
      await listen(upstream);
      await listen(proxy);
      var target = '/http://127.0.0.1:' + upstream.address().port;
      client = http.get({hostname: '127.0.0.1', port: proxy.address().port, path: target + '/slow'});
      client.on('error', function() {});
      await redirectStarted;
      client.destroy();
      await redirectClosed;
      await request(proxy).get(target + '/healthy').expect(200, 'healthy');
      assert.deepStrictEqual(hits, ['/slow', '/healthy']);
    } finally {
      if (client) { client.destroy(); }
      await close(proxy);
      await close(upstream);
    }
  });
});
