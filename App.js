import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

const STORAGE_KEY = 'office_tracker_v2';
const CL_ENTITLEMENT = 12;
const PL_ENTITLEMENT = 15;

function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  if (withTime) {
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })}`;
  }
  return d.toISOString().slice(0, 10);
}

function minutesToDisplay(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function getFiscalYearRange(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const startYear = m >= 3 ? y : y - 1;
  return {
    label: `${startYear}-${startYear + 1}`,
    start: new Date(startYear, 3, 1, 0, 0, 0, 0),
    end: new Date(startYear + 1, 2, 31, 23, 59, 59, 999)
  };
}

function monthDays(year, monthIndex) {
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push(null);
  for (let d = 1; d <= totalDays; d += 1) cells.push(d);
  return cells;
}

function PinGate({ pin, onSetPin, onUnlock }) {
  const [input, setInput] = useState('');
  const isSetup = !pin;

  const onSubmit = () => {
    if (!/^\d{4}$/.test(input)) {
      Alert.alert('Invalid PIN', 'PIN must be exactly 4 digits.');
      return;
    }

    if (isSetup) {
      onSetPin(input);
      setInput('');
      return;
    }

    if (input !== pin) {
      Alert.alert('Wrong PIN', 'Please try again.');
      return;
    }

    onUnlock();
    setInput('');
  };

  return (
    <SafeAreaView style={styles.lockContainer}>
      <StatusBar style="dark" />
      <View style={styles.lockCard}>
        <Text style={styles.lockIcon}>◷</Text>
        <Text style={styles.lockTitle}>{isSetup ? 'Set PIN' : 'Welcome Back'}</Text>
        <Text style={styles.lockSubtitle}>
          {isSetup ? 'Create a 4-digit PIN for this app' : 'Enter your 4-digit PIN to continue'}
        </Text>
        <TextInput
          style={styles.lockInput}
          value={input}
          onChangeText={setInput}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          placeholder="Enter PIN"
        />
        <Pressable style={styles.lockButton} onPress={onSubmit}>
          <Text style={styles.lockButtonText}>{isSetup ? 'Save PIN' : 'Login'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function TabButton({ label, isActive, onPress }) {
  return (
    <Pressable style={styles.tabButton} onPress={onPress}>
      <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('Dashboard');

  const [sessions, setSessions] = useState([]);
  const [activeCheckIn, setActiveCheckIn] = useState(null);
  const [leaveEntries, setLeaveEntries] = useState([]);

  const [leaveType, setLeaveType] = useState('CL');
  const [leaveStart, setLeaveStart] = useState(new Date().toISOString().slice(0, 10));
  const [leaveEnd, setLeaveEnd] = useState(new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState('');

  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          setPin(parsed.pin || '');
          setSessions(parsed.sessions || []);
          setActiveCheckIn(parsed.activeCheckIn || null);
          setLeaveEntries(parsed.leaveEntries || []);
        }
      } catch {
        Alert.alert('Error', 'Could not load app data.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (loading) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pin, sessions, activeCheckIn, leaveEntries })
    ).catch(() => Alert.alert('Error', 'Could not save app data.'));
  }, [pin, sessions, activeCheckIn, leaveEntries, loading]);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fy = getFiscalYearRange(now);

  const liveMins = useMemo(() => {
    if (!activeCheckIn) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(activeCheckIn).getTime()) / 60000));
  }, [activeCheckIn]);

  const todaySummary = useMemo(() => {
    const daySessions = sessions.filter((s) => s.date === today);
    const first = daySessions.length ? daySessions[daySessions.length - 1].checkIn : activeCheckIn;
    const last = daySessions.length ? daySessions[0].checkOut : null;
    const minutes = daySessions.reduce((sum, s) => sum + s.durationMinutes, 0) + liveMins;
    return { first, last, minutes };
  }, [sessions, today, liveMins, activeCheckIn]);

  const monthSummary = useMemo(() => {
    const m = now.getMonth();
    const y = now.getFullYear();
    const monthSessions = sessions.filter((s) => {
      const d = new Date(s.checkIn);
      return d.getMonth() === m && d.getFullYear() === y;
    });
    const daysSet = new Set(monthSessions.map((s) => s.date));
    const totalMinutes = monthSessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    return { daysPresent: daysSet.size, totalMinutes };
  }, [sessions, now]);

  const leaveSummary = useMemo(() => {
    const fyLeaves = leaveEntries.filter((l) => {
      const d = new Date(l.startDate);
      return d >= fy.start && d <= fy.end;
    });
    const clUsed = fyLeaves.filter((l) => l.type === 'CL').reduce((sum, l) => sum + l.days, 0);
    const plUsed = fyLeaves.filter((l) => l.type === 'PL').reduce((sum, l) => sum + l.days, 0);
    return {
      clUsed,
      plUsed,
      clLeft: Math.max(0, CL_ENTITLEMENT - clUsed),
      plLeft: Math.max(0, PL_ENTITLEMENT - plUsed)
    };
  }, [leaveEntries, fy.start, fy.end]);

  const checkIn = () => {
    if (activeCheckIn) {
      Alert.alert('Already checked in', 'Please check out first.');
      return;
    }
    setActiveCheckIn(new Date().toISOString());
  };

  const checkOut = () => {
    if (!activeCheckIn) {
      Alert.alert('No active session', 'Check in first.');
      return;
    }
    const out = new Date().toISOString();
    const inDate = new Date(activeCheckIn);
    const duration = Math.max(0, Math.floor((new Date(out).getTime() - inDate.getTime()) / 60000));
    const newSession = {
      id: `${activeCheckIn}_${out}`,
      date: inDate.toISOString().slice(0, 10),
      checkIn: activeCheckIn,
      checkOut: out,
      durationMinutes: duration
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveCheckIn(null);
  };

  const addLeave = () => {
    const start = new Date(leaveStart);
    const end = new Date(leaveEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      Alert.alert('Invalid dates', 'Enter valid leave start and end dates.');
      return;
    }
    const diffDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    const record = {
      id: `${Date.now()}`,
      type: leaveType,
      startDate: leaveStart,
      endDate: leaveEnd,
      days: diffDays,
      reason: leaveReason.trim()
    };
    setLeaveEntries((prev) => [record, ...prev]);
    setLeaveReason('');
  };

  const removeLeave = (id) => setLeaveEntries((prev) => prev.filter((l) => l.id !== id));

  const changePin = () => {
    if (oldPin !== pin) {
      Alert.alert('Incorrect PIN', 'Old PIN does not match.');
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      Alert.alert('Invalid PIN', 'New PIN must be 4 digits.');
      return;
    }
    setPin(newPin);
    setOldPin('');
    setNewPin('');
    Alert.alert('Updated', 'PIN changed successfully.');
  };

  const calendarState = useMemo(() => {
    const y = now.getFullYear();
    const m = now.getMonth();
    const presentDates = new Set(
      sessions
        .filter((s) => {
          const d = new Date(s.date);
          return d.getFullYear() === y && d.getMonth() === m;
        })
        .map((s) => s.date)
    );
    const leaveDates = new Set();
    leaveEntries.forEach((l) => {
      let d = new Date(l.startDate);
      const end = new Date(l.endDate);
      while (d <= end) {
        if (d.getMonth() === m && d.getFullYear() === y) leaveDates.add(d.toISOString().slice(0, 10));
        d = new Date(d.getTime() + 86400000);
      }
    });
    return { presentDates, leaveDates };
  }, [sessions, leaveEntries, now]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text>Loading...</Text>
      </SafeAreaView>
    );
  }

  if (!unlocked) {
    return (
      <PinGate
        pin={pin}
        onSetPin={(v) => {
          setPin(v);
          setUnlocked(true);
        }}
        onUnlock={() => setUnlocked(true)}
      />
    );
  }

  const monthCells = monthDays(now.getFullYear(), now.getMonth());

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.headerText}>{tab}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'Dashboard' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Today's Status</Text>
              <View style={styles.rowTwo}>
                <View>
                  <Text style={styles.label}>Check In</Text>
                  <Text style={styles.value}>{todaySummary.first ? formatDate(todaySummary.first, true).split(' ')[1] : '-'}</Text>
                </View>
                <View>
                  <Text style={styles.label}>Check Out</Text>
                  <Text style={styles.value}>{todaySummary.last ? formatDate(todaySummary.last, true).split(' ')[1] : '-'}</Text>
                </View>
              </View>
              <Text style={styles.greenBox}>{minutesToDisplay(todaySummary.minutes)} worked</Text>
              <View style={styles.rowTwo}>
                <Pressable style={styles.primaryBtn} onPress={checkIn}>
                  <Text style={styles.btnText}>Check In</Text>
                </Pressable>
                <Pressable style={styles.primaryBtn} onPress={checkOut}>
                  <Text style={styles.btnText}>Check Out</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>This Month</Text>
              <View style={styles.rowTwo}>
                <View>
                  <Text style={styles.big}>{monthSummary.daysPresent}</Text>
                  <Text style={styles.label}>Days Present</Text>
                </View>
                <View>
                  <Text style={styles.big}>{(monthSummary.totalMinutes / 60).toFixed(1)}h</Text>
                  <Text style={styles.label}>Total Hours</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave Balance</Text>
              <View style={styles.rowTwo}>
                <View>
                  <Text style={styles.big}>{leaveSummary.clLeft}</Text>
                  <Text style={styles.label}>Casual Leaves</Text>
                </View>
                <View>
                  <Text style={styles.big}>{leaveSummary.plLeft}</Text>
                  <Text style={styles.label}>Privilege Leaves</Text>
                </View>
              </View>
              <Text style={styles.total}>Total Remaining: {leaveSummary.clLeft + leaveSummary.plLeft} days</Text>
            </View>
          </>
        )}

        {tab === 'Calendar' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{now.toLocaleString('default', { month: 'long' })} {now.getFullYear()}</Text>
              <View style={styles.weekRow}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
                  <Text key={w} style={styles.weekLabel}>{w}</Text>
                ))}
              </View>
              <View style={styles.grid}>
                {monthCells.map((d, idx) => {
                  if (!d) return <View key={`e${idx}`} style={styles.dayCell} />;
                  const date = new Date(now.getFullYear(), now.getMonth(), d).toISOString().slice(0, 10);
                  const isLeave = calendarState.leaveDates.has(date);
                  const isPresent = calendarState.presentDates.has(date);
                  return (
                    <View key={date} style={styles.dayCell}>
                      <Text style={styles.dayText}>{d}</Text>
                      <View
                        style={[
                          styles.dot,
                          isLeave ? styles.orange : isPresent ? styles.green : styles.gray
                        ]}
                      />
                    </View>
                  );
                })}
              </View>
              <Text style={styles.legend}>Green: Present  Blue: Checked-in  Orange: Leave</Text>
            </View>
          </>
        )}

        {tab === 'Leaves' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave Balance (FY {fy.label})</Text>
              <Text style={styles.label}>Casual Leaves: {leaveSummary.clLeft} / {CL_ENTITLEMENT}</Text>
              <Text style={styles.label}>Privilege Leaves: {leaveSummary.plLeft} / {PL_ENTITLEMENT}</Text>
              <Text style={styles.small}>PL quarterly buckets: Q1 3/3, Q2 3/3, Q3 3/3, Q4 3/3, Extra 3/3</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Apply for Leave</Text>
              <View style={styles.rowTwo}>
                <Pressable
                  style={[styles.toggleBtn, leaveType === 'CL' && styles.toggleBtnActive]}
                  onPress={() => setLeaveType('CL')}
                >
                  <Text style={styles.btnText}>CL</Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleBtn, leaveType === 'PL' && styles.toggleBtnActive]}
                  onPress={() => setLeaveType('PL')}
                >
                  <Text style={styles.btnText}>PL</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>Start Date (YYYY-MM-DD)</Text>
              <TextInput value={leaveStart} onChangeText={setLeaveStart} style={styles.input} />

              <Text style={styles.label}>End Date (YYYY-MM-DD)</Text>
              <TextInput value={leaveEnd} onChangeText={setLeaveEnd} style={styles.input} />

              <Text style={styles.label}>Reason</Text>
              <TextInput value={leaveReason} onChangeText={setLeaveReason} style={styles.input} />

              <Pressable style={styles.primaryBtn} onPress={addLeave}>
                <Text style={styles.btnText}>Add Leave</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave History</Text>
              {leaveEntries.length === 0 && <Text style={styles.small}>No leave records yet.</Text>}
              {leaveEntries.slice(0, 8).map((l) => (
                <View key={l.id} style={styles.historyItem}>
                  <Text style={styles.value}>{l.type} {l.days} day(s)</Text>
                  <Text style={styles.small}>{l.startDate} to {l.endDate}</Text>
                  <Text style={styles.small}>{l.reason || 'No reason'}</Text>
                  <Pressable onPress={() => removeLeave(l.id)}>
                    <Text style={styles.delete}>Cancel</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}

        {tab === 'Settings' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Office Hours Tracker</Text>
              <Text style={styles.small}>Version 1.0.0</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Work Schedule</Text>
              <Text style={styles.label}>Working Days: Mon-Fri + 1st & 3rd Sat</Text>
              <Text style={styles.label}>Fiscal Year: April to March</Text>
              <Text style={styles.label}>Total Annual Leaves: 27 days</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave Policy</Text>
              <Text style={styles.small}>Casual Leaves (12/year)</Text>
              <Text style={styles.small}>- Max 2 at a time, carry-forward to next month only</Text>
              <Text style={styles.small}>- Forfeited at fiscal year end</Text>
              <Text style={[styles.small, { marginTop: 8 }]}>Privilege Leaves (15/year)</Text>
              <Text style={styles.small}>- 3 per quarter + 3 extra clubbable leaves</Text>
              <Text style={styles.small}>- Forfeited at end of quarter</Text>
              <Text style={styles.small}>- Minimum 10 days advance notice for planned leave</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Security</Text>
              <Text style={styles.label}>Change PIN</Text>
              <TextInput
                style={styles.input}
                value={oldPin}
                onChangeText={setOldPin}
                placeholder="Old PIN"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
              />
              <TextInput
                style={styles.input}
                value={newPin}
                onChangeText={setNewPin}
                placeholder="New PIN"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
              />
              <Pressable style={styles.primaryBtn} onPress={changePin}>
                <Text style={styles.btnText}>Change PIN</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.tabBar}>
        {['Dashboard', 'Calendar', 'Leaves', 'Settings'].map((t) => (
          <TabButton key={t} label={t} isActive={tab === t} onPress={() => setTab(t)} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef0f3' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f8f9fb',
    borderBottomWidth: 1,
    borderBottomColor: '#d8dde5'
  },
  headerText: { fontSize: 30, fontWeight: '700', color: '#0f1f35' },
  content: { padding: 14, paddingBottom: 90 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde4ed',
    padding: 14,
    marginBottom: 12
  },
  cardTitle: { fontSize: 24, fontWeight: '700', color: '#172a45', marginBottom: 10 },
  label: { color: '#42556f', marginBottom: 6, fontSize: 18 },
  value: { fontSize: 28, fontWeight: '700', color: '#1a2c46', marginBottom: 6 },
  big: { fontSize: 56, fontWeight: '700', color: '#2c6de5' },
  rowTwo: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  greenBox: {
    marginVertical: 8,
    backgroundColor: '#e4f3e6',
    padding: 10,
    borderRadius: 8,
    color: '#2f8a3a',
    fontWeight: '600',
    fontSize: 20
  },
  total: {
    marginTop: 8,
    backgroundColor: '#f2f4f7',
    borderRadius: 8,
    padding: 10,
    fontWeight: '700',
    textAlign: 'center',
    color: '#2d3950',
    fontSize: 20
  },
  primaryBtn: {
    backgroundColor: '#3778e6',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    flex: 1
  },
  toggleBtn: {
    backgroundColor: '#8ba6d6',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1
  },
  toggleBtnActive: { backgroundColor: '#3778e6' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#cad5e3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#fbfdff',
    fontSize: 18
  },
  small: { color: '#596f8b', marginBottom: 4, fontSize: 17 },
  historyItem: {
    borderTopWidth: 1,
    borderColor: '#e1e8f0',
    paddingTop: 10,
    marginTop: 8
  },
  delete: { color: '#d14a3f', fontWeight: '700', fontSize: 18, marginTop: 4 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  weekLabel: { width: '14.2%', textAlign: 'center', color: '#566b84', fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.2%', height: 56, alignItems: 'center', justifyContent: 'center' },
  dayText: { color: '#213a5c', fontSize: 18 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 2 },
  green: { backgroundColor: '#5ac166' },
  orange: { backgroundColor: '#ef9d34' },
  gray: { backgroundColor: '#d8e1ec' },
  legend: { marginTop: 8, color: '#5a7090', fontSize: 16 },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderColor: '#d6dee8'
  },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabText: { color: '#7a8796', fontWeight: '600', fontSize: 16 },
  tabTextActive: { color: '#2f72e4', fontWeight: '700' },
  lockContainer: {
    flex: 1,
    backgroundColor: '#eef0f3',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  lockCard: { width: '100%' },
  lockIcon: { fontSize: 62, textAlign: 'center', color: '#3678e5', marginBottom: 10 },
  lockTitle: { fontSize: 42, fontWeight: '700', color: '#161f2d', textAlign: 'center' },
  lockSubtitle: {
    textAlign: 'center',
    color: '#6a7481',
    marginTop: 8,
    marginBottom: 18,
    fontSize: 24
  },
  lockInput: {
    borderWidth: 1,
    borderColor: '#d2dae5',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 14,
    textAlign: 'center',
    letterSpacing: 5,
    fontSize: 30,
    marginBottom: 14
  },
  lockButton: {
    backgroundColor: '#3778e6',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center'
  },
  lockButtonText: { color: '#fff', fontWeight: '700', fontSize: 24 }
});
