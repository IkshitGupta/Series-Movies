module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // React Compiler is disabled: it is experimental and mis-compiles some
      // components (throws a spurious "navigation context" error on re-render).
      ['babel-preset-expo', { jsxImportSource: 'nativewind', 'react-compiler': false }],
      'nativewind/babel',
    ],
  };
};
