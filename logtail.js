/* Copyright (c) 2012: Daniel Richman. License: GNU GPL 3 */
/* Additional features: Priyesh Patel                     */
/* ES6 update: Joseph Stone                               */
export const ATTR_URL = 'data-url';
export const ATTR_LOAD = 'data-load-bytes';
export const ATTR_POLL = 'data-poll-interval';
export const ATTR_PAUSED = 'data-paused';
export const ATTR_LOADING = 'data-loading';
export const ATTR_LOG_FILE_SIZE = 'data-file-size';
export const defaultOpts = {
  url: '/weblog',
  load: 30 * 1024, /* 30KB */
  poll: 1000, /* 1s */
  loading: false,
  pause: false,
  logData: '',
  logFileSize: 0,
};

export default class LogTail extends HTMLElement {
  /* :-( https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt */
  parseInt2(value) {
    if (!(/^[0-9]+$/.test(value))) throw new TypeError('Invalid integer ' + value);
    const v = Number(value);
    if (isNaN(v)) throw new TypeError('Invalid integer ' + value);
    return v;
  }

  async getLog() {
    if (this.pause || this.loading){
      return;
    }
    this.loading = true;

    let range;
    let firstLoad;
    let mustGet206;
    if (this.logFileSize === 0) {
      /* Get the last 'load' bytes */
      range = '-' + this.load.toString();
      firstLoad = true;
      mustGet206 = false;
    } else {
      /* Get the (this.logFileSize - 1)th byte, onwards. */
      range = (this.logFileSize - 1).toString() + '-';
      firstLoad = false;
      mustGet206 = this.logFileSize > 1;
    }

    /* The "this.logFileSize - 1" deliberately reloads the last byte, which we already
     * have. This is to prevent a 416 "Range unsatisfiable" error: a response
     * of length 1 tells us that the file hasn't changed yet. A 416 shows that
     * the file has been trucnated */

    try {
      const response = await fetch(this.url, {
        headers: {
          Range: "bytes=" + range,
          'Cache-Control': 'no-cache',
        },
      });
      const xhr = response.clone();
      this.loading = false;
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
          this.dispatchEvent(MissingContentRangeHeaderErrorEvent.name, new MissingContentRangeHeaderErrorEvent(actualHeaders));
          return;
        }
  
        this.logFileSize = this.parseInt2(c_r.split('/')[1]);
        contentSize = this.parseInt2(xhr.headers.get('Content-Length'));
      } else if (xhr.status === 200) {
        if (mustGet206) {
          this.dispatchEvent(Non206ResponseErrorEvent.name, new Non206ResponseErrorEvent(xhr.status, xhr.statusText));
          return;
        }
  
        contentSize = this.logFileSize = this.parseInt2(xhr.headers.get('Content-Length'));
      } else {
        this.dispatchEvent(UnexpectedServerResponseErrorEvent.name, new UnexpectedServerResponseErrorEvent(xhr.status, xhr.statusText));
        return;
      }
  
      const data = await xhr.text();
      if (firstLoad && data.length > this.load) {
        this.dispatchEvent(ServerResponseTooLongErrorEvent.name, new ServerResponseTooLongErrorEvent(data.length, data));
        return;
      }
  
      if (firstLoad) {
        /* Clip leading part-line if not the whole file */
        if (contentSize < this.logFileSize) {
          const start = data.indexOf('\n');
          this.logData = data.substring(start + 1);
        } else {
          this.logData = data;
        }
      } else {
        /* Drop the first byte (see above) */
        this.logData += data.substring(1);
  
        if (this.logData.length > this.load) {
          const start = this.logData.indexOf("\n", this.logData.length - this.load);
          this.logData = this.logData.substring(start + 1);
        }
      }
  
