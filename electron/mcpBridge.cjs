// Antigravity starts MCP servers as programs. This one carries the MCP stdio stream to Clawdeck's
// browser pane tools over a local pipe. The first line proves that Clawdeck started it.
const net = require('node:net');

const sock = net.connect(process.env.CLAWDECK_PIPE, () => {
  sock.write(`${process.env.CLAWDECK_TOKEN}\n`);
  process.stdin.pipe(sock);
  sock.pipe(process.stdout);
});
sock.on('close', () => process.exit(0));
sock.on('error', () => process.exit(1));
process.stdin.on('end', () => sock.end());
