module.exports = function(config) {
  config.set({
    frameworks: ['mocha', 'chai'],
    files: [
      {
        pattern: './logtail.js',
        type: 'module',
        included: true,
        watched: true,
      },
      {
        pattern: './test/test.log',
        served: true,
      },
      'test/**/*Spec.js',
    ],
    reporters: ['progress'],
    port: 9876,  // karma web server port
    colors: true,
    logLevel: config.LOG_INFO,
    browsers: ['ChromeHeadless'],
    autoWatch: false,
    concurrency: Infinity,
    proxies: {
      '/weblog': '/base/tests/test.log',
    },
  });
};