'use strict';

const assert = require('node:assert/strict');
const {compareVersions, assertPublishable, checkRegistry} = require('../scripts/check-publish-version');

function registry(latest, next) {
  return {
    name: 'cors-forward',
    versions: Object.fromEntries([latest, next].filter(Boolean).map(version => [version, {}])),
    'dist-tags': next ? {latest, next} : {latest},
  };
}

describe('Publish version guard', function() {
  it('rejects an older release finishing after a newer release', function() {
    const metadata = registry('0.1.0');
    assertPublishable('0.1.2', 'latest', metadata);
    metadata.versions['0.1.2'] = {};
    metadata['dist-tags'].latest = '0.1.2';
    assert.throws(() => assertPublishable('0.1.1', 'latest', metadata), /must be newer/);
  });
  it('rejects same-version retries and already-published versions on another tag', function() {
    assert.throws(() => assertPublishable('0.1.0', 'latest', registry('0.1.0')), /already published/);
    assert.throws(() => assertPublishable('0.2.0-rc.1', 'next', registry('0.1.0', '0.2.0-rc.1')), /already published/);
  });
  it('orders numeric components and prereleases using SemVer precedence', function() {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta',
      '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.9', '1.0.10', '1.9.0', '1.10.0', '2.0.0'];
    for (let i = 1; i < ordered.length; i++) {
      assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
      assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    }
    assert.equal(compareVersions('1.0.0+build.2', '1.0.0+build.1'), 0);
    assert.equal(compareVersions('1.0.0-rc.9007199254740993', '1.0.0-rc.9007199254740992'), 1);
  });
  it('allows a first next release and later forward movement on next', function() {
    assertPublishable('0.2.0-rc.1', 'next', registry('0.1.0'));
    assertPublishable('0.2.0-rc.10', 'next', registry('0.1.0', '0.2.0-rc.9'));
    assert.throws(() => assertPublishable('0.2.0-rc.8', 'next', registry('0.1.0', '0.2.0-rc.9')), /must be newer/);
    assert.throws(() => assertPublishable('0.1.0-rc.1', 'next', registry('0.1.0')), /must be newer/);
  });
  it('allows stable releases independently of a newer next channel', function() {
    assertPublishable('0.1.1', 'latest', registry('0.1.0', '0.2.0-rc.1'));
  });
  it('rejects malformed or incomplete registry metadata', function() {
    for (const metadata of [null, {}, {name: 'other'}, {name: 'cors-forward'},
      {...registry('0.1.0'), 'dist-tags': {}}, {...registry('0.1.0'), versions: {}},
      registry('not-a-version'), registry('0.1.0', '0.2.0-rc.01')]) {
      assert.throws(() => assertPublishable('0.2.0-rc.2', 'next', metadata));
    }
    for (const invalid of ['01.0.0', '1.0', '1.0.0\n', '1.0.0-rc..1', '1.0.0+build..1']) {
      assert.throws(() => compareVersions(invalid, '0.1.0'));
    }
    assert.throws(() => assertPublishable('0.2.0-rc.1', 'latest', registry('0.1.0')), /Wrong release channel/);
  });
  it('fails closed on HTTP errors, network failures and invalid JSON', async function() {
    for (const status of [401, 404, 429, 500, 503]) {
      await assert.rejects(checkRegistry('0.1.1', 'latest', async () => ({ok: false, status})), /Registry lookup failed/);
    }
    await assert.rejects(checkRegistry('0.1.1', 'latest', async () => { throw new Error('network timeout'); }), /timeout/);
    await assert.rejects(checkRegistry('0.1.1', 'latest', async () => ({
      ok: true, json: async () => { throw new Error('invalid JSON'); },
    })), /invalid JSON/);
  });
  it('reads fresh public registry metadata without following redirects', async function() {
    await checkRegistry('0.1.1', 'latest', async (url, options) => {
      assert.equal(url, 'https://registry.npmjs.org/cors-forward');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['cache-control'], 'no-cache');
      assert.ok(options.signal instanceof AbortSignal);
      return {ok: true, json: async () => registry('0.1.0')};
    });
  });
});
