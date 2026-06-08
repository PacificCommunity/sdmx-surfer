import globals from "globals";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      ".next/**",
      "build/**",
      "next-env.d.ts",
      "node_modules/**",
      "out/**",
      "patches/**",
      "stitch_assets/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
  {
    // Country Snapshots module boundary: nothing outside the five module
    // paths may import from country-snapshots/*. Keeps the feature cleanly
    // extractable and removable.
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: [
      "app/countrysnapshots/**",
      "app/api/countrysnapshots/**",
      "lib/country-snapshots/**",
      "components/country-snapshots/**",
      "scripts/import-country-snapshots.ts",
      "tests/country-snapshots/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/country-snapshots/**", "**/country-snapshots"],
              message:
                "Country Snapshots is a self-contained module. Code outside the five module paths may not import from it.",
            },
          ],
        },
      ],
    },
  },
];
