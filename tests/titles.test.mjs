import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommand, descriptionFor, shellTitle } from '../src/titles.js';

const tools = {
  a: { name: 'Bash', input: { command: 'aws  deploy list\n  --watch', description: 'Watch AWS deploys', run_in_background: true } },
  b: { name: 'Bash', input: { command: 'ls' } },
  c: { name: 'Read', input: { command: 'x', description: 'no' } },
};

test('normalizeCommand collapses whitespace', () => {
  assert.equal(normalizeCommand('  a \n\t b  '), 'a b');
  assert.equal(normalizeCommand(null), '');
});
test('matches a running command to its description', () => {
  assert.equal(descriptionFor('aws deploy list --watch', tools), 'Watch AWS deploys');
});
test('no description gives empty text', () => {
  assert.equal(descriptionFor('ls', tools), '');
  assert.equal(descriptionFor('x', tools), '');
  assert.equal(descriptionFor('', tools), '');
});
test('shellTitle falls back to the first command line', () => {
  assert.equal(shellTitle('aws deploy list --watch', tools), 'Watch AWS deploys');
  assert.equal(shellTitle('sleep 9\necho hi', {}), 'sleep 9');
  assert.equal(shellTitle('sleep 9', undefined), 'sleep 9');
});
