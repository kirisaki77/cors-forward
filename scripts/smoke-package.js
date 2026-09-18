'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {createRequire} = require('node:module');

// Resolve only from the isolated installation, never the source checkout.
const installRoot = path.resolve(process.argv[2]);
const installedRequire = createRequire(path.join(installRoot, 'package.json'));
const packageRoot = path.dirname(installedRequire.resolve('cors-forward/package.json'));
assert.equal(packageRoot, path.join(installRoot, 'node_modules', 'cors-forward'));
assert.equal(installedRequire('cors-forward/package.json').version, process.argv[3]);
for (const file of ['LICENSE', 'README.md', 'README.ja.md', 'server.js', 'lib/help.txt']) {
  assert.ok(fs.existsSync(path.join(packageRoot, file)), 'Missing package file: ' + file);
}
for (const file of ['test', 'demo.html', 'Procfile', '.npmrc', '.env', '.serena', 'scripts', '.github']) {
  assert.ok(!fs.existsSync(path.join(packageRoot, file)), 'Unexpected package file: ' + file);
}
for (const key of Object.keys(process.env)) {
  if (/^(https?|all|no)_proxy$/i.test(key) || /^npm_config_(https?_proxy|proxy|noproxy)$/i.test(key)) {
    delete process.env[key];
  }
}

const timeout = setTimeout(() => { console.error('Package smoke test timed out'); process.exit(1); }, 15000);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
function request(port, target, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: target, method,
      headers: {origin: 'https://client.example', authorization: 'Bearer test-only', cookie: 'test=1'},
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function smoke() {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, {location: '/echo'});
      res.end();
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('set-cookie', 'upstream=1');
      res.end(JSON.stringify({
        method: req.method, body, authorization: req.headers.authorization, cookie: req.headers.cookie,
      }));
    });
  });
  const proxy = installedRequire('cors-forward').createServer({requireHeader: ['origin']});
  try {
    await listen(upstream);
    await listen(proxy);
    const port = proxy.address().port;
    const target = '/http://127.0.0.1:' + upstream.address().port;
    const help = await request(port, '/');
    assert.equal(help.status, 200);
    assert.ok(help.body.length > 0);
    for (const endpoint of ['/echo', '/redirect']) {
      const response = await request(port, target + endpoint);
      assert.equal(response.status, 200);
      assert.equal(response.headers['access-control-allow-origin'], '*');
      assert.equal(response.headers['set-cookie'], undefined);
      assert.deepEqual(JSON.parse(response.body), {method: 'GET', body: ''});
    }
    const post = await request(port, target + '/echo', 'POST', 'packed-body');
    assert.equal(post.status, 200);
    assert.deepEqual(JSON.parse(post.body), {method: 'POST', body: 'packed-body'});
    console.log('Packed installation passed: files, help, GET, POST, redirect, CORS and credential stripping');
  } finally {
    await Promise.all([close(proxy), close(upstream)]);
  }
}

smoke().then(() => clearTimeout(timeout), error => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});
