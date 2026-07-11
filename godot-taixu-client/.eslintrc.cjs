const { resolve } = require('node:path');

const root = resolve(__dirname, '..');

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  parserOptions: {
    project: [resolve(root, 'tsconfig.godot-bridge.json')],
    tsconfigRootDir: root,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/no-unnecessary-type-assertion': 'off',
  },
  overrides: [
    {
      files: ['**/*.mjs'],
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      parserOptions: { project: null },
    },
  ],
};
