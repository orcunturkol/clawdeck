import { WebContentsView, session as electronSession } from 'electron';

const PARTITION = 'persist:clawdeck-browser';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: tags visible controls with refs and returns them with the page text.
const SNAPSHOT = `(() => {
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=menuitem], [role=option], [role=combobox], [role=textbox], [contenteditable=true], [onclick]';
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  document.querySelectorAll('[data-cd-ref]').forEach((e) => e.removeAttribute('data-cd-ref'));
  const lines = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (n >= 300 || !visible(el)) continue;
    const ref = 'e' + (++n);
    el.setAttribute('data-cd-ref', ref);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (['checkbox', 'radio', 'submit', 'button'].includes(type) ? type : 'textbox') : tag === 'textarea' ? 'textbox' : tag);
    let line = '[' + ref + '] ' + role + ' "' + label(el) + '"';
    if (tag === 'input' || tag === 'textarea') line += ' value="' + String(el.value || '').slice(0, 60) + '"';
    if (el.checked) line += ' checked';
    if (tag === 'a') line += ' -> ' + (el.getAttribute('href') || '').slice(0, 100);
    lines.push(line);
  }
  const text = document.body ? document.body.innerText.replace(/\\n{3,}/g, '\\n\\n').slice(0, 12000) : '';
  return { url: location.href, title: document.title, elements: lines.join('\\n'), text };
})()`;

// Runs in the page: scrolls the element into view, flashes it, returns its center.
const LOCATE = (ref) => `(() => {
  const el = document.querySelector('[data-cd-ref="${ref}"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const old = el.style.outline;
  el.style.outline = '3px solid #e8a33d';
  setTimeout(() => { el.style.outline = old; }, 900);
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const SELECT_ALL = (ref) => `(() => {
  const el = document.querySelector('[data-cd-ref="${ref}"]');
  if (!el) return;
  el.focus();
  if (typeof el.select === 'function') el.select(); else document.execCommand('selectAll');
})()`;

// One browser view, shown where the renderer's pane is.
export class BrowserPane {
  constructor(win, emit) {
    this.win = win;
    this.emit = emit;
    this.view = null;
    this.bounds = null;
    this.shown = false; // the pane has a place on screen
    this.attached = false; // the native view is in the window
    this.hasPage = false;
    this.control = 'claude';
    this.busy = false;
    this.waiters = [];
  }

  get wc() { return this.ensureView().webContents; }

  ensureView() {
    if (this.view) return this.view;
    const ses = electronSession.fromPartition(PARTITION);
    // Some sites refuse sign-in when the user agent names Electron.
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ clawdeck\/\S+/i, ''));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    this.view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.view.setBackgroundColor('#ffffff');
    const wc = this.view.webContents;
    wc.setWindowOpenHandler(({ url }) => { wc.loadURL(url); return { action: 'deny' }; });
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      wc.on(ev, () => this.sendState());
    }
    wc.on('did-start-navigation', () => { this.hasPage = true; this.sync(); });
    return this.view;
  }

  state() {
    const wc = this.view?.webContents;
    return {
      url: wc?.getURL() || '', title: wc?.getTitle() || '', loading: wc?.isLoading() || false,
      canGoBack: wc?.navigationHistory.canGoBack() || false, canGoForward: wc?.navigationHistory.canGoForward() || false,
      control: this.control, busy: this.busy,
    };
  }

  sendState() { this.emit({ type: 'browser-state', state: this.state() }); }

  // Show the native view only when the pane is open and a page exists, so the empty pane keeps its hint.
  sync() {
    const want = this.shown && this.hasPage;
    if (want && !this.attached) this.win.contentView.addChildView(this.view);
    if (!want && this.attached) this.win.contentView.removeChildView(this.view);
    this.attached = want;
    if (want) this.view.setBounds(this.bounds);
  }

  setBounds(b) {
    this.bounds = b;
    this.ensureView();
    this.shown = true;
    this.sync();
    this.waiters.splice(0).forEach((r) => r());
    this.sendState();
  }

  hide() {
    this.shown = false;
    this.sync();
  }

  // Asks the renderer to open the pane and waits until it has a place on screen.
  async ensureShown() {
    if (this.shown) return;
    this.emit({ type: 'browser-open' });
    await Promise.race([new Promise((r) => this.waiters.push(r)), sleep(2000)]);
  }

  setControl(who) {
    this.control = who;
    this.sendState();
  }

  async settle() {
    await sleep(400);
    const wc = this.wc;
    if (wc.isLoading()) await Promise.race([new Promise((r) => wc.once('did-stop-loading', r)), sleep(15000)]);
    await sleep(300);
  }

  async navigate(url) {
    const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    await this.wc.loadURL(target).catch(() => {});
    await this.settle();
  }

  snapshot() { return this.wc.executeJavaScript(SNAPSHOT); }

  async click(ref) {
    const p = await this.wc.executeJavaScript(LOCATE(ref));
    if (!p) throw new Error(`No element ${ref}. Take a new snapshot first.`);
    await sleep(150);
    this.wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
    this.wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    this.wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await this.settle();
  }

  async type(ref, text, submit) {
    await this.click(ref);
    await this.wc.executeJavaScript(SELECT_ALL(ref));
    await this.wc.insertText(text);
    if (submit) await this.key('Enter');
    else await sleep(200);
  }

  async key(key) {
    this.wc.sendInputEvent({ type: 'keyDown', keyCode: key });
    if (key === 'Enter') this.wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    this.wc.sendInputEvent({ type: 'keyUp', keyCode: key });
    await this.settle();
  }

  async scroll(dy) {
    const b = this.bounds || { width: 800, height: 600 };
    this.wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(b.width / 2), y: Math.round(b.height / 2), deltaX: 0, deltaY: -dy });
    await sleep(500);
  }

  async back() { if (this.wc.navigationHistory.canGoBack()) { this.wc.navigationHistory.goBack(); await this.settle(); } }
  async forward() { if (this.wc.navigationHistory.canGoForward()) { this.wc.navigationHistory.goForward(); await this.settle(); } }
  reload() { this.wc.isLoading() ? this.wc.stop() : this.wc.reload(); }

  async screenshot() {
    let img = await this.wc.capturePage();
    if (img.getSize().width > 1280) img = img.resize({ width: 1280 });
    return img.toPNG().toString('base64');
  }
}
