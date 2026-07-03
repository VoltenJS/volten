import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
// 1. Import the security plugin
import pluginSecurity from "eslint-plugin-security";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  // 2. Add the recommended security ruleset
  pluginSecurity.configs.recommended,
  {
    rules: {
      // ❌ Turn off the standard JavaScript rule (it breaks on TS files)
      "no-unused-vars": "off",

      //  Turn on the smart TypeScript rule instead
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
);
