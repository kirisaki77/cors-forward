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
