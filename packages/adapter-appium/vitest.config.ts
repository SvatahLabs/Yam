import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Everything here is a pure function of a page source or of a fake client:
    // no device, no emulator, no server. The emulator gate is documented in
    // `README.md` and is not run from here (T4.2).
    testTimeout: 30_000,
  },
});
