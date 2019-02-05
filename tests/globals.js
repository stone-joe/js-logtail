// some globals to help the unit tests run
global.CustomEvent = function(event, params) {
  var evt, origPrevent;
  params = params || {};
  params.bubbles = !!params.bubbles;
  params.cancelable = !!params.cancelable;

  evt = document.createEvent('CustomEvent');
  evt.initCustomEvent(
    event,
    params.bubbles,
    params.cancelable,
    params.detail
  );
  origPrevent = evt.preventDefault;
  evt.preventDefault = function() {
    origPrevent.call(this);
    try {
      Object.defineProperty(this, 'defaultPrevented', {
        get() {
          return true;
        }
      });
    } catch (e) {
      this.defaultPrevented = true;
    }
  };
  return evt;
};
// fetch mock
global.fetch = require('node-fetch');