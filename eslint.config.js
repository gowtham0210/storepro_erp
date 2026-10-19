import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Off: providers deliberately export their hook next to the component.
      'react-refresh/only-export-components': 'off',
      // The renderer must reach Node/Electron only through the preload bridge.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['electron', 'electron/*'], message: 'Use window.storepro (preload bridge).' },
            { group: ['node:*'], message: 'Node.js modules are not available in the renderer.' }
          ]
        }
      ]
    }
  },
  {
    // Renderer tests that run in Node (e.g. reading the theme file).
    files: ['src/renderer/**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' }
  },
  {
    // Tests and dev data generators index into arrays they just built.
    files: ['**/*.test.{ts,tsx}', 'src/main/db/dev/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' }
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
)
