[![Build Status](https://travis-ci.com/Rob--W/cors-anywhere.svg?branch=master)](https://travis-ci.com/Rob--W/cors-anywhere)
[![Coverage Status](https://coveralls.io/repos/github/Rob--W/cors-anywhere/badge.svg?branch=master)](https://coveralls.io/github/Rob--W/cors-anywhere?branch=master)

**CORS Anywhere** は、プロキシ経由のリクエストに CORS ヘッダーを追加する NodeJS プロキシです。

[English README](README.md)

このフォークは、CORS Anywhere が依存するライブラリの脆弱性に対処することを目的として作成しました。

プロキシ先の URL はリクエストのパスから取得し、検証したうえでプロキシ処理を行います。
プロキシ先 URI のプロトコルは省略可能で、既定値は `http` です。ポートに 443 を指定した場合は、
プロトコルの既定値が `https` になります。

このパッケージは、Cookie を除き、HTTP メソッドやヘッダーを制限しません。
[ユーザー認証情報](http://www.w3.org/TR/cors/#user-credentials)を使用するリクエストは許可されません。
ブラウザーからの直接アクセスを防ぐなどの目的で、プロキシ処理に特定のヘッダーを必須とする設定も可能です。

## 使用例

```javascript
// HOST 環境変数で待ち受けるホストを指定します。
var host = process.env.HOST || '0.0.0.0';
// PORT 環境変数で待ち受けるポートを指定します。
var port = process.env.PORT || 8080;

var cors_proxy = require('cors-anywhere');
cors_proxy.createServer({
    originWhitelist: [], // すべてのオリジンを許可します。
    requireHeader: ['origin', 'x-requested-with'],
    removeHeaders: ['cookie', 'cookie2']
}).listen(port, host, function() {
    console.log('Running CORS Anywhere on ' + host + ':' + port);
});
```

リクエスト例:

* `http://localhost:8080/http://google.com/` - CORS ヘッダーを付けて Google.com にアクセスします。
* `http://localhost:8080/google.com` - 上記と同じです。
* `http://localhost:8080/google.com:443` - `https://google.com/` をプロキシします。
* `http://localhost:8080/` - `lib/help.txt` に定義された使い方を表示します。
* `http://localhost:8080/favicon.ico` - 404 Not found を返します。

公開されている使用例:

* https://cors-anywhere.herokuapp.com/
* https://robwu.nl/cors-anywhere.html - API の使用方法を示すデモです。

## ドキュメント

### クライアント

API を使用するには、アクセス先 URL の先頭に API の URL を付けます。
使用例は [demo.html](demo.html) を参照してください。
簡単な使い方は [lib/help.txt](lib/help.txt) にも記載されています。

**注意: 2021 年 2 月以降、デモサーバーへのアクセスにはオプトインが必要です。**
詳細: https://github.com/Rob--W/cors-anywhere/issues/301

必要な場合にクロスドメインリクエストを自動的に有効にするには、次のコードを使用します。

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

jQuery を使用している場合は、上記のコードの**代わりに**次のコードを使用できます。

```javascript
jQuery.ajaxPrefilter(function(options) {
    if (options.crossDomain && jQuery.support.cors) {
        options.url = 'https://cors-anywhere.herokuapp.com/' + options.url;
    }
});
```

### サーバー

このモジュールは、プロキシリクエストを処理するサーバーを作成する `createServer(options)` を公開しています。
次のオプションに対応しています。

* `getProxyForUrl`（関数）- 指定した URL に対して使用する中継プロキシを決定します。
  戻り値がない場合は直接接続します。既定の実装は
  [`proxy-from-env`](https://github.com/Rob--W/proxy-from-env) で、
  `https_proxy` や `no_proxy` などの標準的なプロキシ環境変数を参照します。
* `originBlacklist`（文字列の配列）- 指定したオリジンからのリクエストを拒否します。
  例: `['https://bad.example.com', 'http://bad.example.com']`
* `originWhitelist`（文字列の配列）- 指定したオリジン以外からのリクエストを拒否します。
  配列が空の場合は、すべてのオリジンを許可します。
  例: `['https://good.example.com', 'http://good.example.com']`
* `handleInitialRequest`（関数）- リクエスト、レスポンス、解析済みの宛先 URL（取得できない場合は `null`）を引数として呼び出されます。
  `true` を返すと、それ以降のリクエスト処理は行われません。その場合、この関数がレスポンスを処理する必要があります。
  ログの記録など、リクエストを監視する用途にも使用できます（その場合は `false` を返します）。
* `checkRateLimit`（関数）- リクエストのオリジンを文字列の引数として呼び出されます。
  空でない文字列を返すと、リクエストを拒否し、その文字列をクライアントに送信します。
* `redirectSameOrigin`（真偽値）- `true` の場合、同一オリジンの URL へのリクエストをリダイレクトします。
  同一オリジンへのリクエストは通常そのまま実行できるため、クライアントに処理を委ねてサーバーのリソースを節約するための設定です。
* `requireHeader`（文字列の配列）- 指定したヘッダーがリクエストに含まれていない場合、プロキシ処理を拒否します。
  通常のブラウジングにプロキシを使用されることを防ぎたい場合に推奨されます。
  例: `['Origin', 'X-Requested-With']`
* `removeHeaders`（小文字の文字列の配列）- リクエストから指定したヘッダーを除去します。
  例: `["cookie"]`
* `setHeaders`（小文字のキーを持つ辞書）- リクエストにヘッダーを設定します。既存の値は上書きされます。
  例: `{"x-powered-by": "CORS Anywhere"}`
* `corsMaxAge`（数値）- 指定した値を秒数として `Access-Control-Max-Age` ヘッダーを追加します。
  例: `600` - ブラウザーが CORS プリフライトリクエストを 10 分間キャッシュできるようにします。
* `helpFile`（文字列）- トップページに表示するヘルプファイルを指定します。
  例: `"myCustomHelpText.txt"`

高度な用途向けに、次のオプションも用意されています。

* `httpProxyOptions` - 内部では [http-proxy](https://github.com/nodejitsu/node-http-proxy) を使用してプロキシ処理を行います。
  http-proxy にオプションを渡す必要がある場合に使用してください。
  オプションの詳細は[こちら](https://github.com/nodejitsu/node-http-proxy#options)を参照してください。
* `httpsOptions` - 指定すると `https.Server` を作成します。指定したオプションは
  [`https.createServer`](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener) に渡されます。

CORS Anywhere を拡張する、さらに高度な使用例については、
[test/test-examples.js](test/test-examples.js) を参照してください。

### デモサーバー

CORS Anywhere の公開デモは https://cors-anywhere.herokuapp.com で提供されています。
このサーバーは、CORS Anywhere を手軽に試すために用意されています。
すべての利用者が使える状態を維持するため、一部の明示的に許可されたオリジンを除き、
一定時間内のリクエスト数が制限されています。

**注意: 2021 年 2 月以降、デモサーバーへのアクセスにはオプトインが必要です。**
詳細: https://github.com/Rob--W/cors-anywhere/issues/301

大量のトラフィックが見込まれる場合は、CORS Anywhere を自身でホストしてください。
その際は、自分のサイトのみを許可リストに登録し、第三者がオープンプロキシとして利用できないようにしてください。

たとえば、example.com のサイトからのリクエストを受け付けるサーバーをポート 8080 で起動するには、次のようにします。

```sh
export PORT=8080
export CORSANYWHERE_WHITELIST=https://example.com,http://example.com,http://example.com:8080
node server.js
```

このアプリケーションは Heroku でも実行できます。手順は https://devcenter.heroku.com/articles/nodejs を参照してください。
Heroku の[利用規定](https://www.heroku.com/policy/aup)ではオープンプロキシの運用が禁止されているため、
上記のように許可リストを適用するか、リクエスト数を厳しく制限してください。

たとえば、abuse.example.com を拒否し、my.example.com と my2.example.com を除くすべてのオリジンについて、
リクエスト数を 3 分間に 50 回までに制限するには、次のようにします。
除外した 2 つのオリジンは無制限にアクセスできます。

```sh
export PORT=8080
export CORSANYWHERE_BLACKLIST=https://abuse.example.com,http://abuse.example.com
export CORSANYWHERE_RATELIMIT='50 3 my.example.com my2.example.com'
node server.js
```

## ライセンス

ライセンス条文は原文のまま掲載します。

Copyright (C) 2013 - 2021 Rob Wu <rob@robwu.nl>

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
