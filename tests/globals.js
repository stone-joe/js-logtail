// some globals to help the unit tests run
global.CustomEvent = function(event, params) {
  this.name = event;
  Object.assign(this, params);
};
// fetch mock
global.fetch = require('node-fetch');