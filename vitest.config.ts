import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    // The WS/integration tests spawn a `node` mock subprocess per session. Running the test
    // FILES in parallel (the default) makes those handshakes/round-trips compete for the same
    // spawn/IO budget, so under full-suite load a WS turn intermittently never delivers its
    // output ("no result over ws"). Serialising the files removes that contention and
    // makes the suite reliably green (verified across repeated full runs); tests WITHIN a file
    // still run as written. The suite is small, so the serial cost is minor.
    fileParallelism: false,
    // Headroom over the longest in-test reject budget (10s) so the harness never kills a
    // subprocess-driven WS turn before its own deadline fires.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
