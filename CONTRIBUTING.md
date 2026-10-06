# Contributing

Thanks for helping make Grigora Commerce better for every site that sells with it.

## Setup

```bash
git clone https://github.com/Latracal-Solutions/grigora-commerce-sdk.git
cd grigora-commerce-sdk
npm install
npm run check
```

`npm run check` runs the TypeScript typecheck, the vitest suite (jsdom), the build of every package in dependency order, and the size budgets. All four must pass before a pull request is merged; CI runs them on Node 18, 20 and 22.

## Repository layout

```
packages/core             @grigora/commerce-core     headless client
packages/ui               @grigora/commerce-ui       web components + data attributes
packages/adapter-stripe   @grigora/commerce-adapter-stripe
packages/adapter-razorpay @grigora/commerce-adapter-razorpay
packages/react            @grigora/commerce-react
packages/vue              @grigora/commerce-vue
packages/sdk              @grigora/commerce          everything + CDN bundle (src/cdn.ts)
docs/                     guides and reference
examples/                 runnable examples
scripts/                  set-version.mjs, publish-all.mjs
```

Tests live next to the code (`src/**/*.test.ts`) and run against sources through path aliases, so no build is needed to test. Core tests use a small fake `fetch` (`packages/core/src/__tests__/helpers.ts`); UI tests drive real custom elements in jsdom.

## Principles

- **The API is the source of truth.** Prices, stock, shipping, tax and payment state come from the Grigora API. The SDK renders and orchestrates; it never computes money on its own.
- **No secrets in the browser.** Only publishable keys, ever.
- **Compatible storage.** The cart key and item shape are shared with Grigora's platform scripts. Do not change them without a migration plan.
- **Accessible by default.** Dialogs trap focus, return focus, close on Escape, and make the background inert. Keep it that way.
- **Small.** Budgets are in `.size-limit.json`. New features should pay for themselves.
- **Text, never HTML.** API strings go through `textContent`/`setAttribute`. The only `innerHTML` in the UI is the fixed icon set.

## Making a change

1. Branch from `main`.
2. Add or update tests with the change.
3. Update the relevant doc in `docs/` and `CHANGELOG.md` under Unreleased.
4. `npm run check`.
5. Open a pull request describing the behaviour change and, for UI, a screenshot or recording.

## Releasing (maintainers)

```bash
node scripts/set-version.mjs 0.2.0   # bumps every package, dependency ranges and VERSION constants
git commit -am "Release 0.2.0" && git tag v0.2.0 && git push --follow-tags
```

The release workflow publishes npm packages with provenance and creates the GitHub release. It does not publish browser bundles.

Use **Deploy Commerce SDK to R2 CDN** in GitHub Actions for browser delivery. It builds and checks the chosen ref, saves an artifact, and only uploads when **publish** is selected. See [CDN deployment](docs/cdn-deployment.md) for R2 configuration, verification, and rollback. SDK changes no longer need a copied bundle or an API deployment.
