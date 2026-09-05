#!/usr/bin/env node
/*
  Copy the built CDN bundle into the Grigora API repository, which serves it at
  /general/commerce/sdk/v1/sdk.js for AI-built sites.

    npm run build && npm run sync:api
    npm run sync:api -- /path/to/grigora-api-new
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.resolve(process.argv[2] || process.env.GRIGORA_API_DIR || path.join(root, "..", "grigora-api-new"));
const source = path.join(root, "packages", "sdk", "dist");
const target = path.join(apiRoot, "general", "commerce-sdk", "v1");

if (!fs.existsSync(path.join(source, "sdk.min.js"))) {
  console.error("Build first: npm run build");
  process.exit(1);
}
if (!fs.existsSync(path.join(apiRoot, "general", "commerce.js"))) {
  console.error(`Not the Grigora API repository: ${apiRoot}`);
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
for (const name of ["sdk.js", "sdk.min.js", "sdk.min.js.map"]) {
  fs.copyFileSync(path.join(source, name), path.join(target, name));
}
const version = JSON.parse(fs.readFileSync(path.join(root, "packages", "sdk", "package.json"), "utf8")).version;
fs.writeFileSync(path.join(target, "..", "VERSION"), `${version}\n`);
console.log(`Synced Grigora Commerce SDK ${version} into ${target}`);
