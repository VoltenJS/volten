import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import pluginSecurity from "eslint-plugin-security";

export default defineConfig([
  {
    ignores: ["eslint.config.js", "tests"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  pluginSecurity.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-unused-vars": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",

      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",

      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
]);
