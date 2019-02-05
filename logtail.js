/* Copyright (c) 2012: Daniel Richman. License: GNU GPL 3 */
/* Additional features: Priyesh Patel                     */
/* ES6 update: Joseph Stone                               */
export const defaultOpts = {
  url: '/logs',
  loadBytes: 30 * 1024, /* 30KB */
  pollInterval: 1000, /* 1s */
  pause: false,
  debug: false,
};

/**
 * A class for tailing logs from a server. This requires that the server properly consumes the Range header (most should)
 */
export default class LogTail {
  /**
   * 
   * @param {object} opts
   * @param {string} opts.url
   * @param {number} opts.loadBytes The number of bytes to load from the end of the file. Defaults to 30kb
   * @param {number} opts.pollInterval The time to wait between polls. Defaults to 1 second
   * @param {boolean} opts.pause Set to true to stop the poll, false to begin
   * @param {boolean} opts.debug Whether or not to log to the console. Defaults to false
   */
  constructor(opts = {}) {
    Object.assign(this, defaultOpts, opts);
    this._listeners = {};
  }

  /**
   * Add a listener to the specified event
   * @param {string} event
   * @param {function} callback
   * @param {object} ctx
   */
  on(event, callback, ctx) {
    this.console.debug(`EventEmitter: Adding listener ${callback} to event ${event} with context ${ctx}`);
    this.listeners(event).push({callback, ctx});
  }

  /**
   * Removes the listener from the event
   * @param {string} event
   * @param {function} callback
   */
  off(event, callback) {
    const listenerIndex = this.listeners(event).findIndex(listener => listener.callback !== callback);
    if (listenerIndex > -1) {
      this._listeners[event].splice(listenerIndex, 1);
      this.console.debug(`EventEmitter: Removing listener ${callback} from event ${event}`);
      return true;
    } else {
      this.console.warn(`EventEmitter: failed to find listener ${callback} for event ${event}. Nothing has been removed`);
      return false;
    }
  }

  /**
   * @param {string} event
   * @returns {{callback: function, ctx: object}[]}
   */
  listeners(event) {
    return (this._listeners[event] || (this._listeners[event] = []));
  }

  /**
   * Calls all listeners subscribed to this event
   * @param {string} event
   * @param {mixed[]} args Arguments to send to the listener
   */
  emit(event, args=[]) {
    this.console.debug(`EventEmitter: emitting event ${event} with arguments ${args}`);
    this.listeners(event).forEach(listener => {
      this.console.debug(`EventEmitter: emit ${event} to ${listener}`);
      args = Array.isArray(args) ? args : [args];
      if (listener.ctx) {
        listener.callback.apply(listener.ctx, args);
      } else {
        listener.callback(...args);
      }
    });
  }

  /* :-( https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt */
  parseInt2(value) {
    if (!(/^[0-9]+$/.test(value))) throw new TypeError('Invalid integer ' + value);
    const v = Number(value);
    if (isNaN(v)) throw new TypeError('Invalid integer ' + value);
    return v;
  }

  /**
   * Helper method for performing a HEAD request to get the total size of the log
   * @returns {Promise<number, Error>}
   */
  async requestLogSize() {
    this.console.info(`${this.requestLogSize.name}: sending HEAD request to ${this.url}`);
    try {
      const response = await fetch(this.url, {
        method: 'HEAD'
      });
      this.console.debug(`${this.requestLogSize.name}: got response ${this.debug && JSON.stringify(await this.dumpResponse(response.clone()))}`);
      if (response.ok) {
        if (!response.headers.has('Content-Length')) {
          const actualHeaders = {};
          response.headers.forEach((value, name) => actualHeaders[name] = value);
          throw new MissingContentLengthHeaderError('Server did not respond with a Content-Length header', 'content-length', actualHeaders);
        } else {
          return response.headers.get('Content-Length') * 1;
        }
      } else {
        throw new UnexpectedServerResponseError(`Server responded with non-ok status code: ${response.status} :: ${response.statusText}`, response.status, response.statusText);
      }
    } catch (e) {
      throw new HeadRequestError(`Failed to fetch size of ${this.url} due to unknown network error`, e);
    }
  }

