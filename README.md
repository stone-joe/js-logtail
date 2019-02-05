# LogTail
Library for requesting the last N bytes of a log from any server that properly consumes the Range header and responds
accordingly. This library includes polling and uses events to notify when data is available or when an error occurs.

## Installation
`npm install --save logtail`

## Usage
```javascript
  import LogTail from '/node_modules/logtail/logtail.js';
  const tail = new LogTail({
    url: '/url/to/file',
    loadBytes: 30 * 1024, /* 30KB */
    pollInterval: 1000, /* 1s */
    pause: false,
    debug: false,
  });
  tail.on(UnexpectedServerResponseErrorEvent.name, evt => {
    console.log(evt.detail.status, evt.detail.statusText);
  });
  tail.on(DataAppendedEvent.name, evt => {
    // data that's been appended to the file
    console.log(evt.detail);
  });
  tail.on(FetchErrorEvent.name, evt => {
    // the error that was thrown when the fetch failed
    console.log(evt.detail);
  });
  tail.on(MissingContentRangeErrorEvent.name, evt => {
    // an array of headers that were sent in the response (for debugging)
    evt.detail.forEach(header => console.log(header.name, header.value));
  });
  tail.on(Non206ResponseErrorEvent.name, evt => {
    console.log(evt.detail.status, evt.detail.statusText);
  });
  tail.on(ServerResponseTooLongErrorEvent.name, evt => {
    console.log(evt.detail.length, evt.detail.responseText);
  });
  // or
  tail.on('error', error => { ... });
```

### API
```
const tail = new LogTail({
  url: <string>,
  loadBytes: <number>, /* Default: 30KB */
  pollInterval: <number>, /* Default: 1s */
  pause: false,
  debug: false,
});
```
The constructor takes an object of properties that configures the logger. The only required option is 'url' which points to the file to tail. The 'debug' option is mostly for development, but can be set to 'true' to see log output from this library

#### on(event: string, callback: function, ctx: object) -> null
Adds the `callback` as a listener to `event`. If `ctx` is a not-null or not-undefined object, the callback will be executed within that context; e.g. 
```
callback.apply(ctx)
```
The `callback` will recieve data about the event (usually just a single Event or Error object. See the method docs for more details)

#### off(event: string, callback: function, ctx: object) -> boolean
Removes the `callback` as a listener to `event`. It returns true if successful, false otherwise.

#### f() -> null
Starts the poller. The poller can also be started by calling `poll()`

## Building and Testing
```bash
git clone https://github.com/stone-joe/logtail
cd logtail
npm install
npm test
npm start # starts the server for testing the script and viewing the logs
npm run docs # generates the documentation (served when npm start is called)
```

## License
GNU GPL 3: http://www.gnu.org/licenses/