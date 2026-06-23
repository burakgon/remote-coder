import tseslint from "typescript-eslint";

export default tseslint.config(
  // Never lint build output (it is generated and gitignored): the app bundle (`dist`), the
  // screenshot-harness bundle (`dist-shot`), Vite's caches, and any coverage report.
  { ignores: ["**/dist/**", "**/dist-shot/**", "**/node_modules/**", "**/coverage/**", "**/.vite/**"] },
  ...tseslint.configs.recommended,
);
