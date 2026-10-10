module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',       // import vars from '@env'
          path: '.env',             // reads from .env in project root
          blacklist: null,
          whitelist: null,
          safe: true,               // throws if a var in .env.example is missing
          allowUndefined: false,
        },
      ],
    ],
  };
};
