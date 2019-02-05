import LogTail from './logtail.mjs';
const sinon = require('sinon');

describe('LogTail', function() {
  const sandbox = sinon.createSandbox();
  let tail;
  beforeEach(async function() {
    tail = new LogTail('/logs/file.log');
    sandbox.restore();
  });
  describe('method #getLog', function() {
    it('should not call fetch if it\'s paused or loading', async function() {
      // setup
      const stub = sandbox.stub(global, 'fetch');
      // test
      tail.paused = true;
      tail._loading = false;
      tail.getLog();
      // tail._loading = true;
      // tail.paused = false;
      // tail.getLog();
      // verify
      sinon.assert.notCalled(stub);
    });    
  });
});