      this.dispatchEvent(DataAppendedEvent.name, new DataAppendedEvent(data));
      setTimeout(this.getLog, this.pollInterval);
    } catch (e) {
      this.pause = true;
      this.dispatchEvent(FetchErrorEvent.name, new FetchErrorEvent('Fetching the log file failed. This may be due to a network error. Please try again in a few minutes', e));
    }
  }

  /**
   * @returns {boolean} READONLY. If true, the element is currently loading the next set of bytes
   */
  get loading() {
    return this.hasAttribute(ATTR_LOADING);
  }

  /**
   * @returns {number} The number of milliseconds to wait between each poll
   */
  get pollInterval() {
    return this.hasAttribute(ATTR_POLL) ? this.getAttribute(ATTR_POLL) * 1 : 1000;
  }

  set pollInterval(pollInterval=1000) {
    if (Number.isInteger(pollInterval) && !Number.isNaN(pollInterval) && pollInterval > 0) {
      this.setAttribute(ATTR_POLL, pollInterval);
    } else {
      throw new TypeError(`Attribute '${ATTR_POLL}' must be a positive integer, not ${pollInterval}`);
    }
  }

  /**
   * @returns {number} The number of bytes to load on each request. Defaults to 30kb
   */
  get loadBytes() {
    return this.getAttribute(ATTR_LOAD);
  }

  set loadBytes(loadBytes=30 * 1024) {
    if (Number.isInteger(loadBytes) && !Number.isNaN(loadBytes) && loadBytes > 0) {
      this.setAttribute(ATTR_LOAD, loadBytes);
    } else {
      throw new TypeError(`Attribute '${ATTR_LOAD}' must be a positive integer, not ${loadBytes}`);
    }
  }

  /**
   * @returns {boolean} True if the poller is paused. Default is false
   */
  get paused() {
    return this.hasAttribute(ATTR_PAUSED);
  }

  set paused(paused=false) {
    if (paused) {
      this.setAttribute(ATTR_PAUSED, '');
    } else {
      this.removeAttribute(ATTR_PAUSED);
    }
  }

  /**
   * @returns {string} The URL from which the log file is retrieved
   */
  get url() {
    return this.getAttribute(ATTR_URL);
  }

  set url(url='/weblog') {
    if (typeof url === 'string') {
      this.setAttribute(ATTR_URL, url);
    } else {
      throw new TypeError(`Attribute '${ATTR_URL}' must be a string, not ${url}`);
    }
  }

  /**
   * @returns {number|null} The size, in bytes, of the log file that was requested. Null if the file hasn't been
   * retrieved or the file size is unknown
   */
  get logFileSize() {
    return this.hasAttribute(ATTR_LOG_FILE_SIZE) ? this.getAttribute(ATTR_LOG_FILE_SIZE) * 1 : null;
  }
}

/**
 * An event that's emitted when the fetch of the log file fails due to an unknown network error. The
 * 'detail' is the error object that was thrown
 */
export class FetchErrorEvent extends CustomEvent {
  static get name() {
    return 'fetch-error';
  }

  constructor(e) {
    super(FetchErrorEvent.name, {
      bubbles: true,
      composed: true,
      detail: e,
    });
  }
}

/**
 * An event that's emitted when data has been appended to the log file. The added
 * string are the 'detail' property.
 * @example
 * <code>
 *  logtail.addEventListener(DataAppendedEvent.name, evt => {
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
      bubbles: true,
      composed: true,
      detail: bytes,
    });
  }
}

/**
 * An event that's thrown when the server responds with too many bytes. The detail property has two properties:
 * - length (number) - the number of bytes in the respones
 * - responseText (string) - the (likely partial or truncated) response from the server
 */
export class ServerResponseTooLongErrorEvent extends CustomEvent {
  static get name() {
    return 'server-response-too-long';
  }

  constructor(length, responseText) {
    super(ServerResponseTooLongErrorEvent.name, {
      bubbles: true,
      composed: true,
      detail: {
        length,
        responseText,
      },
    });
  }
}

/**
 * An event that's dispatched when the server responds with a status that's not 200 or 206. The status and statusText
 * are provided in the detail as 'status' and 'statusText'
 */
export class UnexpectedServerResponseErrorEvent extends CustomEvent {
  static get name() {
    return 'unexpected-response';
  }

  constructor(status, statusText) {
    super(UnexpectedServerResponseErrorEvent.name, {
      bubbles: true,
      composed: true,
      detail: {
        status,
        statusText,
      },
    });
  }
}

/**
 * An event that's emitted when the server returns a non-206 code when 206 (partial content) is expected. The
 * actual status and statusText are provided in the detail property as 'status' and 'statusText'.
 */
export class Non206ResponseErrorEvent extends CustomEvent {
  static get name() {
    return 'response-non-206';
  }

  constructor(status, statusText) {
    super(Non206ResponseErrorEvent.name, {
      bubbles: true,
      composed: true,
      detail: {
        status,
        statusText,
      },
    });
  }
}

/**
 * An event that's dispatched when the server doesn't respond with a Content-Range header. The headers that were
 * sent are provided in an array as the detail property.
 * @example
 * <code>
 *   document.querySelector('tail-log').addEventListener(MissingContentRangeHeaderErrorEvent.name, evt => {
 *     evt.detail.forEach(header => {
 *        console.log(`Got header ${header.name}: ${header.value}`);
 *     }); 
 *   });
 * </code>
 */
export class MissingContentRangeHeaderErrorEvent extends CustomEvent {
  static get name() {
    return 'missing-range-header';
  }

  constructor(headers) {
    super(MissingContentRangeHeaderErrorEvent.name, {
      bubbles: true,
      composed: true,
      detail: headers,
    });
  }
}

window.customElements.define('tail-log', LogTail);