  f() {
    this.poll();
  }

  /**
   * Continuously polls for new log data. It'll emit events as data is recieved or if errors occur
   */
  async poll() {
    try {
      if (this.paused || this.loading) {
        this.console.info(`${this.poll.name}: poller is paused (this.pause: ${this.pause}, this.loading: ${this.loading}). Not tailing log ${this.url}`);
        return;
      }
      this.console.info(`${this.poll.name}: tailing log ${this.url}`);
      this._loading = true;
      const data = await this.getLog();
      this._loading = false;
      this.console.debug(`${this.poll.name}: got log content '${data}'`);
      this.emit(DataAppendedEvent.name, new DataAppendedEvent(data));
    } catch (e) {
      this.emit(e.constructor.name, e);
      this.emit('error', e);
    }

    this._timeout = setTimeout(this.poll.bind(this), this.pollInterval);
  }

  /**
   * Helper method for determining the content of the Range header that'll be sent to the server. This method
   * also sets up some required, internal flags
   */
  async getRange() {
    let range;
    if (!this.logFileSize) {
      this.console.debug(`${this.getLog.name}: no file size yet, meaning it's the first request. Getting the current size of the log`);
      this._logFileSize = await this.requestLogSize();
      /* Get the last 'load' bytes */
      range = '-' + (this.loadBytes > this.logFileSize ? this.logFileSize.toString() : this.loadBytes.toString());
      this._firstLoad = true;
      this._mustGet206 = false;
    } else {
      /* Get the (this.logFileSize - 1)th byte, onwards. */
      /* The "this.logFileSize - 1" deliberately reloads the last byte, which we already
       * have. This is to prevent a 416 "Range unsatisfiable" error: a response
       * of length 1 tells us that the file hasn't changed yet. A 416 shows that
       * the file has been trucnated */
      range = (this.logFileSize - 1).toString() + '-';
      this._firstLoad = false;
      this._mustGet206 = this.logFileSize > 1;
    }

    return range;
  }

  /**
   * Helper method for sending the range request to the server
   * @param {string} range The range to request from the server. Defaults to the entire file
   * @returns {Promise<string,FetchError|MissingHeaderError|Non206ResponseError|FileTruncatedError|UnexpectedServerResponseError>}
   */
  async sendRangeRequest(range='0-') {
    let response;
    try {
      response = await fetch(this.url, {
        headers: {
          Range: `bytes=${range}`,
          'Cache-Control': 'no-cache',
        },
      });
    }
    catch (e) {
      throw new FetchError(`Failed to fetch log ${this.url} due to a network error`, e);
    }

    this.console.debug(`${this.sendRangeRequest.name}: got response from server ${this.debug && JSON.stringify(await this.dumpResponse(response.clone()))}`);
    const xhr = response.clone();
    let contentSize;

    if (xhr.status === 206) {
      const c_r = xhr.headers.get('Content-Range');
      if (!c_r) {
        const actualHeaders = [];
        for (const headerName of xhr.headers.keys()) {
          actualHeaders.push({
            name: headerName,
            value: xhr.headers.get(headerName),
          });
        }
        throw new MissingHeaderError('Missing content-range header', 'content-range', actualHeaders);
      }

      this._logFileSize = this.parseInt2(c_r.split('/')[1]);
      contentSize = this.parseInt2(xhr.headers.get('Content-Length'));
    } else if (xhr.status === 200) {
      if (this._mustGet206) {
        throw new Non206ResponseError('Got non-206 response from server', xhr.status, xhr.statusText);
      }

      contentSize = this.parseInt2(xhr.headers.get('Content-Length'));
      this._logFileSize = contentSize;
    } else if (xhr.status === 416) {
      // the log file changed unexpectedly!
      throw new LogFileTruncatedError(`The file ${this.url} seems to have been truncated from ${this._logFileSize} bytes to ${xhr.headers.get('content-range').split(/\//)[1]}`);
    } else {
      throw new UnexpectedServerResponseError(`Server responded with an unexpected code. Expected 200 or 206 but got ${xhr.status}`, xhr.status, xhr.statusText);
    }

    return xhr.text();
  }

