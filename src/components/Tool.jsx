import { useState } from 'react';
import { shortPath, tidyPaths } from '../format.js';
import Icon from './Icon.jsx';

const TOOL_ICON = {
  Bash: 'shell', Read: 'eye', Edit: 'pencil', MultiEdit: 'pencil', NotebookEdit: 'pencil', Write: 'page-plus',
  Glob: 'magnifier', Grep: 'magnifier', ToolSearch: 'magnifier', WebFetch: 'download', WebSearch: 'globe',
  Agent: 'robot', Task: 'robot', TodoWrite: 'checklist', TaskCreate: 'checklist', TaskUpdate: 'checklist', Skill: 'spark',
};

export function toolIcon(name) {
  if (name === 'mcp__clawdeck__browser_navigate') return 'browser';
  if (name.startsWith('mcp__clawdeck__')) return 'cursor';
  if (name.startsWith('mcp__')) return 'plug';
  return TOOL_ICON[name] || 'wrench';
}

const BROWSER = {
  browser_navigate: 'Open page', browser_snapshot: 'Read page', browser_click: 'Click', browser_type: 'Type',
  browser_press_key: 'Press key', browser_scroll: 'Scroll', browser_back: 'Go back', browser_screenshot: 'Look at page',
};

export function toolLabel(name) {
  const b = name.match(/^mcp__clawdeck__(.+)$/);
  if (b) return { name: BROWSER[b[1]] || b[1], server: 'Browser' };
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  if (m) return { name: m[2], server: m[1].replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/, '') };
  return { name };
}

export function toolSummary(name, input = {}) {
  if (name.startsWith('mcp__clawdeck__')) {
    if (input.text != null) return `"${input.text}" into ${input.element}${input.submit ? ', then Enter' : ''}`;
    return input.url || input.element || input.key || (input.pixels != null ? `${input.pixels} px` : '');
  }
  switch (name) {
    case 'Bash': return tidyPaths(input.command);
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return shortPath(input.file_path || input.notebook_path);
    case 'Glob': return input.pattern + (input.path ? `  in ${shortPath(input.path)}` : '');
    case 'Grep': return `${input.pattern}${input.path ? `  in ${shortPath(input.path)}` : ''}`;
    case 'WebFetch': return input.url;
    case 'WebSearch': return input.query;
    case 'Agent': case 'Task': return `${input.subagent_type || 'agent'}: ${input.description || ''}`;
    case 'Skill': return input.skill;
    case 'TodoWrite': return `${(input.todos || []).length} items`;
    case 'ToolSearch': return input.query;
    default: {
      const v = Object.values(input).find((x) => typeof x === 'string');
      return v ? v.slice(0, 160) : '';
    }
  }
}

// Sources from the structured output, or from the "Links: [...]" line in saved sessions.
export function searchSources(tool) {
  let list = [];
  if (tool.structured?.results) {
    list = tool.structured.results.flatMap((r) => (typeof r === 'object' && r.content) || []);
  } else {
    const text = resultText(tool.result);
    const start = text.indexOf('Links: [') + 7;
    let end = start > 6 ? text.indexOf('}]', start) : -1;
    while (end > 0) {
      try { list = JSON.parse(text.slice(start, end + 2)); break; } catch { end = text.indexOf('}]', end + 2); }
    }
  }
  const seen = new Set();
  return list.filter((x) => x?.url && !seen.has(x.url) && seen.add(x.url));
}

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

const SHOWN = 4;

function WebSearch({ tool }) {
  const [all, setAll] = useState(false);
  const sources = searchSources(tool);
  const denied = tool.status === 'error';
  const verb = tool.status === 'running' ? 'Searching the web' : denied ? 'Web search blocked' : 'Searched the web';
  return (
    <div className={`tool web ${tool.status}`}>
      <div className="tool-row static">
        <span className="led" />
        <Icon name="globe" />
        <span className="tool-name">{verb}</span>
        <span className="tool-sum">{tool.input.query}</span>
        {sources.length > 0 && <span className="tool-sub">{sources.length} sources</span>}
      </div>
      {denied && (
        <p className="tool-note">
          {resultText(tool.result).includes('Web search is off in Clawdeck') ? 'Web search is off. Turn it on with the Web search switch below the message box.' : resultText(tool.result)}
        </p>
      )}
      {sources.length > 0 && (
        <ul className="sources">
          {(all ? sources : sources.slice(0, SHOWN)).map((src) => (
            <li key={src.url}>
              <a href={src.url} target="_blank" rel="noreferrer" title={src.url}>
                <span className="src-domain">{domain(src.url)}</span>
                <span className="src-title">{src.title}</span>
              </a>
            </li>
          ))}
          {!all && sources.length > SHOWN && (
            <li><button className="link" onClick={() => setAll(true)}>Show {sources.length - SHOWN} more sources</button></li>
          )}
        </ul>
      )}
    </div>
  );
}

function resultText(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
  return JSON.stringify(result, null, 2);
}

export function Diff({ before = '', after = '' }) {
  return (
    <pre className="diff">
      {before.split('\n').map((l, i) => <div key={`d${i}`} className="del">- {l}</div>)}
      {after.split('\n').map((l, i) => <div key={`a${i}`} className="add">+ {l}</div>)}
    </pre>
  );
}

export function ToolInput({ name, input }) {
  if (name === 'Edit') return <Diff before={input.old_string} after={input.new_string} />;
  if (name === 'Write') return <pre className="out">{(input.content || '').slice(0, 6000)}</pre>;
  if (name === 'Bash') return <pre className="out cmd">{input.command}</pre>;
  if (name === 'WebSearch') return <p className="tool-note">Search the web for “{input.query}”</p>;
  if (name === 'WebFetch') return <p className="tool-note">Open {input.url}</p>;
  if (name === 'TodoWrite') {
    return (
      <ul className="todos">
        {(input.todos || []).map((t, i) => <li key={i} className={t.status}>{t.content}</li>)}
      </ul>
    );
  }
  return <pre className="out">{JSON.stringify(input, null, 2)}</pre>;
}

const LIMIT = 5000;

export default function Tool({ tool, tools }) {
  if (tool.name === 'WebSearch') return <WebSearch tool={tool} />;
  return <GenericTool tool={tool} tools={tools} />;
}

function GenericTool({ tool, tools }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const label = toolLabel(tool.name);
  const out = resultText(tool.result);
  const sub = tool.children.length;
  return (
    <div className={`tool ${tool.status}`}>
      <button className="tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="led" />
        <Icon name={toolIcon(tool.name)} />
        <span className="tool-name">{label.name}</span>
        {label.server && <span className="tool-server">{label.server}</span>}
        <span className="tool-sum">{toolSummary(tool.name, tool.input)}</span>
        {sub > 0 && <span className="tool-sub">{sub} steps</span>}
      </button>
      {open && (
        <div className="tool-detail">
          <ToolInput name={tool.name} input={tool.input} />
          {sub > 0 && (
            <ul className="substeps">
              {tool.children.map((id) => tools[id] && (
                <li key={id} className={tools[id].status}>
                  <span className="led" /> {toolLabel(tools[id].name).name} <span className="tool-sum">{toolSummary(tools[id].name, tools[id].input)}</span>
                </li>
              ))}
            </ul>
          )}
          {out && (
            <>
              <pre className={`out result ${tool.status === 'error' ? 'err' : ''}`}>{full ? out : out.slice(0, LIMIT)}</pre>
              {out.length > LIMIT && !full && <button className="link" onClick={() => setFull(true)}>Show all {out.length.toLocaleString()} characters</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
