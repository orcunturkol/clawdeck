import { useMemo } from 'react';
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
      return `<pre class="code"><code class="hljs">${html}</code></pre>`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noreferrer'); }
});

export default function Markdown({ text, className = 'md' }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '')), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
