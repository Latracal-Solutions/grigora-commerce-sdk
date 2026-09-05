import { defineConfig } from "tsup";

const banner = { js: "/* Grigora Commerce SDK — https://github.com/Latracal-Solutions/grigora-commerce-sdk — MIT */" };

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: { compilerOptions: { paths: {} } },
    sourcemap: true,
    clean: true,
    target: "es2020",
    treeshake: true,
    splitting: false,
  },
  {
    entry: { sdk: "src/cdn.ts" },
    format: ["iife"],
    outExtension: () => ({ js: ".js" }),
    noExternal: [/^@grigora\//],
    platform: "browser",
    target: "es2020",
    sourcemap: true,
    minify: false,
    banner,
  },
  {
    entry: { "sdk.min": "src/cdn.ts" },
    format: ["iife"],
    outExtension: () => ({ js: ".js" }),
    noExternal: [/^@grigora\//],
    platform: "browser",
    target: "es2020",
    sourcemap: true,
    minify: true,
    banner,
  },
]);
