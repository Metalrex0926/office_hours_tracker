import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import LottieView from 'lottie-react-native';

const PocketBaseModule = require('pocketbase');
const PocketBase = PocketBaseModule.default || PocketBaseModule;
const {
  validateEmail,
  validatePassword,
  sanitizeReason,
  validateIsoDate,
  daysBetweenInclusive
} = require('./src/utils/validation.cjs');
const { createEmptyTrackerState, normalizeTrackerState, chooseNewestState } = require('./src/services/sync.cjs');

const PB_URL = process.env.EXPO_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const AUTH_STORE_KEY = 'office_tracker_pb_auth_v1';
const CLOUD_COLLECTION = 'user_state';
const CL_ENTITLEMENT = 12;
const PL_ENTITLEMENT = 15;
const LOGIN_ANIMATION_URL =
  process.env.EXPO_PUBLIC_LOGIN_LOTTIE_URL || 'https://assets2.lottiefiles.com/packages/lf20_jcikwtux.json';
const SIGNUP_ANIMATION_URL =
  process.env.EXPO_PUBLIC_SIGNUP_LOTTIE_URL || 'https://assets10.lottiefiles.com/packages/lf20_touohxv0.json';

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

function toDateOnlyString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function withTimestamp(state) {
  return { ...state, lastModified: new Date().toISOString() };
}