  /**
   * Starts polling for the end of the file. New content is emitted after the initial 30kb are provided
   * @returns {Promise<string[],Error>}
   */
  async getLog() {
    const range = await this.getRange();
    this.console.debug(`${this.getLog.name}: using range ${range} for the request to tail ${this.url}`);
    const data = await this.sendRangeRequest(range);
    this.console.debug(`Found new content for file ${this.url}: ${data} with new size ${this.logFileSize}`);
    if (this._firstLoad && data.length > this.loadBytes) {
      throw new ServerResponseTooLongError(`Server response is too long. Expected ${this.loadBytes} bytes but got ${data.length}`, data.length, data);
    }

    let newContent;
    if (this._firstLoad) {
      /* Clip leading part-line if not the whole file */
      if (data.size < this.logFileSize) {
        const start = data.indexOf('\n');
        newContent = this._logData = data.substring(start + 1);
      } else {
        newContent = this._logData = data;
      }
    } else {
      /* Drop the first byte (see above) */
      this._logData += (newContent = data.substring(1));
    }

    return newContent;
  }

  /**
   * Creates a JSON object of the provided response. This is mostly for debugging purposes
   * @param {Response} response
   * @returns {Promise<object, Error>}
   */
  async dumpResponse(response) {
    const json = {
      status: response.status,
      statusText: response.statusText,
      headers: {},
      redirected: response.redirected,
    };
    const clone = response.clone();
    clone.headers.forEach((value, header) => json.headers[header] = value);
    if (clone.headers.has('content-type')) {
      if (clone.headers.get('content-type').search('json') > -1) {
        json.body = await clone.json();
      } else {
        json.text = await clone.text();
      }
    }
    return json;
  }

  /**
   * @returns {boolean} If true, the log data is currently being fetched
   */
  get loading() {
    return this._loading;
  }

  /**
   * @returns {number} The number of milliseconds to wait between each poll
   */
  get pollInterval() {
    return this._pollInterval || defaultOpts.pollInterval;
  }

  set pollInterval(pollInterval=1000) {
    if (Number.isInteger(pollInterval) && !Number.isNaN(pollInterval) && pollInterval > 0) {
      this._pollInterval = pollInterval;
    } else {
      throw new TypeError(`Attribute 'pollInterval' must be a positive integer, not ${pollInterval}`);
    }
  }

  /**
   * @returns {number} The number of bytes to load on each request. Defaults to 30kb
   */
  get loadBytes() {
    return this._loadBytes || defaultOpts.loadBytes;
  }

  set loadBytes(loadBytes=30 * 1024) {
    if (Number.isInteger(loadBytes) && !Number.isNaN(loadBytes) && loadBytes > 0) {
      this._loadBytes = loadBytes;
    } else {
      throw new TypeError(`Property 'loadBytes' must be a positive integer, not ${loadBytes}`);
    }
  }

  /**
   * @returns {boolean} True if the poller is paused. Default is false
   */
  get paused() {
    return this._paused;
  }

  set paused(paused=false) {
    this._paused = !!paused;
  }

  /**
   * @returns {string} The URL from which the log file is retrieved
   */
  get url() {
    return this._url;
  }

  set url(url='/logs') {
    if (typeof url === 'string') {
      this._url = url;
    } else {
      throw new TypeError(`Property 'url' must be a string, not ${url}`);
    }
  }

  /**
   * @returns {number|null} The size, in bytes, of the log file that was requested. Null if the file hasn't been
   * retrieved or the file size is unknown
   */
  get logFileSize() {
    return this._logFileSize || null;
  }

  /**
   * @returns {string} The information from the logs that's been pulled so far
   */
  get logData() {
    return this._logData;
  }

  /**
   * Wraps the default console methods with a check for the debug flag
   */
  get console() {
    const c = {};
    const self = this;
    ['info', 'debug', 'error', 'warn', 'log'].forEach(level => {
      c[level] = function() {
        if (self.debug) {
          console[level](...arguments);
        }
      };
    });
    return c;
  }

