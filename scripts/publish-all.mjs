#!/usr/bin/env node
/*
  Publish every package to npm in dependency order. Expects `npm run build`
  to have run and NPM_TOKEN (or an npm login) to be available.

    node scripts/publish-all.mjs            # publish
    node scripts/publish-all.mjs --dry-run  # show what would happen
*/
import { execSync } from "node:child_process";

const ORDER = [
  "@grigora/commerce-core",
  "@grigora/commerce-ui",
  "@grigora/commerce-adapter-stripe",
  "@grigora/commerce-adapter-razorpay",
  "@grigora/commerce-react",
  "@grigora/commerce-vue",
  "@grigora/commerce",
];

const dryRun = process.argv.includes("--dry-run");
const tag = process.argv.find((arg) => arg.startsWith("--tag="))?.slice(6) || "latest";

for (const name of ORDER) {
  const command = `npm publish -w ${name} --access public --tag ${tag}${process.env.CI ? " --provenance" : ""}${dryRun ? " --dry-run" : ""}`;
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit" });
}
