'use strict';

const assert = require('node:assert/strict');

// Dependency-free SemVer precedence: numeric components use BigInt; build metadata
// does not affect ordering. Keeping this self-contained avoids installing code in
// the job holding OIDC permissions.
function parseVersion(version) {
  assert.equal(typeof version, 'string', 'Version must be a string');
  assert.equal(version, version.trim(), 'Unexpected whitespace in version');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version);
  assert.ok(match, 'Invalid SemVer: ' + version);
  const prerelease = match[4] ? match[4].split('.') : [];
  for (const identifier of prerelease) {
    assert.ok(identifier.length > 0 && !/^0\d+$/.test(identifier), 'Invalid prerelease: ' + version);
  }
  if (match[5]) {
    assert.ok(match[5].split('.').every(identifier => identifier.length > 0), 'Invalid build metadata');
  }
  return {core: match.slice(1, 4).map(value => BigInt(value)), prerelease};
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) {
      return a.core[i] > b.core[i] ? 1 : -1;
    }
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : (a.prerelease.length ? -1 : 1);
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) {
      continue;
    }
    if (x === undefined || y === undefined) {
      return x === undefined ? -1 : 1;
    }
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      return BigInt(x) > BigInt(y) ? 1 : -1;
    }
    if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    }
    return x > y ? 1 : -1;
  }
  return 0;
}

function assertPublishable(version, distTag, metadata) {
  const candidate = parseVersion(version);
  assert.equal(distTag, candidate.prerelease.length ? 'next' : 'latest', 'Wrong release channel');
  assert.equal(metadata?.name, 'cors-forward', 'Unexpected registry package');
  const versions = metadata.versions;
  const tags = metadata['dist-tags'];
  assert.ok(versions && typeof versions === 'object' && !Array.isArray(versions), 'Missing registry versions');
  assert.ok(tags && typeof tags === 'object' && !Array.isArray(tags), 'Missing registry dist-tags');
  assert.ok(!Object.hasOwn(versions, version), 'Version is already published: ' + version);
  // The initial manual release already exists. Missing latest is an error, not a
  // reason to assume this is a new package. A missing next is allowed on its first use.
  assert.ok(Object.hasOwn(tags, 'latest'), 'Missing latest tag');
  for (const tag of new Set(['latest', distTag])) {
    if (tag === 'next' && !Object.hasOwn(tags, tag)) {
      continue;
    }
    const current = tags[tag];
    parseVersion(current);
    assert.ok(Object.hasOwn(versions, current), 'Tag points to a missing registry version: ' + tag);
    assert.ok(compareVersions(version, current) > 0, version + ' must be newer than ' + tag + '=' + current);
  }
}

async function checkRegistry(version, distTag, fetchRegistry = fetch) {
  const response = await fetchRegistry('https://registry.npmjs.org/cors-forward', {
    headers: {'accept': 'application/json', 'cache-control': 'no-cache'},
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, 'Registry lookup failed: HTTP ' + response.status);
  assertPublishable(version, distTag, await response.json());
}

module.exports = {compareVersions, assertPublishable, checkRegistry};

if (require.main === module) {
  checkRegistry(process.argv[2], process.argv[3]).then(() => {
    console.log('Registry version guard passed for ' + process.argv[2] + ' (' + process.argv[3] + ')');
  }, error => {
    console.error('Publication refused: ' + error.message);
    process.exitCode = 1;
  });
}