  /**
   * @returns {boolean}
   */
  get debug() {
    return this._debug;
  }

  set debug(debug) {
    this._debug = !!debug;
  }
}

/**
 * Helper method for displaying the stack trace of an error that was caused by another error. The error that caused this error
 * is accessible via the 'causedBy' property in the detail
 */
export class CausedBy extends Error {
  constructor(msg, e) {
    super(msg);
    this.error = e;
  }

  get stack() {
    return `${super.stack}${this.error instanceof Error ? `\n\t Caused by ... ${this.error.stack}` : ''}`;
  }
}

/**
 * An error that's emitted when the length of the file can't be retrieved. This will force the polling to pause
 */
export class FetchContentLengthError extends CausedBy {}

/**
 * An error that's emitted when the fetch of the log file fails due to an unknown network error
 */
export class FetchError extends CausedBy {}

/**
 * An event that's emitted when data has been appended to the log file. The added
 * string are the 'detail' property.
 * @example
 * <code>
 *  logtail.on(DataAppendedEvent.name, evt => {
 *    console.log(`Data appended to file: ${evt.detail}`);
 *  });
 * </code>
 */
export class DataAppendedEvent extends CustomEvent {
  static get name() {
    return 'data-appended';
  }

  constructor(bytes=[]) {
    super(DataAppendedEvent.name, {
      detail: bytes,
    });
  }
}

/**
 * An event that's thrown when the server responds with too many bytes
 */
export class ServerResponseTooLongError extends Error {
  constructor(msg, length, responseText) {
    super(msg);
    this._length = length;
    this._responseText = responseText;
  }

  /**
   * @returns {number} the number of bytes in the respones
   */
  get length() {
    return this._length;
  }

  /**
   * @returns {string} the (likely partial or truncated) response from the server
   */
  get responseText() {
    return this._responseText;
  }
}

/**
 * An event that's dispatched when the server responds with a status that's not 200 or 206
 */
export class UnexpectedServerResponseError extends Error {
  constructor(msg, status, statusText) {
    super(msg);
    this._status = status;
    this._statusText = statusText;
  }

  /**
   * @returns {number} The status code that was returned
   */
  get status() {
    return this._status;
  }
  
  /**
   * @returns {string}
   */
  get statusText() {
    return this._statusText;
  }
}

/**
 * An error that's thrown when a 416 response is recieved. This usually means that
 * the log file has changed in such a way that the requested range is no longer valid (e.g. the
 * file got truncated)
 */
export class LogFileTruncatedError extends Error {}

/**
 * An event that's emitted when the server returns a non-206 code when 206 (partial content) is expected
 */
export class Non206ResponseError extends UnexpectedServerResponseError {}

/**
 * An event that's dispatched when the server doesn't respond with a Content-Range header. The headers that were
 * sent are provided in an array in the detail property as well as the name of the missing header
 * @example
 * <code>
 *   logtail.on(MissingContentRangeHeaderErrorEvent.name, evt => {
 *     evt.detail.headers.forEach(header => {
 *        console.log(`Got header ${header.name}: ${header.value}`);
 *     }); 
 *   });
 * </code>
 */
export class MissingHeaderError extends Error {
  static get name() {
    return 'missing-header';
  }

  constructor(msg, missingHeader, responseHeaders) {
    super(msg);
    this._missingHeader = missingHeader;
    this._responseHeaders = responseHeaders;
  }

  /**
   * @returns {string} The name of the missing header
   */
  get missingHeader() {
    return this._missingHeader;
  }

  /**
   * @returns {{name: string, value: string}[]} The headers returned in the response
   */
  get responseHeaders() {
    return this._responseHeaders;
  }
}

/**
 * An error that's thrown if the server doesn't respond to the HEAD request with a Content-Length
 */
export class MissingContentLengthHeaderError extends MissingHeaderError {}

/**
 * An error that's thrown if the HEAD request fails due to network or other non-application errors
 */
export class HeadRequestError extends CausedBy {}