import { useState } from 'react';
import { ToolInput, toolLabel } from './Tool.jsx';
import Markdown from './Markdown.jsx';

function Question({ q, value, onChange }) {
  const [other, setOther] = useState('');
  const picked = value || [];
  const toggle = (label) => {
    if (q.multiSelect) onChange(picked.includes(label) ? picked.filter((x) => x !== label) : [...picked, label]);
    else onChange([label]);
  };
  return (
    <fieldset className="question">
      <legend>{q.question}</legend>
      {q.options.map((o) => (
        <label key={o.label} className={`option ${picked.includes(o.label) ? 'on' : ''}`}>
          <input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.question} checked={picked.includes(o.label)} onChange={() => toggle(o.label)} />
          <span>
            <strong>{o.label}</strong>
            {o.description && <span className="option-desc">{o.description}</span>}
          </span>
        </label>
      ))}
      <input
        className="other" placeholder="Other answer" value={other}
        onChange={(e) => { setOther(e.target.value); onChange(e.target.value ? [e.target.value] : []); }}
      />
    </fieldset>
  );
}

function AskUser({ p, answer }) {
  const [answers, setAnswers] = useState({});
  const questions = p.input.questions || [];
  const ready = questions.every((q) => answers[q.question]?.length);
  const send = () => {
    const out = Object.fromEntries(questions.map((q) => [q.question, answers[q.question].join(', ')]));
    answer(p.id, { allow: true, updatedInput: { ...p.input, answers: out } });
  };
  return (
    <div className="prompt">
      <p className="prompt-title">Claude has {questions.length > 1 ? 'some questions' : 'a question'}</p>
      {questions.map((q) => (
        <Question key={q.question} q={q} value={answers[q.question]} onChange={(v) => setAnswers({ ...answers, [q.question]: v })} />
      ))}
      <div className="prompt-actions">
        <button className="primary" disabled={!ready} onClick={send}>Send answers</button>
        <button onClick={() => answer(p.id, { allow: false, message: 'The user skipped the questions.' })}>Skip</button>
      </div>
    </div>
  );
}

function Plan({ p, answer }) {
  return (
    <div className="prompt">
      <p className="prompt-title">Claude's plan is ready</p>
      <div className="plan"><Markdown text={p.input.plan || 'Claude is ready to leave plan mode and start work.'} /></div>
      <div className="prompt-actions">
        <button className="primary" onClick={() => answer(p.id, { allow: true })}>Approve plan</button>
        <button onClick={() => answer(p.id, { allow: false, message: 'The user wants to keep planning.' })}>Keep planning</button>
      </div>
    </div>
  );
}

function Permission({ p, answer }) {
  const label = toolLabel(p.toolName);
  return (
    <div className="prompt">
      <p className="prompt-title">{p.title || `Claude wants to use ${label.name}${label.server ? ` from ${label.server}` : ''}`}</p>
      {p.decisionReason && <p className="prompt-reason">{p.decisionReason}</p>}
      {p.blockedPath && <p className="prompt-reason">Path outside the allowed folders: {p.blockedPath}</p>}
      <div className="prompt-body"><ToolInput name={p.toolName} input={p.input} /></div>
      <div className="prompt-actions">
        <button className="primary" onClick={() => answer(p.id, { allow: true })}>Allow</button>
        {p.canAlwaysAllow && <button onClick={() => answer(p.id, { allow: true, always: true })}>Always allow</button>}
        <button onClick={() => answer(p.id, { allow: false })}>Deny</button>
      </div>
    </div>
  );
}

export default function Prompts({ permissions, answer }) {
  return permissions.map((p) => {
    if (p.toolName === 'AskUserQuestion') return <AskUser key={p.id} p={p} answer={answer} />;
    if (p.toolName === 'ExitPlanMode') return <Plan key={p.id} p={p} answer={answer} />;
    return <Permission key={p.id} p={p} answer={answer} />;
  });
}
