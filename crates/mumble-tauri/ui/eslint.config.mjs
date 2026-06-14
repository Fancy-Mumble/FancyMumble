import tseslint from "typescript-eslint";

// Plugin stubs to honour `eslint-disable` comments scattered across the
// codebase without forcing those rules to be active globally.  Installing the
// real plugins would activate many additional rules and produce noise across
// in-progress workstreams, so we only register the rule names with no-op
// implementations.
const stub = () => ({ meta: { schema: [] }, create: () => ({}) });
const stubPlugin = (names) => ({
  rules: Object.fromEntries(names.map((n) => [n, stub()])),
});

const reactHooksPlugin = stubPlugin(["exhaustive-deps", "rules-of-hooks"]);
const jsxA11yPlugin = stubPlugin([
  "no-static-element-interactions",
  "media-has-caption",
  "click-events-have-key-events",
]);
const reactPlugin = stubPlugin(["no-danger"]);

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "src-tauri/target/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
      react: reactPlugin,
    },
    rules: {
      "max-depth": ["warn", { max: 4 }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
);
