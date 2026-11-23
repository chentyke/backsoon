import assert from 'node:assert/strict';
import test from 'node:test';
import { commandResult, formatCommand, isActive, taskPercent } from '../src/task.js';
import { createTaskFormatter } from '../src/web/task-view.js';

const format = createTaskFormatter('en');
const record = { argv: ['tool'], started: 100, updated: 105 };

test('process results distinguish ownership, observation and an explicit stop', () => {
  for (const [code, attached, stopping, status] of [
    [0, false, false, 'succeeded'], [1, false, false, 'failed'], [-15, false, true, 'stopped'],
    [0, true, false, 'exited'], [1, true, false, 'failed'], [0, true, true, 'stopped'],
  ]) {
    assert.deepEqual(commandResult(code, attached, stopping), { status, code: attached ? null : code });
  }
  for (const state of ['starting', 'running', 'stopping']) assert.ok(isActive(state));
  for (const state of ['exited', 'failed', 'succeeded', 'stopped', 'interrupted', 'resolved']) {
    const resolution = state === 'resolved' ? { reason: 'Artifact verified' } : null;
    const view = format.describe({ ...record, status: resolution ? 'failed' : state, resolution });
    assert.equal(view.active, false);
    assert.equal(view.glyph, state);
    assert.equal(view.layout, 'outcome');
    if (resolution) assert.equal(view.context, resolution.reason);
  }
});

test('a percentage needs measured work, countable activities, or confirmed completion', () => {
  const checks = ['failed', 'running', 'skipped', 'stopped'].map(state => ({ kind: 'checks', state }));
  assert.equal(taskPercent({ activities: checks }), 75);
  assert.equal(taskPercent({ percent: 0, activities: checks }), 0);
  assert.equal(taskPercent({ status: 'exited' }), null);
  assert.equal(taskPercent({ status: 'exited', percent: 35 }), 35);
  assert.equal(taskPercent({ status: 'succeeded', percent: 35 }), 100);
  assert.equal(taskPercent({ resolution: { reason: 'Verified' }, percent: 35 }), 100);
  assert.equal(taskPercent({ activities: [{ kind: 'tests', done: 2, total: 8 }] }), 25);
  for (const count of [{ total: 3 }, { done: 0, total: 0 }, { done: 4, total: 3 }]) {
    assert.equal(taskPercent({ activities: [{ kind: 'step', ...count }] }), null);
  }
  assert.equal(taskPercent({ activities: [...checks, { kind: 'download' }] }), null);
  assert.equal(taskPercent({ activities: [{ kind: 'chat', state: 'needsInput' }] }), 0);
});

test('the list and dialog get localized observations from one timestamp', () => {
  const task = { ...record, status: 'running', progress_error: 'script failed', attached_pid: 123,
    activities: [{ kind: 'chat', state: 'needsInput', name: 'Approval' }] };
  const view = format.describe(task, 115000);
  assert.equal(view.glyph, 'needsInput');
  assert.match(view.context, /Approval/);
  assert.equal(view.duration, 'Monitoring for 15s');
  assert.equal(formatCommand(['tool', '', "a'b", 'two words']), "tool '' 'a'\\''b' 'two words'");
});
