// example server for testing the component
const express = require('express');
const app = express();

app.use('/docs', express.static('docs'));
app.use(express.static(process.cwd()));

// start the server
app.listen(9843, () => console.log('Server started. Documentation is at /docs (if the docs have been generated)'));