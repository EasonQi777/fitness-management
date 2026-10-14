import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier/flat'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    'blob-report',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // 认证信息只能经由 authStore 读写 localStorage
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/store/authStore.js', 'src/**/*.test.{js,jsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: '请通过 useAuthStore 访问认证信息' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: '请通过 useAuthStore 访问认证信息',
        },
      ],
    },
  },
  {
    files: ['*.config.js', 'e2e/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  prettier,
])
