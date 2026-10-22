import { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import Tool from './Tool.jsx';
import Prompts from './Prompts.jsx';
import Icon from './Icon.jsx';
import { duration } from '../format.js';

function Thinking({ text, live }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <button className="tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="bubble" />
        <span className="tool-name">{live ? 'Thinking' : 'Thought'}</span>
        <span className="tool-sum">{text.split('\n').find((l) => l.trim())?.slice(0, 140)}</span>
      </button>
      {open && <Markdown text={text} className="md thought" />}
    </div>
  );
}

function Item({ item, tools }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="user-msg">
          <span className="caret" aria-hidden>›</span>
          <div>
            {item.text && <div className="user-text">{item.text}</div>}
            {item.images > 0 && <div className="user-images">{item.images} image{item.images > 1 ? 's' : ''} attached</div>}
          </div>
        </div>
      );
    case 'text': return <Markdown text={item.text} />;
    case 'thinking': return <Thinking text={item.text} />;
    case 'tool': return tools[item.id] ? <Tool tool={tools[item.id]} tools={tools} /> : null;
    case 'notice': return <p className="notice">{item.text}{item.url && <> <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a></>}</p>;
    case 'result':
      return item.ok
        ? <p className="turn-end">{duration(item.ms)}{item.cost ? `, $${item.cost.toFixed(2)}` : ''}</p>
        : <p className="turn-end err">{item.error || `Stopped: ${item.subtype}`}</p>;
    default: return null;
  }
}

export default function Transcript({ t, answer, empty }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const onScroll = () => {
    const el = ref.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  const live = t.live ? Object.entries(t.live.blocks).sort(([a], [b]) => a - b) : [];
  return (
    <div className="transcript" ref={ref} onScroll={onScroll}>
      <div className="transcript-inner">
        {t.items.length === 0 && !t.running && empty}
        {t.items.map((item) => <Item key={item.id} item={item} tools={t.tools} />)}
        {live.map(([k, b]) => (b.type === 'thinking' ? <Thinking key={`l${k}`} text={b.text} live /> : <Markdown key={`l${k}`} text={b.text} />))}
        <Prompts permissions={t.permissions} answer={answer} />
        {t.running && !t.permissions.length && <p className="working"><span className="led" />{t.status === 'compacting' ? 'Compacting' : 'Working'}</p>}
      </div>
    </div>
  );
}
