const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyTrackerState,
  normalizeTrackerState,
  chooseNewestState
} = require('../src/services/sync.cjs');

test('createEmptyTrackerState returns safe defaults', () => {
  const value = createEmptyTrackerState();
  assert.deepEqual(value.sessions, []);
  assert.deepEqual(value.leaveEntries, []);
  assert.equal(value.activeCheckIn, null);
});

test('normalizeTrackerState guards malformed payloads', () => {
  const value = normalizeTrackerState({ sessions: 'nope', leaveEntries: null });
  assert.deepEqual(value.sessions, []);
  assert.deepEqual(value.leaveEntries, []);
});

test('chooseNewestState prefers remote when newer', () => {
  const localState = {
    sessions: [],
    leaveEntries: [],
    activeCheckIn: null,
    lastModified: '2026-03-07T10:00:00.000Z'
  };
  const remoteState = {
    sessions: [{ id: 's1' }],
    leaveEntries: [],
    activeCheckIn: null,
    lastModified: '2026-03-07T11:00:00.000Z'
  };
  const result = chooseNewestState(localState, remoteState);
  assert.equal(result.source, 'remote');
  assert.equal(result.state.sessions.length, 1);
});
