// Minimal test server - no dependencies except Node.js built-ins
const http = require('http');

const PORT = process.env.PORT || 3001;

console.log('TEST SERVER: Starting on port ' + PORT);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('TEST SERVER: Listening on port ' + PORT);
});

server.on('error', (err) => {
  console.error('TEST SERVER ERROR:', err.message);
});
