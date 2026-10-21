import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const REF = z.string().regex(/^e\d+$/).describe('Element ref from browser_snapshot, for example e12');
const ELEMENT = z.string().describe('Short human description of the element, shown to the user');
const KEYS = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Esc: 'Escape' };

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

function pageText(s, withText = true) {
  return [
    `URL: ${s.url}`, `Title: ${s.title}`, '',
    'Elements (use the ref to click or type):', s.elements || '(none)',
    ...(withText ? ['', 'Page text:', s.text] : []),
  ].join('\n');
}

// Claude's tools for the visible browser pane. One server per session.
export function browserServer(pane) {
  const run = (fn) => async (args) => {
    if (pane.control === 'user') {
      return fail('The user has taken control of the browser. Stop using the browser and ask the user to tell you when they are done.');
    }
    pane.busy = true;
    pane.sendState();
    try {
      await pane.ensureShown();
      return await fn(args);
    } catch (e) {
      return fail(e.message);
    } finally {
      pane.busy = false;
      pane.sendState();
    }
  };
  const always = { alwaysLoad: true };
  const read = { ...always, annotations: { readOnlyHint: true } };

  return createSdkMcpServer({
    name: 'clawdeck',
    version: '0.1.0',
    instructions: 'These tools drive the browser pane in the Clawdeck window. The user watches every step and can sign in or take over. Use them when the user asks you to browse, use a website, fill a form or look at a page live. Call browser_snapshot to get element refs before you click or type.',
    tools: [
      tool('browser_navigate', 'Open a URL in the browser pane that the user can see.', { url: z.string() },
        run(async ({ url }) => { await pane.navigate(url); return text(pageText(await pane.snapshot())); }), always),
      tool('browser_snapshot', 'Read the current page: URL, title, clickable elements with refs, and page text.', {},
        run(async () => text(pageText(await pane.snapshot()))), read),
      tool('browser_click', 'Click an element in the browser pane.', { ref: REF, element: ELEMENT },
        run(async ({ ref }) => { await pane.click(ref); return text(pageText(await pane.snapshot(), false)); }), always),
      tool('browser_type', 'Type text into a field in the browser pane. The old value is replaced.', { ref: REF, element: ELEMENT, text: z.string(), submit: z.boolean().optional().describe('Press Enter after typing') },
        run(async ({ ref, text: t, submit }) => { await pane.type(ref, t, submit); return text(pageText(await pane.snapshot(), false)); }), always),
      tool('browser_press_key', 'Press a key in the browser pane, for example Enter, Tab, Escape, ArrowDown, PageDown.', { key: z.string() },
        run(async ({ key }) => { await pane.key(KEYS[key] || key); return text(pageText(await pane.snapshot(), false)); }), always),
      tool('browser_scroll', 'Scroll the page in the browser pane. Positive pixels scroll down.', { pixels: z.number() },
        run(async ({ pixels }) => { await pane.scroll(pixels); return text('Scrolled.'); }), always),
      tool('browser_back', 'Go back one page in the browser pane.', {},
        run(async () => { await pane.back(); return text(pageText(await pane.snapshot(), false)); }), always),
      tool('browser_screenshot', 'Take a picture of what the browser pane shows now.', {},
        run(async () => ({ content: [{ type: 'image', data: await pane.screenshot(), mimeType: 'image/png' }] })), read),
    ],
  });
}
