import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@grigora/commerce-core": `${root}packages/core/src/index.ts`,
      "@grigora/commerce-ui": `${root}packages/ui/src/index.ts`,
      "@grigora/commerce-adapter-stripe": `${root}packages/adapter-stripe/src/index.ts`,
      "@grigora/commerce-adapter-razorpay": `${root}packages/adapter-razorpay/src/index.ts`,
      "@grigora/commerce-react": `${root}packages/react/src/index.ts`,
      "@grigora/commerce-vue": `${root}packages/vue/src/index.ts`,
      "@grigora/commerce": `${root}packages/sdk/src/index.ts`,
    },
  },
  test: {
    environment: "jsdom",
    include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx"],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
