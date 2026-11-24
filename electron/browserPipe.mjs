import net from 'node:net';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { browserServer } from './browserTools.mjs';
import { IS_WIN } from './env.mjs';

// A packaged app keeps the script unpacked (see asarUnpack), so a plain Node process can read it.
const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcpBridge.cjs').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

// The browser pane tools for Antigravity: a local pipe (no network port) and a random token.
// Returns the ACP stdio MCP server entry that starts the bridge.
export function browserPipe(pane, dataDir) {
  const token = randomBytes(24).toString('hex');
  const pipe = IS_WIN ? `\\\\.\\pipe\\clawdeck-${randomBytes(8).toString('hex')}` : path.join(dataDir, `browser-${process.pid}.sock`);
  if (!IS_WIN) rmSync(pipe, { force: true });
  const server = net.createServer((sock) => {
    let head = Buffer.alloc(0);
    const onData = async (d) => {
      head = Buffer.concat([head, d]);
      const nl = head.indexOf(10);
      if (nl < 0) { if (head.length > 200) sock.destroy(); return; }
      sock.off('data', onData);
      sock.pause();
      const got = head.subarray(0, nl);
      const want = Buffer.from(token);
      if (got.length !== want.length || !timingSafeEqual(got, want)) { sock.destroy(); return; }
      if (head.length > nl + 1) sock.unshift(head.subarray(nl + 1));
      // One MCP server per connection: each chat starts its own bridge.
      const mcp = browserServer(pane).instance;
      sock.on('close', () => mcp.close().catch(() => {}));
      await mcp.connect(new StdioServerTransport(sock, sock));
      sock.resume(); // a stream paused by hand stays paused when the transport adds its listener
    };
    sock.on('data', onData);
    sock.on('error', () => {});
  });
  server.listen(pipe);
  return {
    name: 'clawdeck',
    command: process.execPath,
    args: [BRIDGE],
    env: [
      { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
      { name: 'CLAWDECK_PIPE', value: pipe },
      { name: 'CLAWDECK_TOKEN', value: token },
    ],
  };
}
