'use strict';

const assert = require('node:assert/strict');
const releaseMetadata = require('../scripts/release-metadata');

function check(version, context = {}, modifyLock = () => {}) {
  const pkg = {name: 'cors-forward', version};
  const lock = {...pkg, packages: {'': {...pkg}}};
  modifyLock(lock);
  return releaseMetadata(pkg, lock, {
    repository: 'kirisaki77/cors-forward', event: 'push', ref: 'refs/tags/v' + version, ...context,
  });
}

describe('Release authorization guards', function() {
  it('separates stable and prerelease distribution tags', function() {
    assert.equal(check('0.1.0').distTag, 'latest');
    assert.equal(check('0.2.0-rc.1').distTag, 'next');
  });
  it('rejects mismatched tags, branches, pull requests and forks', function() {
    for (const context of [
      {ref: 'refs/tags/v0.1.1'},
      {ref: 'refs/heads/master'},
      {event: 'pull_request'},
      {repository: 'someone/cors-forward'},
    ]) {
      assert.throws(() => check('0.1.0', context));
    }
  });
  it('only allows manual dry runs on master', function() {
    assert.equal(check('0.1.0', {event: 'workflow_dispatch', ref: 'refs/heads/master'}).version, '0.1.0');
    assert.throws(() => check('0.1.0', {event: 'workflow_dispatch', ref: 'refs/tags/v0.1.0'}));
    assert.throws(() => check('0.1.0', {event: 'workflow_dispatch', ref: 'refs/heads/feature'}));
  });
  it('rejects unsafe and unsupported version strings', function() {
    for (const version of ['01.0.0', '0.1.0\n', '0.1.0+build', '0.1.0-rc.01', '../0.1.0', '0.1.0;echo unsafe']) {
      assert.throws(() => check(version));
    }
  });
  it('requires matching lockfile metadata at both levels', function() {
    assert.throws(() => check('0.1.0', {}, lock => { lock.version = '0.2.0'; }));
    assert.throws(() => check('0.1.0', {}, lock => { lock.packages[''].version = '0.2.0'; }));
  });
});
