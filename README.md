# Custom Element <tail-log>

Very simple custom element for subscribing to changes in a file. This requires a server that properly consumes Content-Range headers (which should be most servers like lighthttp, nginx, etc).

## Why a custom element and not a JS library?
To me, the HTML is more readable and is clearer where and how it's used. Plus, the event system is built into components and working with events was easier than working with Promises.

## Installation
`npm install --save logtail`

## Usage
```html
<div id="my-awesome-log-viewer">
  <tail-log data-url="/path/to/log"></tail-log>
  <div id="log-contents"></div>
</div>

<script type="module">
  import * from '/node_modules/logtail/logtail.js";
  const logtail = document.querySelector('tail-log');
  logtail.addEventListener(UnexpectedServerResponseErrorEvent.name, evt => {
    console.log(evt.detail.status, evt.detail.statusText);
  });
  logtail.addEventListener(DataAppendedEvent.name, evt => {
    // data that's been appended to the file
    console.log(evt.detail);
  });
  logtail.addEventListener(FetchErrorEvent.name, evt => {
    // the error that was thrown when the fetch failed
    console.log(evt.detail);
  });
  logtail.addEventListener(MissingContentRangeErrorEvent.name, evt => {
    // an array of headers that were sent in the response (for debugging)
    evt.detail.forEach(header => console.log(header.name, header.value));
  });
  logtail.addEventListener(Non206ResponseErrorEvent.name, evt => {
    console.log(evt.detail.status, evt.detail.statusText);
  });
  logtail.addEventListener(ServerResponseTooLongErrorEvent.name, evt => {
    console.log(evt.detail.length, evt.detail.responseText);
  });
</script>
```

## Building and Testing
```
git clone https://github.com/stone-joe/logtail
cd logtail
npm install
npm test
```