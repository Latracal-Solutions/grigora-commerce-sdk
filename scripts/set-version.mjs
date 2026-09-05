#!/usr/bin/env node
/*
  Set one version across every package, keep the inter-package dependency
  ranges in step, and update the VERSION constants shipped in the bundles.

    node scripts/set-version.mjs 0.2.0
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}

const packagesDir = path.join(root, "packages");
const names = new Set();
const manifests = fs
  .readdirSync(packagesDir)
  .map((dir) => path.join(packagesDir, dir, "package.json"))
  .filter((file) => fs.existsSync(file));

for (const file of manifests) names.add(JSON.parse(fs.readFileSync(file, "utf8")).name);

for (const file of [...manifests, path.join(root, "package.json")]) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.version = version;
  for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
    for (const dep of Object.keys(json[field] || {})) {
      if (names.has(dep)) json[field][dep] = `^${version}`;
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

for (const file of [path.join(root, "packages/core/src/version.ts")]) {
  fs.writeFileSync(file, `/** Kept in sync with package.json by scripts/set-version.mjs. */\nexport const VERSION = ${JSON.stringify(version)};\n`);
}

console.log(`Version set to ${version} across ${manifests.length} packages.`);
