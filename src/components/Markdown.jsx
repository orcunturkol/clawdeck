import { useMemo } from 'react';
import { copyText } from '../clipboard.js';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      const html = language ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value;
      return `<div class="copy-wrap"><pre class="code"><code class="hljs">${html}</code></pre><button type="button" class="copy-btn" data-testid="copy-button" aria-label="Copy code">Copy</button></div>`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noreferrer'); }
});

// The buttons are plain HTML inside the sanitized output; one handler copies the text of the block next to the clicked button.
async function onClick(e) {
  const btn = e.target.closest?.('button.copy-btn');
  const code = btn?.parentElement?.querySelector('pre');
  if (!code || !(await copyText(code.textContent))) return;
  btn.textContent = 'Copied';
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1500);
}

export default function Markdown({ text, className = 'md' }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '')), [text]);
  return <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