function AuthScreen({
  authMode,
  setAuthMode,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  fullName,
  setFullName,
  timezone,
  setTimezone,
  onSubmit,
  busy
}) {
  const isSignup = authMode === 'signup';

  return (
    <SafeAreaView style={styles.authContainer}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
        <View style={styles.authAnimationWrap}>
          <LottieView
            source={{ uri: isSignup ? SIGNUP_ANIMATION_URL : LOGIN_ANIMATION_URL }}
            autoPlay
            loop
            style={styles.authAnimation}
          />
        </View>

        <Text style={styles.authTitle}>{isSignup ? 'Create Account' : 'Sign In'}</Text>
        <Text style={styles.authSubTitle}>Personal account sync across Android and iOS</Text>

        {isSignup && (
          <>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              style={styles.input}
              placeholder="Your full name"
              autoCapitalize="words"
              maxLength={80}
            />

            <Text style={styles.label}>Timezone</Text>
            <TextInput
              value={timezone}
              onChangeText={setTimezone}
              style={styles.input}
              placeholder="Asia/Kolkata"
              autoCapitalize="none"
              maxLength={80}
            />
          </>
        )}

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          placeholder="name@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          maxLength={120}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          placeholder="Use a strong password"
          secureTextEntry
          autoCapitalize="none"
          maxLength={120}
        />

        {isSignup && (
          <>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              style={styles.input}
              placeholder="Re-enter password"
              secureTextEntry
              autoCapitalize="none"
              maxLength={120}
            />
            <Text style={styles.small}>Minimum 10 chars with upper/lower/number/symbol</Text>
          </>
        )}

        <Pressable style={[styles.primaryBtn, busy && styles.disabledBtn]} onPress={onSubmit} disabled={busy}>
          <Text style={styles.btnText}>{busy ? 'Please wait...' : isSignup ? 'Create Account' : 'Sign In'}</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={() => setAuthMode(isSignup ? 'login' : 'signup')}>
          <Text style={styles.secondaryText}>
            {isSignup ? 'Already have an account? Sign In' : "No account yet? Create one"}
          </Text>
        </Pressable>
      </ScrollView>
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
  const pbRef = useRef(null);
  const syncTimerRef = useRef(null);

  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [tab, setTab] = useState('Dashboard');

  const [authMode, setAuthMode] = useState('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  const [tracker, setTracker] = useState(createEmptyTrackerState());

  const [leaveType, setLeaveType] = useState('CL');
  const [leaveStart, setLeaveStart] = useState(toDateOnlyString(new Date()));
  const [leaveEnd, setLeaveEnd] = useState(toDateOnlyString(new Date()));
  const [leaveReason, setLeaveReason] = useState('');

  const [profileName, setProfileName] = useState('');
  const [profileTimezone, setProfileTimezone] = useState('Asia/Kolkata');

  const sessions = tracker.sessions;
  const activeCheckIn = tracker.activeCheckIn;
  const leaveEntries = tracker.leaveEntries;

  const now = new Date();
  const today = toDateOnlyString(now);
  const fy = getFiscalYearRange(now);

  const localDataKey = user ? `office_tracker_data_${user.id}` : null;

  const persistAuthStore = async (pb) => {
    try {
      if (pb.authStore.isValid) {
        await SecureStore.setItemAsync(
          AUTH_STORE_KEY,
          JSON.stringify({ token: pb.authStore.token, model: pb.authStore.model })
        );
      } else {
        await SecureStore.deleteItemAsync(AUTH_STORE_KEY);
      }
    } catch {
      Alert.alert('Security Error', 'Could not persist secure auth session.');
    }
  };

  const fetchCloudStateRecord = async (pb, userId) => {
    try {
      return await pb.collection(CLOUD_COLLECTION).getFirstListItem(`user=\"${userId}\"`);
    } catch (err) {
      if (err?.status === 404) return null;
      throw err;
    }
  };

  const parseCloudPayload = (record) => {
    if (!record?.payload) return createEmptyTrackerState();
    const remoteUpdated = typeof record.updated === 'string' ? record.updated : new Date(0).toISOString();
    if (typeof record.payload === 'string') {
      try {
        return normalizeTrackerState({ ...JSON.parse(record.payload), lastModified: remoteUpdated });
      } catch {
        return createEmptyTrackerState();
      }
    }
    return normalizeTrackerState({ ...record.payload, lastModified: remoteUpdated });
  };

  const upsertCloudState = async (nextState, statusText = 'syncing') => {
    if (!user || !pbRef.current) return;
    setSyncStatus(statusText);

    const pb = pbRef.current;
    try {
      const current = await fetchCloudStateRecord(pb, user.id);
      if (current) {
        await pb.collection(CLOUD_COLLECTION).update(current.id, {
          payload: nextState
        });
      } else {
        await pb.collection(CLOUD_COLLECTION).create({
          user: user.id,
          payload: nextState
        });
      }
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
      Alert.alert(
        'Sync Error',
        'Cloud sync failed. Check PocketBase URL, collection schema, and user rules.'
      );
    }
  };

  const updateTracker = (updater) => {
    setTracker((prev) => withTimestamp(updater(prev)));
  };

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const pb = new PocketBase(PB_URL);
        pbRef.current = pb;

        const stored = await SecureStore.getItemAsync(AUTH_STORE_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed?.token) {
              pb.authStore.save(parsed.token, parsed.model || null);
            }
          } catch {
            await SecureStore.deleteItemAsync(AUTH_STORE_KEY);
          }
        }

        pb.authStore.onChange(async () => {
          if (!alive) return;
          await persistAuthStore(pb);
          setUser(pb.authStore.isValid ? pb.authStore.model : null);
        });

        if (alive) {
          setUser(pb.authStore.isValid ? pb.authStore.model : null);
        }
      } finally {
        if (alive) setBooting(false);
      }
    })();

    return () => {
      alive = false;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setSyncReady(false);
      setSyncStatus('idle');
      setTracker(createEmptyTrackerState());
      return;
    }

    setProfileName(user.name || '');
    setProfileTimezone(user.timezone || 'Asia/Kolkata');

    let alive = true;

    (async () => {
      const localRaw = localDataKey ? await AsyncStorage.getItem(localDataKey) : null;
      const localState = normalizeTrackerState(localRaw ? JSON.parse(localRaw) : createEmptyTrackerState());

      try {
        setSyncStatus('syncing');
        const remoteRecord = await fetchCloudStateRecord(pbRef.current, user.id);
        const remoteState = remoteRecord ? parseCloudPayload(remoteRecord) : createEmptyTrackerState();
        const resolution = chooseNewestState(localState, remoteState);
        if (!alive) return;
        setTracker(resolution.state);

        if (!remoteRecord || resolution.source === 'local') {
          await upsertCloudState(resolution.state, 'syncing');
        } else {
          setSyncStatus('synced');
        }
      } catch {
        if (!alive) return;
        setTracker(localState);
        setSyncStatus('error');
      } finally {
        if (alive) setSyncReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user, localDataKey]);

  useEffect(() => {
    if (!user || !syncReady || !localDataKey) return;

    AsyncStorage.setItem(localDataKey, JSON.stringify(tracker)).catch(() => {
      Alert.alert('Storage Error', 'Could not cache tracker data locally.');
    });

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      upsertCloudState(tracker);
    }, 700);
  }, [tracker, user, syncReady, localDataKey]);

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

  const handleSignIn = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!validateEmail(normalizedEmail)) {
      Alert.alert('Invalid Email', 'Enter a valid email address.');
      return;
    }
    if (!password) {
      Alert.alert('Missing Password', 'Enter your password.');
      return;
    }

    setAuthBusy(true);
    try {
      await pbRef.current.collection('users').authWithPassword(normalizedEmail, password);
      setPassword('');
      setConfirmPassword('');
    } catch {
      Alert.alert('Sign In Failed', 'Check credentials and PocketBase URL.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignUp = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    const cleanTimezone = timezone.trim() || 'Asia/Kolkata';

    if (!cleanName) {
      Alert.alert('Invalid Name', 'Full name is required.');
      return;
    }
    if (!validateEmail(normalizedEmail)) {
      Alert.alert('Invalid Email', 'Enter a valid email address.');
      return;
    }
    if (!validatePassword(password)) {
      Alert.alert(
        'Weak Password',
        'Password must have at least 10 chars and include upper/lower letters, number, and symbol.'
      );
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password Mismatch', 'Password and confirm password must match.');
      return;
    }

    setAuthBusy(true);
    try {
      await pbRef.current.collection('users').create({
        email: normalizedEmail,
        password,
        passwordConfirm: confirmPassword,
        name: cleanName,
        timezone: cleanTimezone
      });
      await pbRef.current.collection('users').authWithPassword(normalizedEmail, password);
      setPassword('');
      setConfirmPassword('');
    } catch {
      Alert.alert('Sign Up Failed', 'User already exists or PocketBase schema/rules are not configured.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    pbRef.current?.authStore.clear();
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleProfileSave = async () => {
    const cleanName = profileName.trim();
    const cleanTimezone = profileTimezone.trim() || 'Asia/Kolkata';
    if (!cleanName) {
      Alert.alert('Invalid Name', 'Name cannot be empty.');
      return;
    }

    try {
      await pbRef.current.collection('users').update(user.id, {
        name: cleanName,
        timezone: cleanTimezone
      });
      const refreshed = { ...user, name: cleanName, timezone: cleanTimezone };
      pbRef.current.authStore.save(pbRef.current.authStore.token, refreshed);
      Alert.alert('Profile Updated', 'Your profile was updated successfully.');
    } catch {
      Alert.alert('Profile Update Failed', 'Could not update profile.');
    }
  };

  const checkIn = () => {
    if (activeCheckIn) {
      Alert.alert('Already checked in', 'Please check out first.');
      return;
    }
    updateTracker((prev) => ({ ...prev, activeCheckIn: new Date().toISOString() }));
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

    updateTracker((prev) => ({
      ...prev,
      sessions: [newSession, ...prev.sessions],
      activeCheckIn: null
    }));
  };

  const addLeave = () => {
    if (!validateIsoDate(leaveStart) || !validateIsoDate(leaveEnd)) {
      Alert.alert('Invalid dates', 'Use YYYY-MM-DD format for leave dates.');
      return;
    }

    const diffDays = daysBetweenInclusive(leaveStart, leaveEnd);
    if (!diffDays) {
      Alert.alert('Invalid range', 'Leave end date must be the same or after start date.');
      return;
    }

    const record = {
      id: `${Date.now()}`,
      type: leaveType,
      startDate: leaveStart,
      endDate: leaveEnd,
      days: diffDays,
      reason: sanitizeReason(leaveReason)
    };

    updateTracker((prev) => ({
      ...prev,
      leaveEntries: [record, ...prev.leaveEntries]
    }));
    setLeaveReason('');
  };

  const removeLeave = (id) => {
    updateTracker((prev) => ({
      ...prev,
      leaveEntries: prev.leaveEntries.filter((l) => l.id !== id)
    }));
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text>Loading secure session...</Text>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        fullName={fullName}
        setFullName={setFullName}
        timezone={timezone}
        setTimezone={setTimezone}
        onSubmit={authMode === 'signup' ? handleSignUp : handleSignIn}
        busy={authBusy}
      />
    );
  }

  const monthCells = monthDays(now.getFullYear(), now.getMonth());

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.headerText}>{tab}</Text>
        <Text style={styles.headerSub}>{user.email}</Text>
        <Text style={styles.syncText}>Sync: {syncStatus}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'Dashboard' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Today's Status</Text>
              <View style={styles.rowTwo}>
                <View>
                  <Text style={styles.label}>Check In</Text>
                  <Text style={styles.value}>
                    {todaySummary.first ? formatDate(todaySummary.first, true).split(' ')[1] : '-'}
                  </Text>
                </View>
                <View>
                  <Text style={styles.label}>Check Out</Text>
                  <Text style={styles.value}>
                    {todaySummary.last ? formatDate(todaySummary.last, true).split(' ')[1] : '-'}
                  </Text>
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
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {now.toLocaleString('default', { month: 'long' })} {now.getFullYear()}
            </Text>
            <View style={styles.weekRow}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
                <Text key={w} style={styles.weekLabel}>
                  {w}
                </Text>
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
                    <View style={[styles.dot, isLeave ? styles.orange : isPresent ? styles.green : styles.gray]} />
                  </View>
                );
              })}
            </View>
            <Text style={styles.legend}>Green: Present  Orange: Leave</Text>
          </View>
        )}

        {tab === 'Leaves' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave Balance (FY {fy.label})</Text>
              <Text style={styles.label}>Casual Leaves: {leaveSummary.clLeft} / {CL_ENTITLEMENT}</Text>
              <Text style={styles.label}>Privilege Leaves: {leaveSummary.plLeft} / {PL_ENTITLEMENT}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Add Leave</Text>
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
              <TextInput value={leaveReason} onChangeText={setLeaveReason} style={styles.input} maxLength={250} />

              <Pressable style={styles.primaryBtn} onPress={addLeave}>
                <Text style={styles.btnText}>Save Leave</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave History</Text>
              {leaveEntries.length === 0 && <Text style={styles.small}>No leave records yet.</Text>}
              {leaveEntries.slice(0, 12).map((l) => (
                <View key={l.id} style={styles.historyItem}>
                  <Text style={styles.value}>
                    {l.type} {l.days} day(s)
                  </Text>
                  <Text style={styles.small}>
                    {l.startDate} to {l.endDate}
                  </Text>
                  <Text style={styles.small}>{l.reason || 'No reason'}</Text>
                  <Pressable onPress={() => removeLeave(l.id)}>
                    <Text style={styles.delete}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}

        {tab === 'Settings' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Profile</Text>
              <Text style={styles.label}>Full name</Text>
              <TextInput value={profileName} onChangeText={setProfileName} style={styles.input} maxLength={80} />

              <Text style={styles.label}>Timezone</Text>
              <TextInput
                value={profileTimezone}
                onChangeText={setProfileTimezone}
                style={styles.input}
                maxLength={80}
              />

              <Pressable style={styles.primaryBtn} onPress={handleProfileSave}>
                <Text style={styles.btnText}>Save Profile</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Security</Text>
              <Text style={styles.small}>Passwords are never stored in local AsyncStorage.</Text>
              <Text style={styles.small}>Session token is stored in device SecureStore.</Text>
              <Pressable style={[styles.primaryBtn, { backgroundColor: '#d6544b' }]} onPress={handleLogout}>
                <Text style={styles.btnText}>Logout</Text>
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
  container: { flex: 1, backgroundColor: '#eef2f7' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  authContainer: { flex: 1, backgroundColor: '#f4f7fb' },
  authContent: { padding: 20, paddingBottom: 50 },
  authAnimationWrap: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#d8e0ea'
  },
  authAnimation: { width: '100%', height: 220 },
  authTitle: { fontSize: 34, fontWeight: '700', color: '#13263f', textAlign: 'center' },
  authSubTitle: { textAlign: 'center', color: '#4d6480', marginBottom: 16, marginTop: 6, fontSize: 16 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f8f9fb',
    borderBottomWidth: 1,
    borderBottomColor: '#d8dde5'
  },
  headerText: { fontSize: 30, fontWeight: '700', color: '#0f1f35' },
  headerSub: { fontSize: 13, color: '#4d6380', marginTop: 2 },
  syncText: { fontSize: 13, color: '#355f99', marginTop: 2 },
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
  label: { color: '#42556f', marginBottom: 6, fontSize: 16 },
  value: { fontSize: 24, fontWeight: '700', color: '#1a2c46', marginBottom: 6 },
  big: { fontSize: 50, fontWeight: '700', color: '#2c6de5' },
  rowTwo: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  greenBox: {
    marginVertical: 8,
    backgroundColor: '#e4f3e6',
    padding: 10,
    borderRadius: 8,
    color: '#2f8a3a',
    fontWeight: '600',
    fontSize: 18
  },
  total: {
    marginTop: 8,
    backgroundColor: '#f2f4f7',
    borderRadius: 8,
    padding: 10,
    fontWeight: '700',
    textAlign: 'center',
    color: '#2d3950',
    fontSize: 18
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
  disabledBtn: { opacity: 0.7 },
  secondaryBtn: { marginTop: 12, padding: 8, alignItems: 'center' },
  secondaryText: { color: '#1e5bc4', fontWeight: '600' },
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
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#cad5e3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#fbfdff',
    fontSize: 16
  },
  small: { color: '#596f8b', marginBottom: 4, fontSize: 14 },
  historyItem: {
    borderTopWidth: 1,
    borderColor: '#e1e8f0',
    paddingTop: 10,
    marginTop: 8
  },
  delete: { color: '#d14a3f', fontWeight: '700', fontSize: 16, marginTop: 4 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  weekLabel: { width: '14.2%', textAlign: 'center', color: '#566b84', fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.2%', height: 56, alignItems: 'center', justifyContent: 'center' },
  dayText: { color: '#213a5c', fontSize: 16 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 2 },
  green: { backgroundColor: '#5ac166' },
  orange: { backgroundColor: '#ef9d34' },
  gray: { backgroundColor: '#d8e1ec' },
  legend: { marginTop: 8, color: '#5a7090', fontSize: 14 },
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
  tabTextActive: { color: '#2f72e4', fontWeight: '700' }
});
