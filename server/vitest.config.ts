import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Co-located *.test.ts next to the source files keeps navigation
    // tight (jump-to-test is just a sibling). Fixtures live in
    // __fixtures__/ at the workspace root.
    include: ['lib/**/*.test.ts', '*.test.ts'],
    // No globals — keep `expect`, `describe`, `it` explicit so it's
    // obvious where they come from and lints stay clean.
    globals: false,
    // Sequential when developers run locally; CI parallelism is fine.
    // Default thread-per-file is OK for our small suite.
  },
})
