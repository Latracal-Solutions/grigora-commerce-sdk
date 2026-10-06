#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["sdk.js", "sdk.min.js", "sdk.js.map", "sdk.min.js.map"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function prepareDeployment({ root = ROOT, revision, channel = "v1", publicBase = "https://cdn.grigora.co" }) {
  if (!/^[a-f0-9]{40}$/.test(revision || "")) throw new Error("SDK_REVISION must be a full Git commit SHA.");
  if (!/^v[1-9][0-9]*$/.test(channel)) throw new Error("SDK_CHANNEL must be a compatibility channel such as v1.");
  const url = new URL(publicBase);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("CDN_PUBLIC_BASE must be an HTTPS origin.");
  const version = JSON.parse(await fs.readFile(path.join(root, "packages/sdk/package.json"), "utf8")).version;
  const assets = [];
  for (const name of FILES) {
    const file = path.join(root, "packages/sdk/dist", name);
    const bytes = await fs.readFile(file);
    if (name.endsWith(".js")) {
      if (!bytes.toString().startsWith("/* Grigora Commerce SDK") || bytes.length < 20000) throw new Error(`Invalid SDK bundle: ${name}`);
    } else if (JSON.parse(bytes.toString()).version !== 3) throw new Error(`Invalid source map: ${name}`);
    assets.push({ name, file, sha256: hash(bytes), bytes: bytes.length, contentType: name.endsWith(".map") ? "application/json; charset=utf-8" : "application/javascript; charset=utf-8" });
  }
  return { revision, channel, version, publicBase: url.origin, immutablePrefix: `commerce/builds/${revision}/${hash(assets.map(asset => asset.sha256).join(""))}`, channelPrefix: `commerce/${channel}`, assets };
}

export function validateUploadConfig(env) {
  for (const key of ["R2_S3_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    if (!env[key]) throw new Error(`Missing ${key}. Configure the commerce-sdk-cdn GitHub environment.`);
  }
  const endpoint = new URL(env.R2_S3_ENDPOINT);
  if (endpoint.protocol !== "https:" || !/^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) || endpoint.pathname !== "/" || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("R2_S3_ENDPOINT must be your Cloudflare R2 S3 API origin.");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET)) throw new Error("Invalid R2_BUCKET.");
}

export async function publishDeployment(plan, { upload, verify, writeManifest }) {
  // Verify immutable assets through the public CDN before changing any live alias.
  for (const asset of plan.assets) await upload(asset, `${plan.immutablePrefix}/${asset.name}`, "public, max-age=31536000, immutable");
  for (const asset of plan.assets) await verify(asset, `${plan.publicBase}/${plan.immutablePrefix}/${asset.name}`);
  await writeManifest(`${plan.immutablePrefix}/release.json`, "public, max-age=31536000, immutable");
  // Each JS bundle is self-contained; maps first, then the independently usable bundles.
  const promotionOrder = [...plan.assets.filter(a => a.name.endsWith(".map")), ...plan.assets.filter(a => a.name.endsWith(".js"))];
  for (const asset of promotionOrder) await upload(asset, `${plan.channelPrefix}/${asset.name}`, "public, max-age=60, must-revalidate");
  for (const asset of plan.assets) await verify(asset, `${plan.publicBase}/${plan.channelPrefix}/${asset.name}`, true);
  await writeManifest(`${plan.channelPrefix}/release.json`, "public, max-age=60, must-revalidate");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--publish", "--dry-run"].includes(arg)) || (args.includes("--publish") && args.includes("--dry-run"))) throw new Error("Usage: node scripts/deploy-cdn.mjs [--dry-run | --publish]");
  const plan = await prepareDeployment({ revision: process.env.SDK_REVISION || execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(), channel: process.env.SDK_CHANNEL || "v1", publicBase: process.env.CDN_PUBLIC_BASE || "https://cdn.grigora.co" });
  const manifest = { revision: plan.revision, version: plan.version, channel: plan.channel, assets: plan.assets.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })) };
  const manifestFile = path.join(ROOT, "packages/sdk/dist/release.json");
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ publish: args.includes("--publish"), ...manifest, immutableURL: `${plan.publicBase}/${plan.immutablePrefix}/sdk.js`, channelURL: `${plan.publicBase}/${plan.channelPrefix}/sdk.js` }, null, 2));
  if (!args.includes("--publish")) return;
  validateUploadConfig(process.env);
  const awsEnv = { ...process.env, AWS_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION: "auto", AWS_EC2_METADATA_DISABLED: "true", AWS_REQUEST_CHECKSUM_CALCULATION: "when_required", AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required" };
  // No credentials are placed in CLI arguments or output.
  const upload = async (asset, key, cacheControl) => {
    execFileSync("aws", ["s3", "cp", asset.file, `s3://${process.env.R2_BUCKET}/${key}`, "--endpoint-url", process.env.R2_S3_ENDPOINT, "--content-type", asset.contentType, "--cache-control", cacheControl, "--metadata", `sha256=${asset.sha256},revision=${plan.revision}`, "--only-show-errors"], { env: awsEnv, stdio: ["ignore", "inherit", "inherit"] });
  };
  const verify = async (asset, url, alias = false) => {
    // Verify the actual URL, not a cache-busting query that might hide a stale alias.
    const attempts = alias ? 20 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
        if (response.ok && hash(Buffer.from(await response.arrayBuffer())) === asset.sha256) return;
      } catch { /* Transient CDN propagation: retry, then fail the deployment. */ }
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, alias ? 15000 : 3000));
    }
    throw new Error(`CDN verification failed for ${url}. Check the custom domain and cache rules before retrying.`);
  };
  const manifestBytes = await fs.readFile(manifestFile);
  await publishDeployment(plan, { upload, verify, writeManifest: (key, cache) => upload({ file: manifestFile, contentType: "application/json; charset=utf-8", sha256: hash(manifestBytes) }, key, cache) });
  console.log(`Verified ${plan.publicBase}/${plan.channelPrefix}/sdk.js at ${plan.revision}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
