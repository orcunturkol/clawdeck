// Titles for shell commands: the Bash tool's `description` says why a command runs.

const isShell = (t) => (t.name === 'Bash' || t.name === 'PowerShell') && t.input;

export const normalizeCommand = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// The description of the newest Bash call with this command, or ''.
export function descriptionFor(command, tools) {
  const want = normalizeCommand(command);
  if (!want) return '';
  let found = '';
  for (const t of Object.values(tools || {})) {
    if (!isShell(t) || !t.input.description) continue;
    if (normalizeCommand(t.input.command) === want) found = String(t.input.description).trim();
  }
  return found;
}

// Title for a running shell; falls back to the command itself.
export function shellTitle(command, tools) {
  return descriptionFor(command, tools) || String(command || '').split('\n')[0];
}
