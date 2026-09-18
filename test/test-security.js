var assert = require('assert');
var http = require('http');
var httpProxy = require('httpxy');
var createServer = require('../').createServer;
var request = require('supertest');

describe('Request URL and credential boundaries', function() {
  var servers;
  var target;
  var otherTarget;
  var secureTarget;
  var seen;
  var credentials = {
    authorization: 'Bearer synthetic-token',
    'proxy-authorization': 'Basic synthetic-proxy-token',
    cookie: 'session=synthetic', cookie2: 'session2=synthetic',
    'x-api-key': 'synthetic-key', 'x-auth-token': 'synthetic-auth-token',
  };
  var names = Object.keys(credentials);

  async function listen(server, protocol) {
    servers.push(server);
    await new Promise(function(resolve, reject) {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return (protocol || 'http:') + '//127.0.0.1:' + server.address().port;
  }

  function echo(req, res) {
    seen.push(req.headers);
    var redirects = {
      '/same': '/echo', '/cross': otherTarget + '/echo',
      '/return': otherTarget + '/back', '/back': target + '/echo',
      '/downgrade': target + '/echo', '/upgrade': secureTarget + '/echo',
      '/hostname': 'http://localhost:' + servers[0].address().port + '/echo',
      '/bad-ipv6': 'http://[', '/bad-escape': 'http://%zz@example.com/',
    };
    if (redirects[req.url]) {
      res.writeHead(Number(req.headers['x-redirect-status']) || 302, {Location: redirects[req.url]});
      res.end();
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.headers));
    }
  }

  beforeEach(async function() {
    servers = [];
    seen = [];
    target = await listen(http.createServer(echo));
    otherTarget = await listen(http.createServer(echo));
    secureTarget = await listen(require('https').createServer({
      key: require('fs').readFileSync(__dirname + '/key.pem'),
      cert: require('fs').readFileSync(__dirname + '/cert.pem'),
    }, echo), 'https:');
  });

  afterEach(async function() {
    await Promise.all(servers.map(function(server) {
      return new Promise(function(resolve) { server.close(resolve); server.closeAllConnections(); });
    }));
  });

  function relay(options) {
    return createServer(Object.assign({getProxyForUrl: function() { return ''; }}, options));
  }

  function assertNoCredentials(headers) {
    names.forEach(function(name) { assert.strictEqual(headers[name], undefined, name); });
  }

  it('rejects malformed URLs before access checks and remains alive in an isolated process', async function() {
    this.timeout(10000);
    var child = require('child_process').spawn(process.execPath, ['-e',
      "var s=require(process.argv[1]).createServer({requireHeader:['x-required']," +
      "originWhitelist:['https://trusted.invalid'],getProxyForUrl:()=>''});" +
      "s.listen(0,'127.0.0.1',()=>process.send(s.address().port));",
      require('path').resolve(__dirname, '..'),
    ], {stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
    try {
      var port = await new Promise(function(resolve, reject) {
        var timer = setTimeout(function() { reject(new Error('Server startup timed out')); }, 3000);
        child.once('message', function(port) { clearTimeout(timer); resolve(port); });
        child.once('error', function(err) { clearTimeout(timer); reject(err); });
        child.once('exit', function(code) {
          clearTimeout(timer);
          reject(new Error('Server exited: ' + code));
        });
      });
      var client = request('http://127.0.0.1:' + port);
      for (var path of ['/http://[', '/http://%zz@example.com/', '/https://[::1', '/http://%E0%A4@example.com/']) {
        await client.get(path).timeout(2000).expect(400).expect('Access-Control-Allow-Origin', '*');
      }
      await client.get('/').timeout(2000).expect(200);
      await client.get('/' + target).set('x-required', 'yes').set('Origin', 'https://trusted.invalid')
        .timeout(2000).expect(200);
      assert.strictEqual(child.exitCode, null);
    } finally {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        var exited = new Promise(function(resolve) { child.once('exit', resolve); });
        child.kill();
        await exited;
      }
    }
  });

  it('strips credentials by default but preserves ordinary headers', async function() {
    var res = await request(relay()).get('/' + target).set(credentials).set('X-Custom', 'keep').expect(200);
    assertNoCredentials(res.body);
    assert.strictEqual(res.body['x-custom'], 'keep');
  });

  it('only restores individually allowed headers, case-insensitively', async function() {
    var res = await request(relay({allowSensitiveHeaders: ['Authorization', 'COOKIE']}))
      .get('/' + target).set(credentials).expect(200);
    names.forEach(function(name) {
      assert.strictEqual(res.body[name], ['authorization', 'cookie'].includes(name) ? credentials[name] : undefined);
    });
  });

  it('applies defaults to mixed-case configured headers and generated Basic auth', async function() {
    var res = await request(relay({
      setHeaders: {Authorization: 'Bearer configured', COOKIE: 'configured=secret', 'X-Api-Key': 'configured'},
      httpProxyOptions: {auth: 'user:secret'},
    })).get('/' + target).expect(200);
    assertNoCredentials(res.body);
  });

  it('keeps configured credentials on same-origin redirects when explicitly allowed', async function() {
    var res = await request(relay({allowSensitiveHeaders: names, setHeaders: {Authorization: 'Bearer configured'}}))
      .get('/' + target + '/same').set(credentials).expect(200);
    assert.strictEqual(res.body.authorization, 'Bearer configured');
    names.filter(function(name) { return name !== 'authorization'; }).forEach(function(name) {
      assert.strictEqual(res.body[name], credentials[name]);
    });
  });

  [301, 302, 303].forEach(function(status) {
    it('strips all allowed credentials on a cross-port ' + status + ' redirect', async function() {
      var res = await request(relay({allowSensitiveHeaders: names}))
        .get('/' + target + '/cross').set(credentials).set('x-redirect-status', String(status)).expect(200);
      assert.strictEqual(seen[0].authorization, credentials.authorization);
      assertNoCredentials(res.body);
    });
  });

  ['/return', '/hostname', '/upgrade', '/downgrade'].forEach(function(path) {
    it('does not leak or restore credentials through ' + path, async function() {
      var initial = path === '/downgrade' ? secureTarget : target;
      var res = await request(relay({allowSensitiveHeaders: names, httpProxyOptions: {secure: false}}))
        .get('/' + initial + path).set(credentials).expect(200);
      assert.strictEqual(seen[0].cookie, credentials.cookie);
      assertNoCredentials(res.body);
    });
  });

  it('does not regenerate Basic auth after crossing origins or mutate another request', async function() {
    var server = relay({allowSensitiveHeaders: ['authorization'], httpProxyOptions: {auth: 'user:secret'}});
    var res = await request(server).get('/' + target + '/return').expect(200);
    assert.strictEqual(seen[0].authorization, 'Basic ' + Buffer.from('user:secret').toString('base64'));
    assertNoCredentials(res.body);
    res = await request(server).get('/' + target + '/same').expect(200);
    assert.strictEqual(res.body.authorization, seen[0].authorization);
  });

  it('strips nested ssl.auth by default', async function() {
    var res = await request(relay({httpProxyOptions: {ssl: {auth: 'user:secret'}}}))
      .get('/' + target).expect(200);
    assertNoCredentials(res.body);
  });

  it('isolates mutable SSL options and strips generated auth on cross-origin redirects', async function() {
    var ssl = {};
    var server = relay({allowSensitiveHeaders: ['authorization'], httpProxyOptions: {auth: 'user:secret', ssl: ssl}});
    var res = await request(server).get('/' + target + '/cross').expect(200);
    assert.ok(seen[0].authorization);
    assertNoCredentials(res.body);
    assert.deepStrictEqual(ssl, {});
    res = await request(server).get('/' + target + '/same').expect(200);
    assert.strictEqual(res.body.authorization, seen[0].authorization);
  });

  ['/bad-ipv6', '/bad-escape'].forEach(function(path) {
    it('contains malformed redirect errors: ' + path, async function() {
      var server = relay();
      await request(server).get('/' + target + path).expect(404);
      await request(server).get('/' + target).expect(200);
    });
  });

  it('rejects invalid opt-in configuration at startup', function() {
    [true, 'authorization', ['unknown'], [null]].forEach(function(value) {
      assert.throws(function() { relay({allowSensitiveHeaders: value}); }, /allowSensitiveHeaders/);
    });
  });

  ['http:', 'https:'].forEach(function(protocol) {
    it('preserves allowed credentials across equivalent default ports via a forward proxy: ' + protocol, async function() {
      var forward = await listen(http.createServer(function(req, res) {
        if (req.url.endsWith('/start')) {
          res.writeHead(302, {Location: protocol + '//EXAMPLE.COM:' + (protocol === 'https:' ? 443 : 80) + '/echo'});
          res.end();
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(req.headers));
        }
      }));
      var res = await request(relay({allowSensitiveHeaders: names, getProxyForUrl: function() { return forward; }}))
        .get('/' + protocol + '//example.com/start').set(credentials).expect(200);
      names.forEach(function(name) { assert.strictEqual(res.body[name], credentials[name]); });
      res = await request(relay({getProxyForUrl: function() { return forward; }}))
        .get('/' + protocol + '//example.com/start').set(credentials).expect(200);
      assertNoCredentials(res.body);
    });
  });

  [
    {initial: '0:0:0:0:0:0:0:1', next: '::1', same: true},
    {initial: '::ffff:127.0.0.1', next: '::ffff:7f00:1', same: true},
    {initial: '::1', next: '::2', same: false},
  ].forEach(function(hosts) {
    it('compares IPv6 redirect origins: ' + hosts.initial + ' -> ' + hosts.next, async function() {
      var forward = await listen(http.createServer(function(req, res) {
        if (req.url.endsWith('/start')) {
          res.writeHead(302, {Location: 'http://[' + hosts.next + ']/echo'});
          res.end();
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(req.headers));
        }
      }));
      var res = await request(relay({allowSensitiveHeaders: names, getProxyForUrl: function() { return forward; }}))
        .get('/http://[' + hosts.initial + ']/start').set(credentials).expect(200);
      names.forEach(function(name) {
        assert.strictEqual(res.body[name], hosts.same ? credentials[name] : undefined);
      });
    });
  });
});

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
    it('forwards a large POST through CORS Forward (Expect=' + expectContinue + ')', function(done) {
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
