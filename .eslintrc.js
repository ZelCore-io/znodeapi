module.exports = {
  root: true,
  env: {
    node: true,
  },
  extends: [
    'airbnb',
    'airbnb/hooks',
  ],
  rules: {
    'max-len': [
      'error',
      {
        code: 300,
        ignoreUrls: true,
      },
    ],
    'no-console': 'off',
    'linebreak-style': 'off',
  },
  parserOptions: {
    parser: 'babel-eslint',
  },
};
