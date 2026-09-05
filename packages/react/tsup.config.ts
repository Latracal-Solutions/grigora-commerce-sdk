import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: { compilerOptions: { paths: {} } },
  sourcemap: true,
  clean: true,
  target: "es2020",
  treeshake: true,
  splitting: false,
  minify: false,
});
