'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

function releaseMetadata(pkg, lock, context) {
  assert.equal(context.repository, 'kirisaki77/cors-forward', 'Unexpected release repository');
  assert.equal(pkg.name, 'cors-forward');
  assert.notEqual(pkg.private, true);
  assert.equal(pkg.version, pkg.version.trim());
  assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  if (context.event === 'push') {
    assert.equal(context.ref, 'refs/tags/v' + pkg.version, 'Tag must match the package version');
  } else {
    assert.equal(context.event, 'workflow_dispatch', 'Unsupported release event');
    assert.equal(context.ref, 'refs/heads/master', 'Dry runs must use master');
  }
  return {version: pkg.version, distTag: pkg.version.includes('-') ? 'next' : 'latest'};
}

module.exports = releaseMetadata;

if (require.main === module) {
  const result = releaseMetadata(require('../package.json'), require('../package-lock.json'), {
    repository: process.env.GITHUB_REPOSITORY,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
  });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'version=' + result.version + '\ndist-tag=' + result.distTag + '\n');
}
