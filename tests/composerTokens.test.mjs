import test from 'node:test';
import assert from 'node:assert/strict';
import { insertToken, reconcile, buildSend, mention } from '../src/composerTokens.js';

test('insert at end adds spaces', () => {
  assert.deepEqual(insertToken('look at', 7, '[image1]'), { text: 'look at [image1] ', caret: 17 });
});
test('insert in empty text', () => {
  assert.deepEqual(insertToken('', 0, '[image1]'), { text: '[image1] ', caret: 9 });
});
test('insert in the middle', () => {
  const r = insertToken('see  now', 4, '[file1]');
  assert.equal(r.text, 'see [file1] now');
  assert.equal(r.caret, 12);
});
test('insert between words without spaces', () => {
  assert.equal(insertToken('ab', 1, '[image2]').text, 'a [image2] b');
});
test('reconcile drops missing tokens', () => {
  const a = { '[image1]': { kind: 'image' }, '[file1]': { kind: 'file' } };
  assert.deepEqual(Object.keys(reconcile(a, 'only [file1] here')), ['[file1]']);
});
test('buildSend orders images by text position and expands files', () => {
  const a = {
    '[image1]': { kind: 'image', mediaType: 'image/png', data: 'A' },
    '[image2]': { kind: 'image', mediaType: 'image/jpeg', data: 'B' },
    '[file1]': { kind: 'file', path: '/tmp/my dir/x.txt' },
    '[image3]': { kind: 'image', mediaType: 'image/png', data: 'C' },
  };
  const r = buildSend('first [image2] then [file1] and [image1] [image1] ', a);
  assert.equal(r.text, 'first [image2] then @"/tmp/my dir/x.txt" and [image1] [image1]');
  assert.deepEqual(r.images.map((i) => i.data), ['B', 'A']);
});
test('buildSend without attachments', () => {
  assert.deepEqual(buildSend(' hi [image9] ', {}), { text: 'hi [image9]', images: [] });
});
test('mention quotes spaces', () => {
  assert.equal(mention('/a b'), '@"/a b"');
  assert.equal(mention('/ab'), '@/ab');
});
