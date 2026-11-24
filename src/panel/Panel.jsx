import SessionSection from './SessionSection.jsx';
import AccountsSection from './AccountsSection.jsx';
import UsageSection from './UsageSection.jsx';
import McpSection from './McpSection.jsx';
import PluginsSection from './PluginsSection.jsx';
import MemorySection from './MemorySection.jsx';
import ClaudeCodeSection from './ClaudeCodeSection.jsx';
import GitSection from './GitSection.jsx';
import { SkillsSection, CommandsSection, AgentsSection, HooksSection } from './ListSections.jsx';
import Section from './Section.jsx';

// An Antigravity chat: the parts of the panel that Antigravity has. Accounts, plan limits, MCP and plugins
// belong to Claude Code; agy keeps its own.
function AgyPanel(props) {
  const { init, onInsert } = props;
  return (
    <aside className="panel" aria-label="Antigravity control panel">
      <SessionSection {...props} />
      <Section id="antigravity" title="Antigravity" icon="person" summary={init?.account?.subscriptionType || ''} defaultOpen>
        <dl className="facts">
          <dt>Login</dt><dd>Google login of agy{init?.account?.subscriptionType ? `, ${init.account.subscriptionType}` : ''}</dd>
          {init?.agy_version && <><dt>agy</dt><dd>{init.agy_version}</dd></>}
        </dl>
        <p className="muted">Account switching and plan limits are not available for Antigravity chats.</p>
        <p className="muted">Antigravity keeps its own MCP servers, plugins and rules. Manage them with <code>agy mcp</code> and <code>agy plugin</code> in a terminal. The Clawdeck browser pane is on.</p>
      </Section>
      <SkillsSection commands={init?.commands || []} onInsert={onInsert} />
      <GitSection />
    </aside>
  );
}

export default function Panel(props) {
  if (props.provider === 'antigravity') return <AgyPanel {...props} />;
  const { init, cwd, rev, turns, liveLimits, onInsert, onPluginsChanged } = props;
  const ready = Boolean(init);
  const commands = init?.commands || [];
  return (
    <aside className="panel" aria-label="Claude Code control panel">
      <SessionSection {...props} />
      <AccountsSection accounts={props.accounts} chatAccount={props.chatAccount} />
      <UsageSection ready={ready} turns={turns} live={liveLimits} accounts={props.accounts} chatAccount={props.chatAccount} />
      <McpSection ready={ready} rev={rev} />
      <PluginsSection errors={init?.sysinit?.plugin_errors} onChanged={onPluginsChanged} />
      <SkillsSection commands={commands} onInsert={onInsert} />
      <CommandsSection commands={commands} onInsert={onInsert} />
      <AgentsSection agents={init?.agents} />
      <HooksSection cwd={cwd} rev={rev} />
      <MemorySection cwd={cwd} rev={rev} />
      <ClaudeCodeSection />
      <GitSection />
    </aside>
  );
}
