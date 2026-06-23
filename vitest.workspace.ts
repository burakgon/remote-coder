// Root Vitest workspace: ONE `vitest run` (the root `pnpm test`) now picks up BOTH suites —
// the protocol + server tests (node env, via this repo's root `vitest.config.ts`) AND the web
// component tests (jsdom env, via `packages/web/vitest.config.ts`). Without this, the root
// config's `include: ["packages/*/test/**/*.test.ts"]` matched only `.ts` files under
// `packages/*/test/`, silently skipping the ~135 web tests in `packages/web/src/**/*.test.tsx`
// and `packages/web/test/**` — a web regression would have shipped green.
//
// Each project keeps its own config (and `pnpm -C packages/web test` / the per-package commands
// still work unchanged); the web suite is NOT pulled into the node-env root config.
export default ["./vitest.config.ts", "./packages/web/vitest.config.ts"];
