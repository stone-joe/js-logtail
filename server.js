// example server for testing the component
const fs = require('fs');
const express = require('express');
const app = express();

function rangeHeaderMiddleware(req, res, next) {
  const rangeHeader = req.get('Range');
  if (rangeHeader) {
    const unitMatcher = rangeHeader.match(/((.*?)=)/);
    if (!unitMatcher) {
      console.error(`Missing unit in Range header: ${rangeHeader}`);
      return res.status(416).end();
    } else {
      const rangeData = {
        unit: unitMatcher[1],
        ranges: [],
      };
      rangeHeader.split(',').forEach(range => {
        const matcher = range.match(/(\d*)-(\d*)/);
        const data = {};
        if (matcher) {
          data.start = matcher[1] * 1;
          data.end = matcher[2] * 1 || null;
          data.limit = data.end - data.start;
          rangeData.ranges.push(data);
        } else {
          console.warn(`Ignoring unparsable range ${range}`);
        }
      });
      req.range = rangeData;
      /**
       * Helper method for setting all required headers before sending the content
       */
      res.sendRange = function(content, size) {
        if (rangeData.ranges.length > 1) {
          res.status(405).send('Multipart range response not yet implemented');
        } else {
          res.status(206);
          res.set('Content-Range', `${rangeData.ranges[0].start}-${rangeData.ranges[0].end}/${size}`);
          res.set('Content-Length', content.length);
          res.send(content);
        }
      };
      next();
    }
  } else {
    next();
  }
}

// basic routing
app.head('/logs', (req, res) => {
  try {
    const query = req.query;
    res.set('Accept-Ranges', 'bytes');
    if (query.file) {
      const file = `logs/${query.file}`;
      if (fs.existsSync(file)) {
        const stat = fs.statSync(file);
        console.log(`Sending content-length header for file ${file}: ${stat.size}`);
        res.set('Content-Length', stat.size);
      }
    }
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});
app.get('/logs', (req, res, next) => {
  try {
    const query = req.query;
    if (query.file) {
      rangeHeaderMiddleware(req, res, () => {
        const file = `logs/${query.file}`;
        let fd;
        if (fs.existsSync(file)) {
          try {
            console.log(req.range);
            fd = fs.openSync(file, 'r');
            const stat = fs.statSync(file);
            const range = req.range.ranges[0];
            let limit = range.end - range.start;
            if (range.end >= stat.size) {
              console.log(`Requested limit of ${range.end - range.start} created a range larger than the end of the file. It's being truncated to ${limit} because the offset is ${range.start} with a file size of ${stat.size}`);
              return res.status(416).end();
            }
            console.log(limit);
            const buffer = new Buffer(Array(limit).fill(0));
            console.log(`Attempting to read ${limit} bytes starting at ${range.start} from file ${file}`);
            fs.readSync(fd, buffer, 0, buffer.length, range.start);
            return res.sendRange(buffer, stat.size);
          } finally {
            if (fd) {
              fs.closeSync(fd);
            }
          }
        } else {
          console.log(`File ${file} cannot be found`);
          return res.status(404).send();
        }
      });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send();
  }

  console.log('Not sending log information for non-log request');
  next();
});

app.use(express.static(process.cwd()));

// start the server
app.listen(9843, () => console.log('Server is listening...'));