import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareDeployment, publishDeployment, validateUploadConfig, validateCacheHeaders } from "./deploy-cdn.mjs";

test("rejects CDN cache overrides that delay live updates", () => {
  const headers = value => new Headers({ "Cache-Control": value });
  validateCacheHeaders(headers("public, max-age=60, must-revalidate"), true);
  validateCacheHeaders(headers("public, max-age=0, must-revalidate"), true);
  for (const value of ["public, max-age=14400, must-revalidate", "public, max-age=60", "public, max-age=60, must-revalidate, s-maxage=7200", "public, max-age=60, must-revalidate, stale-while-revalidate=3600", "public, max-age=60, must-revalidate, immutable", ""]) {
    assert.throws(() => validateCacheHeaders(headers(value), true));
  }
  validateCacheHeaders(headers("public, max-age=31536000, immutable"));
  assert.throws(() => validateCacheHeaders(headers("public, max-age=60, must-revalidate")));
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "commerce-cdn-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "packages/sdk/dist"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/sdk/package.json"), JSON.stringify({ version: "0.1.0" }));
  for (const name of ["sdk.js", "sdk.min.js", "sdk.js.map", "sdk.min.js.map"]) {
    await fs.writeFile(path.join(root, "packages/sdk/dist", name), name.endsWith(".map") ? JSON.stringify({ version: 3, sources: [] }) : "/* Grigora Commerce SDK */" + " ".repeat(21000));
  }
  return { root, revision: "a".repeat(40) };
}

test("plans v1 independently of the prerelease package major and hashes every built file", async t => {
  const input = await fixture(t);
  const plan = await prepareDeployment(input);
  assert.equal(plan.publicBase, "https://prod.grigora-cdn.com");
  assert.equal(plan.channelPrefix, "commerce/v1");
  assert.equal(plan.version, "0.1.0");
  assert.equal(plan.assets.length, 4);
  assert(plan.assets.every(asset => /^[a-f0-9]{64}$/.test(asset.sha256)));
  await fs.appendFile(path.join(input.root, "packages/sdk/dist/sdk.js"), "changed");
  const changed = await prepareDeployment(input);
  assert.notEqual(changed.immutablePrefix, plan.immutablePrefix, "different bytes must never overwrite an immutable URL");
});

test("rejects missing artifacts, bad revisions, channels and public origins before uploading", async t => {
  const input = await fixture(t);
  for (const overrides of [{ revision: "main" }, { channel: "../v1" }, { publicBase: "http://cdn.example.com" }, { publicBase: "https://cdn.example.com/path" }, { publicBase: "https://cdn.grigora.app" }, { publicBase: "https://grigora.app" }, { publicBase: "https://cdn.grigora.co" }]) {
    await assert.rejects(prepareDeployment({ ...input, ...overrides }));
  }
  await fs.unlink(path.join(input.root, "packages/sdk/dist/sdk.min.js"));
  await assert.rejects(prepareDeployment(input), /ENOENT/);
});

test("validates R2 configuration without accepting arbitrary credential destinations", () => {
  const env = { R2_S3_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, R2_BUCKET: "cdn-grigora-co", R2_ACCESS_KEY_ID: "fake", R2_SECRET_ACCESS_KEY: "fake" };
  validateUploadConfig(env);
  assert.throws(() => validateUploadConfig({ ...env, R2_SECRET_ACCESS_KEY: "" }), /Missing/);
  assert.throws(() => validateUploadConfig({ ...env, R2_S3_ENDPOINT: "https://example.com" }), /R2 S3 API origin/);
});

test("publishes immutable bytes and verifies public CDN access before promoting the channel", async t => {
  const plan = await prepareDeployment(await fixture(t));
  const events = [];
  await publishDeployment(plan, {
    upload: async (_asset, key, cache) => events.push({ kind: "upload", key, cache }),
    verify: async (_asset, key) => events.push({ kind: "verify", key }),
    writeManifest: async key => events.push({ kind: "manifest", key }),
  });
  const firstAlias = events.findIndex(event => event.kind === "upload" && event.key.startsWith("commerce/v1/"));
  assert.equal(events.slice(0, firstAlias).filter(event => event.kind === "verify").length, 4);
  assert(events.filter(event => event.kind === "upload" && event.key.startsWith("commerce/v1/")).every(event => event.cache === "public, max-age=60, must-revalidate"));
  assert.deepEqual(events.at(-1), { kind: "manifest", key: "commerce/v1/release.json" });
});

test("a failed upload or CDN verification cannot promote unverified bytes", async t => {
  const plan = await prepareDeployment(await fixture(t));
  for (const failure of ["upload", "verify"]) {
    const keys = [];
    await assert.rejects(publishDeployment(plan, {
      upload: async (_asset, key) => { keys.push(key); if (failure === "upload") throw new Error("R2 unavailable"); },
      verify: async () => { throw new Error("CDN not configured"); },
      writeManifest: async key => keys.push(key),
    }));
    assert(!keys.some(key => key.startsWith("commerce/v1/")));
  }
});
