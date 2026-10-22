import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/exhaustive-deps': 'warn' },
  },
  // Missing a projection dependency can move an entire astronomical layer.
  { files: ['client/src/components/SkyChart.tsx'], rules: { 'react-hooks/exhaustive-deps': 'error' } },
];
