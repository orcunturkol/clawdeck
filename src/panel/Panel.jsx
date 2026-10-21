import SessionSection from './SessionSection.jsx';
import UsageSection from './UsageSection.jsx';
import McpSection from './McpSection.jsx';
import PluginsSection from './PluginsSection.jsx';
import MemorySection from './MemorySection.jsx';
import { SkillsSection, CommandsSection, AgentsSection, HooksSection } from './ListSections.jsx';

export default function Panel(props) {
  const { init, cwd, rev, turns, liveLimits, onInsert, onPluginsChanged } = props;
  const ready = Boolean(init);
  const commands = init?.commands || [];
  return (
    <aside className="panel" aria-label="Claude Code control panel">
      <SessionSection {...props} />
      <UsageSection ready={ready} turns={turns} live={liveLimits} />
      <McpSection ready={ready} rev={rev} />
      <PluginsSection errors={init?.sysinit?.plugin_errors} onChanged={onPluginsChanged} />
      <SkillsSection commands={commands} onInsert={onInsert} />
      <CommandsSection commands={commands} onInsert={onInsert} />
      <AgentsSection agents={init?.agents} />
      <HooksSection cwd={cwd} rev={rev} />
      <MemorySection cwd={cwd} rev={rev} />
    </aside>
  );
}
