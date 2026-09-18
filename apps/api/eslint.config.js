import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Fastify plugin registration functions are conventionally async
      // even when a given plugin has no internal await; requiring one
      // produces noise, not bugs.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // node:test's `test(name, async () => {...})` intentionally isn't
    // awaited at the top level — the test runner tracks completion
    // itself. no-floating-promises doesn't know that idiom.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },

  {
    ignores: ['dist/**', 'drizzle/**'],
  },

  prettierConfig,
)   