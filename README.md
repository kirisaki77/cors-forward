[![CI](https://github.com/kirisaki77/cors-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/kirisaki77/cors-relay/actions/workflows/ci.yml)

**CORS Relay** is a NodeJS proxy which adds CORS headers to the proxied request.

[日本語版 README](README.ja.md)

This fork was created to address security vulnerabilities in the libraries that
CORS Anywhere depends on. It is maintained at
[kirisaki77/cors-relay](https://github.com/kirisaki77/cors-relay), based on
[Rob--W/cors-anywhere](https://github.com/Rob--W/cors-anywhere). Report issues in
[this fork](https://github.com/kirisaki77/cors-relay/issues).

The url to proxy is literally taken from the path, validated and proxied. The protocol
part of the proxied URI is optional, and defaults to "http". If port 443 is specified,
the protocol defaults to "https".

This package does not put any restrictions on the http methods or headers, except for
cookies. Requesting [user credentials](http://www.w3.org/TR/cors/#user-credentials) is disallowed.
The app can be configured to require a header for proxying a request, for example to avoid
a direct visit from the browser.

## Development and dependency security

This fork requires Node.js 22.13+ (22.x) or 24+. Use a supported Node.js LTS
release and install the locked dependency tree with `npm ci` (or
`npm ci --omit=dev` for production).

```sh
npm ci
npm run lint
npm test
npm run test-coverage
npm audit
```

The proxy dependency is pinned to [`httpxy` 0.5.5](https://github.com/unjs/httpxy).
The package name is now `cors-relay`; use `require('cors-relay').createServer(options)`.
The `createServer(options)` API is retained;
the supported Node.js versions can load httpxy's ES module synchronously.
The existing `httpProxyOptions` option now configures httpxy. With the default
`xfwd: true`, it also forwards `X-Forwarded-Host`. Connections are not pooled by
default; a custom `httpProxyOptions.agent` can opt into connection reuse.

CORS Relay controls destination selection and redirect following: 301/302/303
become GET requests up to `maxRedirects`, while 307/308 are returned with rewritten
locations. Intermediate responses are drained before following the next hop.
`Expect: 100-continue` is answered by the local HTTP server and is not forwarded
upstream. Environment-selected forward proxies still receive absolute-form URLs.
Development tooling uses ESLint flat configuration and c8 coverage; the old
Istanbul and Coveralls CLI dependencies have been removed. Coverage reports
remain available in `coverage/lcov.info`.

HTTP fixtures use Node.js built-in HTTP/HTTPS servers on loopback interfaces,
without Nock. A test-only agent routes example hosts locally while preserving
request headers, and trusts the fixture certificate only for these hosts.

The plan is to migrate these HTTP response fixtures back to Nock once a stable
release supports clients that wait for TCP/TLS connection events before sending
requests, and compatibility has been verified in this repository. During testing
on September 17–18, 2026, Nock 14.0.17 and MSW 2.15.0 timed out with httpxy;
this is a limitation of the tested mocking implementations, not evidence of a
failure when connecting to real upstream servers.
[Nock 15.0.0-beta.13](https://github.com/nock/nock/releases/tag/v15.0.0-beta.13)
already incorporates TCP/TLS wrap-based interception, but has not been tested
in this repository. Before migrating, run the full suite on supported Node.js
versions, including HTTP/HTTPS forwarding, request bodies, redirects, connection
errors and TLS certificate validation. Keep real-server integration tests for
transport behavior and certificate validation even after adopting Nock.

Commit `package-lock.json` when updating dependencies, and rerun the checks
above. A clean dependency audit means no known advisories were reported for
that dependency tree at that time; it is not a guarantee that the application
or deployment has no vulnerabilities.

The certificate and private key under `test/` are public, self-signed test
fixtures only. Never use them for a deployed server.

GitHub Actions runs lint, tests, coverage, dependency audit and package checks on
Linux and Windows with Node.js 22 and 24, plus Node.js 22.13.0 on Linux.
Coverage is available as an artifact of each successful CI job.

To run this fork from source:

```sh
git clone https://github.com/kirisaki77/cors-relay.git
cd cors-relay
npm ci
node server.js
```

The npm name `cors-anywhere` identifies the upstream package; installing it from
the registry does not select this fork. This repository's package name is
`cors-relay`. Renaming it does not publish it to npm or establish ownership of
that registry name. Use the source checkout above until a release is published.
The examples below assume this package is installed as `cors-relay`.

## Deployment security

This proxy accepts caller-selected destinations and follows redirects. It does
not block private, loopback, link-local or cloud metadata addresses. Run it in
an isolated network and enforce outbound destination restrictions with a
firewall or an enforcing egress proxy, covering IPv4, IPv6, DNS resolution and
redirect destinations. A check of only the first URL is insufficient.

Restrict incoming access using authentication at a reverse proxy or a trusted
network boundary. `originWhitelist`, `requireHeader` and Origin-based rate limits
are browser usage controls: non-browser clients can supply arbitrary Origin
headers. These settings alone do not authenticate users or prevent open-proxy abuse.
Use HTTPS for clients and configure request size, timeout and rate limits at the
ingress. Review forwarded headers and avoid attaching credentials to arbitrary
destinations. Treat configured intermediate proxies as part of the trust boundary.

## Example

```javascript
// Listen on a specific host via the HOST environment variable
var host = process.env.HOST || '0.0.0.0';
// Listen on a specific port via the PORT environment variable
var port = process.env.PORT || 8080;

var cors_proxy = require('cors-relay');
cors_proxy.createServer({
    originWhitelist: [], // Allow all origins
    requireHeader: ['origin', 'x-requested-with'],
    removeHeaders: ['cookie', 'cookie2']
}).listen(port, host, function() {
    console.log('Running CORS Relay on ' + host + ':' + port);
});

```
Request examples:

* `http://localhost:8080/http://google.com/` - Google.com with CORS headers
* `http://localhost:8080/google.com` - Same as previous.
* `http://localhost:8080/google.com:443` - Proxies `https://google.com/`
* `http://localhost:8080/` - Shows usage text, as defined in `lib/help.txt`
* `http://localhost:8080/favicon.ico` - Replies 404 Not found

Upstream demos (not operated by this fork):

* https://cors-anywhere.herokuapp.com/
* https://robwu.nl/cors-anywhere.html - This demo shows how to use the API.

## Documentation

### Client

To use the API, just prefix the URL with the API URL. Take a look at [demo.html](demo.html) for an example.
A concise summary of the documentation is provided at [lib/help.txt](lib/help.txt).

**Note: as of February 2021, access to the demo server requires an opt-in**,
see: https://github.com/Rob--W/cors-anywhere/issues/301

If you want to automatically enable cross-domain requests when needed, use the following snippet:

```javascript
(function() {
    var cors_api_host = 'cors-anywhere.herokuapp.com';
    var cors_api_url = 'https://' + cors_api_host + '/';
    var slice = [].slice;
    var origin = window.location.protocol + '//' + window.location.host;
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {
        var args = slice.call(arguments);
        var targetOrigin = /^https?:\/\/([^\/]+)/i.exec(args[1]);
        if (targetOrigin && targetOrigin[0].toLowerCase() !== origin &&
            targetOrigin[1] !== cors_api_host) {
            args[1] = cors_api_url + args[1];
        }
        return open.apply(this, args);
    };
})();
```

If you're using jQuery, you can also use the following code **instead of** the previous one:

```javascript
jQuery.ajaxPrefilter(function(options) {
    if (options.crossDomain && jQuery.support.cors) {
        options.url = 'https://cors-anywhere.herokuapp.com/' + options.url;
    }
});
```

### Server

The module exports `createServer(options)`, which creates a server that handles
proxy requests. The following options are supported:

* function `getProxyForUrl` - If set, specifies which intermediate proxy to use for a given URL.
  If the return value is void, a direct request is sent. The default implementation is
  [`proxy-from-env`](https://github.com/Rob--W/proxy-from-env), which respects the standard proxy
  environment variables (e.g. `https_proxy`, `no_proxy`, etc.).  
* array of strings `originBlacklist` - If set, requests whose origin is listed are blocked.  
  Example: `['https://bad.example.com', 'http://bad.example.com']`
* array of strings `originWhitelist` - If set, requests whose origin is not listed are blocked.  
  If this list is empty, all origins are allowed.
  Example: `['https://good.example.com', 'http://good.example.com']`
* function `handleInitialRequest` - If set, it is called with the request, response and a parsed
  URL of the requested destination (null if unavailable). If the function returns true, the request
  will not be handled further. Then the function is responsible for handling the request.
  This feature can be used to passively monitor requests, for example for logging (return false).
* function `checkRateLimit` - If set, it is called with the origin (string) of the request. If this
  function returns a non-empty string, the request is rejected and the string is send to the client.
* boolean `redirectSameOrigin` - If true, requests to URLs from the same origin will not be proxied but redirected.
  The primary purpose for this option is to save server resources by delegating the request to the client
  (since same-origin requests should always succeed, even without proxying).
* array of strings `requireHeader` - If set, the request must include this header or the API will refuse to proxy.  
  Recommended if you want to prevent users from using the proxy for normal browsing.  
  Example: `['Origin', 'X-Requested-With']`.
* array of lowercase strings `removeHeaders` - Exclude certain headers from being included in the request.  
  Example: `["cookie"]`
* dictionary of lowercase strings `setHeaders` - Set headers for the request (overwrites existing ones).  
  Example: `{"x-powered-by": "CORS Relay"}`
* number `corsMaxAge` - If set, an Access-Control-Max-Age request header with this value (in seconds) will be added.  
  Example: `600` - Allow CORS preflight request to be cached by the browser for 10 minutes.
* string `helpFile` - Set the help file (shown at the homepage).  
  Example: `"myCustomHelpText.txt"`

For advanced users, the following options are also provided.

* `httpProxyOptions` - Under the hood, [httpxy](https://github.com/unjs/httpxy)
  is used to proxy requests. Use this option if you really need to pass options
  to httpxy. See its [options](https://github.com/unjs/httpxy#options).
  CORS Relay manages `target`, `changeOrigin`, `prependPath`, `headers` and
  `followRedirects` itself; use `maxRedirects` to control redirect following.
* `httpsOptions` - If set, a `https.Server` will be created. The given options are passed to the
  [`https.createServer`](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener) method.

For even more advanced usage (building upon CORS Relay),
see the sample code in [test/test-examples.js](test/test-examples.js).

### Demo server

The upstream project provides a public demo of CORS Anywhere at https://cors-anywhere.herokuapp.com. This server is
only provided so that you can easily and quickly try out CORS Anywhere. To ensure that the service
stays available to everyone, the number of requests per period is limited, except for requests from
some explicitly whitelisted origins.

**Note: as of February 2021, access to the demo server requires an opt-in**,
see: https://github.com/Rob--W/cors-anywhere/issues/301

If you expect lots of traffic, please host your own instance of CORS Relay, and make sure that
the CORS Relay server only whitelists your site to prevent others from using your instance of
CORS Relay unintentionally. Also apply the access controls described in Deployment security.

For instance, to run a CORS Relay server that accepts any request from some example.com sites on
port 8080, use:
```
export PORT=8080
export CORSANYWHERE_WHITELIST=https://example.com,http://example.com,http://example.com:8080
node server.js
```

For Heroku deployment instructions, see https://devcenter.heroku.com/articles/nodejs.
Check your hosting provider's current proxy usage policy and apply the deployment
security controls above before exposing the service.

For example, to blacklist abuse.example.com and rate-limit everything to 50 requests per 3 minutes,
except for my.example.com and my2.example.com (which may be unlimited), use:

```
export PORT=8080
export CORSANYWHERE_BLACKLIST=https://abuse.example.com,http://abuse.example.com
export CORSANYWHERE_RATELIMIT='50 3 my.example.com my2.example.com'
node server.js
```


## License

Copyright (C) 2013 - 2021 Rob Wu <rob@robwu.nl>
Copyright (C) 2026 kirisaki77 (modifications)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
