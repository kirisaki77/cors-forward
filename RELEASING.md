# Releasing cors-forward

Changes go through a pull request into `master`, with all five required CI jobs passing.
While the API is at 0.x, use patch releases for compatible fixes and minor releases for
features or breaking changes. Describe breaking changes explicitly in the release notes.

## Initial setup

1. Publish the first version interactively with npm 2FA. npm requires the package to
   exist before its trusted publisher can be configured.
2. Configure the GitHub environment `npm` to allow only tags matching `v*`.
3. Configure npm Trusted Publishing for `kirisaki77/cors-forward`, workflow
   `publish.yml`, environment `npm`, with permission to publish directly:

   ```sh
   npm trust github cors-forward --repository kirisaki77/cors-forward --file publish.yml --environment npm --allow-publish
   ```

   Complete the browser's 2FA verification. Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN`
   to the workflow. Protect `v*` tags from updates and deletion, and restrict tag creation
   to maintainers. The repository's `master` PR/CI protections must remain enabled.

## Subsequent releases

1. In a release PR, update the version in `package.json` and `package-lock.json`
   using `npm version <version> --no-git-tag-version`. Include release notes.
2. Merge after CI passes, then update your local `master`.
3. Create an annotated tag for that merged commit and push that tag, for example:

   ```sh
   git tag -a v0.1.1 -m "Release 0.1.1"
   git push origin v0.1.1
   ```

4. The publish workflow verifies the tag/version/lockfile and master ancestry, runs
   the complete CI matrix, packs and smoke-tests the installation, and publishes that
   exact archive through OIDC. Stable versions use `latest`; `-alpha.N`, `-beta.N` and
   `-rc.N` versions use `next`. GitHub/npm generate provenance automatically.
5. Check the workflow result and the npm package version before announcing the release.

Only the publish job has `id-token: write`. That job does not check out source, install
package dependencies, run lifecycle scripts, or restore caches. Actions are pinned to
commit hashes; Dependabot proposes updates through PRs. The publishing job downloads
the same-run archive and verifies its checksum before publishing.

Run **Publish npm package** manually on `master` to test validation, CI, packaging and
the isolated installation without publishing or requesting an OIDC credential.

Never move or reuse a released tag/version. A failed run before publication can be
retried with the same tag. If publication already succeeded, release a new version
for fixes instead of overwriting it. Investigate a failed audit or test before release.

The initial interactive release has no CI-generated provenance. Subsequent releases
must use the tag workflow. A dry run does not prove the npm OIDC exchange works; the
first successful tag release provides that verification.
