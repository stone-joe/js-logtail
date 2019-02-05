import LogTail, { MissingHeaderError, LogFileTruncatedError, UnexpectedServerResponseError, FetchError, DataAppendedEvent } from './logtail.mjs';
const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
chai.use(require('chai-as-promised'));

describe('LogTail', function() {
  const sandbox = sinon.createSandbox();
  let tail;
  beforeEach(async function() {
    tail = new LogTail({
      url: '/logs/file.log',
    });
    sandbox.restore();
  });
  afterEach(async function() {
    if (tail._timeout) {
      clearTimeout(tail._timeout);
    }
  });
  describe('method #sendRangeRequest', function() {
    it('should send a request with the requested range to the correct url, set the current file length, and return the text from the response', async function() {
      // setup
      const stub = sandbox.stub(global, 'fetch').returns(Promise.resolve({ok: true, clone: () => ({headers: {get: () => 500}, status: 200, text: () => Promise.resolve('fake text')})}));
      // test
      const text = await tail.sendRangeRequest('0-67');
      // verify
      sinon.assert.called(stub);
      sinon.assert.calledWith(stub, '/logs/file.log', sinon.match({
        headers: sinon.match({
          Range: 'bytes=0-67'
        }),
      }));
      expect(tail.logFileSize).to.eq(500);
      expect(text).to.eq('fake text');
    });
    it('should set the file size to the new size in the content-range header', async function() {
      // setup
      sandbox.stub(global, 'fetch').returns(Promise.resolve({
        ok: true, 
        clone: () => ({
          headers: {
            get(header) {
              if (header.toLowerCase() === 'content-length') {
                return 30;
              } else if (header.toLowerCase() === 'content-range') {
                return '20-50/10560';
              }
            }
          },
          status: 206,
          text: () => Promise.resolve('some data')
        })
      }));
      // test
      await tail.sendRangeRequest('20-50');
      // verify
      expect(tail.logFileSize).to.eq(10560);
    });
    it('should throw MissingHeaderError if the content-range is not defined', async function() {
      // setup
      sandbox.stub(global, 'fetch').returns(Promise.resolve({
        ok: true, 
        clone: () => ({
          headers: {
            get(header) {
              if (header.toLowerCase() === 'content-length') {
                return 30;
              }
            },
            keys: () => []
          },
          status: 206,
          text: () => Promise.resolve('some data')
        })
      }));
      // test
      try {
        await tail.sendRangeRequest('20-50');
      } catch (e) {
        expect(e).to.be.instanceOf(MissingHeaderError);
      }
    });
    it('should throw if a 416 response is returned', async function() {
      // setup
      sandbox.stub(global, 'fetch').returns(Promise.resolve({
        ok: true, 
        clone: () => ({
          headers: {
            get(header) {
              if (header.toLowerCase() === 'content-length') {
                return 30;
              } else if (header.toLowerCase() === 'content-range') {
                return '20-50/10560';
              }
            },
            keys: () => []
          },
          status: 416,
          text: () => Promise.resolve('some data')
        })
      }));
      // test
      try {
        await tail.sendRangeRequest('20-50');
      } catch (e) {
        expect(e).to.be.instanceOf(LogFileTruncatedError);
      }
    });
    it('should throw unexpected error response when non 200, 206, or 416 are returned', async function() {
      // setup
      sandbox.stub(global, 'fetch').returns(Promise.resolve({
        ok: true, 
        clone: () => ({
          headers: {
            get(header) {
              if (header.toLowerCase() === 'content-length') {
                return 30;
              } else if (header.toLowerCase() === 'content-range') {
                return '20-50/10560';
              }
            },
            keys: () => []
          },
          status: 500,
          text: () => Promise.resolve('some data')
        })
      }));
      // test
      try {
        await tail.sendRangeRequest('20-50');
      } catch (e) {
        expect(e).to.be.instanceOf(UnexpectedServerResponseError);
      }
    });
    it('should throw fetch error if network error occurs', async function() {
      // setup
      sandbox.stub(global, 'fetch').throws(new Error('network error'));
      // test
      try {
        await tail.sendRangeRequest('20-50');
      } catch (e) {
        expect(e).to.be.instanceOf(FetchError);
      }
    });
  });
  describe('method #getRange', function() {
    it('should return the default range and get the current file size', async function() {
      // setup
      tail._logFileSize = null;
      sandbox.stub(tail, 'requestLogSize').returns(Promise.resolve(40000));
      // test
      const range = await tail.getRange();
      // verify
      expect(range).to.eq(`-${30 * 1024}`);
      expect(tail.logFileSize).to.eq(40000);
    });
    it('should return the a range that gets the entire file if loadBytes is greater than the size of the file', async function() {
      // setup
      tail._logFileSize = null;
      sandbox.stub(tail, 'requestLogSize').returns(Promise.resolve(10000));
      // test
      const range = await tail.getRange();
      // verify
      expect(range).to.eq('-10000');
    });
    it('should return the range that gets the rest of the file starting at the size of the file - 1', async function() {
      // setup
      tail._logFileSize = 36000;
      // test
      const range = await tail.getRange();
      // verify
      expect(range).to.eq('35999-');
    });
  });
  describe('method #getLog', function() {
    it('should return the data excluding the first byte', async function() {
      // setup
      sandbox.stub(tail, 'getRange').returns(Promise.resolve('0-'));
      sandbox.stub(tail, 'sendRangeRequest').returns(Promise.resolve('some data'));
      tail._firstLoad = false;
      // test
      const content = await tail.getLog();
      // verify
      expect(content).to.eq('ome data');
    });
    it('should append to the cached data', async function() {
      // setup
      sandbox.stub(tail, 'getRange').returns(Promise.resolve('0-'));
      sandbox.stub(tail, 'sendRangeRequest').returns(Promise.resolve('some data'));
      tail._firstLoad = false;
      tail._logData = 'test';
      // test
      await tail.getLog();
      // verify
      expect(tail.logData).to.eq('testome data');
    });
    it('should return the full, initial response', async function() {
      // setup
      sandbox.stub(tail, 'getRange').returns(Promise.resolve('0-'));
      sandbox.stub(tail, 'sendRangeRequest').returns(Promise.resolve('some large blob'));
      tail._firstLoad = true;
      // test
      const content = await tail.getLog();
      // verify
      expect(content).to.eq('some large blob');
      expect(tail.logData).to.eq('some large blob');
    });
  });
  describe('method #poll', function() {
    it('should emit an event when the data is retrieved', async function() {
      return new Promise(async (resolve, reject) => {
        // setup
        const stub = sandbox.stub();
        sandbox.stub(tail, 'getLog').returns(Promise.resolve('some log data'));
        tail.on(DataAppendedEvent.name, stub);
        tail.on('error', error => reject(error));
        // test
        await tail.poll();
        await new Promise(resolve => setTimeout(resolve, 100));
        // verify
        try {
          clearTimeout(tail._timeout);
          sinon.assert.called(stub);
          sinon.assert.calledWith(stub, sinon.match({
            detail: 'some log data',
          }));
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    it('should emit an error when one is thrown', async function() {
      return new Promise(async (resolve, reject) => {
        // setup
        const stub = sandbox.stub();
        const testError = new MissingHeaderError();
        sandbox.stub(tail, 'getLog').throws(testError);
        tail.on(DataAppendedEvent.name, reject);
        tail.on('error', stub);
        tail.on(MissingHeaderError.name, stub);
        // test
        await tail.poll();
        await new Promise(resolve => setTimeout(resolve, 100));
        // verify
        try {
          clearTimeout(tail._timeout);
          sinon.assert.calledTwice(stub);
          sinon.assert.calledWith(stub, testError);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    it('should poll regardless of failure or success', async function() {
      this.timeout(5000);
      return new Promise(async (resolve, reject) => {
        // setup
        const spy = sandbox.spy(tail, 'poll');
        const testError = new Error();
        sandbox.stub(tail, 'getLog')
          .onFirstCall()
          .returns(Promise.resolve('test'))
          .onSecondCall()
          .throws(testError);
        tail.on('error', error => error !== testError && reject(error));
        tail.pollInterval = 500;
        // test
        await tail.poll();
        await new Promise(resolve => setTimeout(() => (tail.paused = true) && resolve(), 1500));
        // verify
        try {
          clearTimeout(tail._timeout);
          sinon.assert.calledThrice(spy);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    it('should not poll if paused or loading', async function() {
      // setup
      const stub = sandbox.stub(tail, 'getLog').returns(Promise.resolve('test'));
      setTimeout(() => clearTimeout(tail._timeout), 500);
      tail.pollInterval = 10000000;
      // test
      tail.paused = true;
      tail._loading = false;
      await tail.poll();
      tail._loading = true;
      tail.paused = false;
      await tail.poll();
      // verify
      sinon.assert.notCalled(stub);
    });
  });
});