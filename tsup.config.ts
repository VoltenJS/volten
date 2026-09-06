// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/tools/drr/index.ts", "src/tools/drr/replay.ts"],
  format: ["cjs", "esm"],
  dts: {
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  splitting: false,
  sourcemap: true,
  target: "node24",
  metafile: true,
});
