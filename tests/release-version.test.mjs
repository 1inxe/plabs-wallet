import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseVersion } from '../scripts/release-version.mjs';
const main = { GITHUB_REF: 'refs/heads/main', GITHUB_RUN_NUMBER: '5' };
test('each main push has a unique Chrome-compatible version; reruns keep it', () => {
  assert.deepEqual(releaseVersion('0.8.1', '0.8.1', main), { version: '0.8.1.5', tag: 'v0.8.1.5' });
  assert.equal(releaseVersion('0.8.1', '0.8.1', { ...main, GITHUB_RUN_ATTEMPT: '2' }).tag, 'v0.8.1.5');
  assert.equal(releaseVersion('0.8.1', '0.8.1', { ...main, GITHUB_RUN_NUMBER: '6' }).tag, 'v0.8.1.6');
});
test('PRs keep the base version and manual tags must match the base', () => {
  assert.equal(releaseVersion('0.8.1', '0.8.1', { GITHUB_REF: 'refs/pull/1/merge' }).version, '0.8.1');
  for (const tag of ['v0.8.1', 'v0.8.1.5']) assert.equal(releaseVersion('0.8.1', '0.8.1', { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag }).tag, tag);
  assert.throws(() => releaseVersion('0.8.1', '0.8.1', { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.9.0' }));
});
test('version mismatch, malformed and out-of-range build numbers fail before packaging', () => {
  assert.throws(() => releaseVersion('0.8.1', '0.8.2', main));
  for (const number of ['65536', '-1', '01', 'abc', undefined]) assert.throws(() => releaseVersion('0.8.1', '0.8.1', { ...main, GITHUB_RUN_NUMBER: number }));
});
