function createEmptyTrackerState() {
  return {
    sessions: [],
    activeCheckIn: null,
    leaveEntries: [],
    lastModified: new Date(0).toISOString()
  };
}

function normalizeTrackerState(input) {
  const base = createEmptyTrackerState();
  if (!input || typeof input !== 'object') return base;
  return {
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
    activeCheckIn: typeof input.activeCheckIn === 'string' ? input.activeCheckIn : null,
    leaveEntries: Array.isArray(input.leaveEntries) ? input.leaveEntries : [],
    lastModified: typeof input.lastModified === 'string' ? input.lastModified : base.lastModified
  };
}

function chooseNewestState(localState, remoteState) {
  const local = normalizeTrackerState(localState);
  const remote = normalizeTrackerState(remoteState);
  const localTime = new Date(local.lastModified).getTime();
  const remoteTime = new Date(remote.lastModified).getTime();
  if (remoteTime > localTime) return { source: 'remote', state: remote };
  return { source: 'local', state: local };
}

module.exports = {
  createEmptyTrackerState,
  normalizeTrackerState,
  chooseNewestState
};
