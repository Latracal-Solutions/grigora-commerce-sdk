# Commerce SDK CDN delivery

The browser SDK is served directly from **https://cdn.grigora.app/commerce/v1/sdk.js** (or `sdk.min.js`). Store data and checkout requests still use `data-api-base`; only JavaScript delivery moves off the API.

## Configure once

In the SDK repository, create a GitHub environment named `commerce-sdk-cdn`. Add these environment secrets (do not put credentials in source files or chat):

| Secret | Value |
| --- | --- |
| `R2_S3_ENDPOINT` | Cloudflare's S3 API endpoint, `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 access key with object read/write access to the CDN bucket |
| `R2_SECRET_ACCESS_KEY` | Matching R2 secret access key |

Defaults are bucket `cdn-grigora-co` and public origin `https://cdn.grigora.app`. Override with repository variables `R2_BUCKET` and `CDN_PUBLIC_BASE` if needed; update the platform's SDK URL too if changing the public origin.

Connect the public CDN domain to this R2 bucket. Honor object `Cache-Control` for `/commerce/*` (remove any edge rule that forces a longer TTL on `/commerce/v1/*`). Channel files cache for 60 seconds; revision/content-addressed builds cache for a year. Allow public GET/HEAD; optionally configure CORS for source-map tooling. The workflow verifies actual public responses and fails if the domain, caching, or access rules prevent the expected bytes from being served.

Optional GitHub environment reviewers provide a second gate before uploads. The workflow itself is manual; ordinary pushes and npm release tags never deploy the CDN.

References: [R2 with the AWS CLI](https://developers.cloudflare.com/r2/examples/aws/aws-cli/), [R2 custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/), [GitHub manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Deploy when required

1. Merge this workflow onto the SDK repository's default branch so GitHub shows its **Run workflow** button.
2. Open **Actions → Deploy Commerce SDK to R2 CDN → Run workflow**.
3. Set `ref` to a branch, tag, or commit SHA, or leave it empty for the chosen workflow branch. The chosen revision must contain the CDN deployment scripts.
4. Leave **publish** unchecked for a dry run. Type checks, tests, build, and size checks run and a downloadable bundle/manifest artifact is created. No R2 credentials are needed for the dry run.
5. When ready to go live, run with **publish** checked. The publish job downloads that exact tested artifact; it does not rebuild.

Upload order: immutable `/commerce/builds/<commit>/<content-hash>/` assets → public CDN hash verification → the `/commerce/v1/` aliases → public alias hash verification → `release.json`. Every release includes both JavaScript bundles and their source maps. No bucket-wide sync, deletion, npm publish, or CloudFront invalidation is performed.

`v1` is the browser compatibility channel, independent of the current npm package version (`0.x`). A breaking browser change needs a separately reviewed channel change. There is no automatic `latest` alias.

Public alias verification retries for CDN propagation. If it fails after aliases were uploaded, the job is failed but some aliases may already have changed; use the previous successful revision to roll back. The two JS files are self-contained, so each can run independently during propagation.

## Roll back

Find the commit SHA from a previous successful workflow run or its manifest. Run the workflow with that SHA as `ref` and **publish** checked. It rebuilds/tests that revision and promotes it to `v1`. Immutable build URLs remain available; nothing is deleted. Cache rules honoring the 60-second TTL bound propagation time.

## Platform migration order

First publish and verify the CDN bundle. Then release the API changes that make new AI sites load the CDN URL and redirect the old `/general/commerce/sdk/v1/sdk.js` URLs to the CDN. Existing published sites keep working through that redirect; newly generated pages load the CDN directly. No site republish is required for old script URLs. This repository no longer copies bundles into the API repository.

Local verification: `npm run check && npm run cdn:plan`. This does not upload anything.
