[![CI](https://github.com/kirisaki77/cors-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/kirisaki77/cors-relay/actions/workflows/ci.yml)

**CORS Relay** は、プロキシ経由のリクエストに CORS ヘッダーを追加する NodeJS プロキシです。

[English README](README.md)

このフォークは、CORS Anywhere が依存するライブラリの脆弱性に対処することを目的として作成しました。
元プロジェクトは [Rob--W/cors-anywhere](https://github.com/Rob--W/cors-anywhere) です。
このforkへの問い合わせは [Issues](https://github.com/kirisaki77/cors-relay/issues) を使用してください。

プロキシ先の URL はリクエストのパスから取得し、検証したうえでプロキシ処理を行います。
プロキシ先 URI のプロトコルは省略可能で、既定値は `http` です。ポートに 443 を指定した場合は、
プロトコルの既定値が `https` になります。

このパッケージは、Cookie を除き、HTTP メソッドやヘッダーを制限しません。
[ユーザー認証情報](http://www.w3.org/TR/cors/#user-credentials)を使用するリクエストは許可されません。
ブラウザーからの直接アクセスを防ぐなどの目的で、プロキシ処理に特定のヘッダーを必須とする設定も可能です。

## 開発環境と依存関係

Node.js 22.13以上の22系、または24以上が必要です。サポート中のLTS版を使用してください。
このforkの取得・起動方法は次のとおりです。

```sh
git clone https://github.com/kirisaki77/cors-relay.git
cd cors-relay
npm ci
node server.js
```

本番用の依存だけを取得する場合は `npm ci --omit=dev` を使います。
npmの `cors-anywhere` は元プロジェクトのパッケージ名です。レジストリからその名前で
インストールしても、このforkにはなりません。本リポジトリのパッケージ名は `cors-relay` です。
改名によってnpmへの公開や同名パッケージの所有権取得が行われるわけではありません。
公開するまでは上記のソースから起動してください。以下の使用例は、本パッケージを
`cors-relay` としてインストールした環境を想定しています。

```sh
npm run lint
npm test
npm run test-coverage
npm audit
```

プロキシ実装は [httpxy 0.5.5](https://github.com/unjs/httpxy) です。
パッケージ名の変更に伴い、CommonJSでは `require('cors-relay').createServer(options)` を使用します。
`createServer(options)` のAPIは維持しています。
対応Node.jsはhttpxyのESモジュールを同期ロードできます。
`httpProxyOptions` はhttpxyの設定に渡されます。既定の `xfwd: true` では
`X-Forwarded-Host` も転送します。接続は既定では再利用せず、必要なら
`httpProxyOptions.agent` を指定します。

301／302／303は中間レスポンスを読み捨てた後、`maxRedirects` の上限までGETで追従します。
307／308はLocationを書き換えてクライアントへ返します。
`Expect: 100-continue` は入口のHTTPサーバーで応答し、転送先へは送信しません。
環境変数で指定した中継プロキシには絶対URL形式で転送します。

ESLintのflat configとc8を使用しています。旧Istanbul／Coveralls CLIは削除しました。
カバレッジは `coverage/lcov.info` に出力します。GitHub ActionsではLinux／Windowsの
Node.js 22・24と、Linuxの22.13.0でlint・テスト・カバレッジ・依存監査・配布対象を確認します。
成功したCIジョブのartifactからカバレッジを取得できます。

HTTPのテストにはNockを使わず、Node.js標準のHTTP／HTTPSサーバーをループバック上で起動します。
テスト専用Agentがリクエストヘッダーを維持したままサンプルホストへの接続をローカルへ転送し、
そのホストに限ってテスト用証明書を信頼します。

今後、TCP／TLSの接続完了イベントを待ってから送信するクライアントに対応したNockの安定版が公開され、
本リポジトリで互換性を確認できたら、HTTP応答のテスト用定義をNockへ移行する方針です。
2026年9月17～18日の検証では、Nock 14.0.17とMSW 2.15.0はhttpxyとの組み合わせでタイムアウトしました。
これは検証したモック実装の制約であり、実際の転送先サーバーへの接続が失敗することを示すものではありません。
[Nock 15.0.0-beta.13](https://github.com/nock/nock/releases/tag/v15.0.0-beta.13)には
TCP／TLS層での通信捕捉への変更が既に入っていますが、本リポジトリでは未検証です。
移行前には対応Node.js上で全テストを実行し、HTTP／HTTPS転送、リクエスト本文、リダイレクト、
接続エラー、TLS証明書検証を確認します。Nock導入後も、実際の通信と証明書検証を確認する
ローカルサーバーによる結合テストは維持します。

依存更新時は `package-lock.json` をコミットして上記検証を再実行してください。
監査0件は、その時点の既知の依存脆弱性が検出されなかったという意味で、アプリ全体の安全性を保証しません。
`test/cert.pem` と `test/key.pem` は公開テスト用の自己署名証明書・鍵です。本番では使用しないでください。

## 公開運用時の設定

このプロキシは利用者が指定した宛先へ接続し、リダイレクトにも追従します。
プライベートIP・ループバック・リンクローカル・クラウドのメタデータ宛先を自動では遮断しません。
隔離したネットワークで動かし、ファイアウォールや宛先制限を行う中継プロキシで外向き通信を制限してください。
IPv4／IPv6、DNS解決後の宛先、リダイレクト先も対象にします。最初のURLだけの検査では不十分です。

入口にはリバースプロキシでの認証や、信頼できるネットワークからのアクセス制限を設けてください。
`originWhitelist`・`requireHeader`・Origin単位のレート制限だけでは利用者を認証できません。
ブラウザー以外のクライアントはOriginなどのヘッダーを任意に指定できます。
クライアントとの通信にはHTTPSを使い、入口でリクエストサイズ・タイムアウト・レート制限を設定してください。
任意の転送先へ認証情報を付与しないよう転送ヘッダーも確認し、中継プロキシの管理者も信頼範囲に含めてください。

## 使用例

```javascript
// HOST 環境変数で待ち受けるホストを指定します。
var host = process.env.HOST || '0.0.0.0';
// PORT 環境変数で待ち受けるポートを指定します。
var port = process.env.PORT || 8080;

var cors_proxy = require('cors-relay');
cors_proxy.createServer({
    originWhitelist: [], // すべてのオリジンを許可します。
    requireHeader: ['origin', 'x-requested-with'],
    removeHeaders: ['cookie', 'cookie2']
}).listen(port, host, function() {
    console.log('Running CORS Relay on ' + host + ':' + port);
});
```

リクエスト例:

* `http://localhost:8080/http://google.com/` - CORS ヘッダーを付けて Google.com にアクセスします。
* `http://localhost:8080/google.com` - 上記と同じです。
* `http://localhost:8080/google.com:443` - `https://google.com/` をプロキシします。
* `http://localhost:8080/` - `lib/help.txt` に定義された使い方を表示します。
* `http://localhost:8080/favicon.ico` - 404 Not found を返します。

元プロジェクトの公開デモ（このforkの運営ではありません）:

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
  例: `{"x-powered-by": "CORS Relay"}`
* `corsMaxAge`（数値）- 指定した値を秒数として `Access-Control-Max-Age` ヘッダーを追加します。
  例: `600` - ブラウザーが CORS プリフライトリクエストを 10 分間キャッシュできるようにします。
* `helpFile`（文字列）- トップページに表示するヘルプファイルを指定します。
  例: `"myCustomHelpText.txt"`

高度な用途向けに、次のオプションも用意されています。

* `httpProxyOptions` - 内部では [httpxy](https://github.com/unjs/httpxy) を使用してプロキシ処理を行います。
  httpxy にオプションを渡す必要がある場合に使用してください。
  オプションの詳細は[こちら](https://github.com/unjs/httpxy#options)を参照してください。
  `target`・`changeOrigin`・`prependPath`・`headers`・`followRedirects` はCORS Relayが管理します。
  リダイレクト回数は `maxRedirects` で設定してください。
* `httpsOptions` - 指定すると `https.Server` を作成します。指定したオプションは
  [`https.createServer`](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener) に渡されます。

CORS Relay を拡張する、さらに高度な使用例については、
[test/test-examples.js](test/test-examples.js) を参照してください。

### デモサーバー

元プロジェクトの公開デモは https://cors-anywhere.herokuapp.com で提供されています。
このサーバーは、CORS Anywhere を手軽に試すために用意されています。
すべての利用者が使える状態を維持するため、一部の明示的に許可されたオリジンを除き、
一定時間内のリクエスト数が制限されています。

**注意: 2021 年 2 月以降、デモサーバーへのアクセスにはオプトインが必要です。**
詳細: https://github.com/Rob--W/cors-anywhere/issues/301

大量のトラフィックが見込まれる場合は、CORS Relay を自身でホストしてください。
その際は、自分のサイトを許可リストに登録し、「公開運用時の設定」に従って認証と通信先制限も設定してください。

たとえば、example.com のサイトからのリクエストを受け付けるサーバーをポート 8080 で起動するには、次のようにします。

```sh
export PORT=8080
export CORSANYWHERE_WHITELIST=https://example.com,http://example.com,http://example.com:8080
node server.js
```

Heroku へのデプロイ手順は https://devcenter.heroku.com/articles/nodejs を参照してください。
サービスを外部公開する前に、ホスティング事業者の現在のプロキシ利用規定を確認し、
「公開運用時の設定」に記載した対策を適用してください。

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
