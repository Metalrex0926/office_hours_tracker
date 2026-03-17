import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import LottieView from 'lottie-react-native';

const { width: SCREEN_W } = Dimensions.get('window');

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

const TAB_ICONS = { Dashboard: '🏠', Calendar: '📅', Leaves: '🌿', Settings: '⚙️' };

const SYNC_LABELS = { idle: '—', syncing: '⟳ Syncing', synced: '✓ Synced', error: '⚠ Sync error' };
const SYNC_COLORS = { idle: '#8a9ab0', syncing: '#3778e6', synced: '#3aaa52', error: '#d14a3f' };

function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  if (withTime) {
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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

function autoFormatDate(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function withTimestamp(state) {
  return { ...state, lastModified: new Date().toISOString() };
}

function ProgressBar({ used, total, color }) {
  const pct = Math.min(1, used / total);
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

function FieldError({ msg }) {
  if (!msg) return null;
  return <Text style={styles.fieldError}>{msg}</Text>;
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
  busy,
  setBusy
}) {
  const isSignup = authMode === 'signup';
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    const normEmail = email.trim().toLowerCase();
    if (isSignup && !fullName.trim()) errs.fullName = 'Full name is required.';
    if (!validateEmail(normEmail)) errs.email = 'Enter a valid email address.';
    if (isSignup && !validatePassword(password))
      errs.password = 'Min 10 chars with uppercase, lowercase, number & symbol.';
    if (!isSignup && !password) errs.password = 'Enter your password.';
    if (isSignup && password !== confirmPassword) errs.confirmPassword = 'Passwords do not match.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      await onSubmit();
    } catch (err) {
      const msg = err?.response?.message || err?.message || '';
      if (isSignup) {
        if (msg.toLowerCase().includes('email')) {
          setErrors((e) => ({ ...e, email: 'This email is already registered.' }));
        } else {
          setErrors((e) => ({ ...e, fullName: 'Sign up failed. Check your details and try again.' }));
        }
      } else {
        setErrors((e) => ({ ...e, password: 'Incorrect email or password.' }));
      }
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (mode) => {
    setAuthMode(mode);
    setErrors({});
  };

  const strengthLevel = () => {
    if (password.length === 0) return 0;
    let score = 0;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  };

  const strengthColor = () => {
    const lvl = strengthLevel();
    if (lvl <= 1) return '#d14a3f';
    if (lvl <= 3) return '#ef9d34';
    return '#3aaa52';
  };

  return (
    <View style={styles.authBg}>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            contentContainerStyle={styles.authContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.authLogoRow}>
              <Text style={styles.authAppIcon}>⏱</Text>
              <Text style={styles.authAppName}>Office Hours</Text>
            </View>

            <View style={styles.authAnimationWrap}>
              <LottieView
                source={{ uri: isSignup ? SIGNUP_ANIMATION_URL : LOGIN_ANIMATION_URL }}
                autoPlay
                loop
                style={styles.authAnimation}
              />
            </View>

            <View style={styles.authCard}>
              <Text style={styles.authTitle}>{isSignup ? 'Create Account' : 'Sign In'}</Text>
              <Text style={styles.authSubTitle}>Sync across Android and iOS</Text>

              {isSignup && (
                <>
                  <Text style={styles.label}>Full name</Text>
                  <TextInput
                    value={fullName}
                    onChangeText={(v) => { setFullName(v); setErrors((e) => ({ ...e, fullName: '' })); }}
                    style={[styles.input, errors.fullName && styles.inputError]}
                    placeholder="Your full name"
                    placeholderTextColor="#8fabc7"
                    autoCapitalize="words"
                    maxLength={80}
                  />
                  <FieldError msg={errors.fullName} />

                  <Text style={styles.label}>Timezone</Text>
                  <TextInput
                    value={timezone}
                    onChangeText={setTimezone}
                    style={styles.input}
                    placeholder="Asia/Kolkata"
                    placeholderTextColor="#8fabc7"
                    autoCapitalize="none"
                    maxLength={80}
                  />
                </>
              )}

              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: '' })); }}
                style={[styles.input, errors.email && styles.inputError]}
                placeholder="name@example.com"
                placeholderTextColor="#8fabc7"
                autoCapitalize="none"
                keyboardType="email-address"
                maxLength={120}
              />
              <FieldError msg={errors.email} />

              <Text style={styles.label}>Password</Text>
              <View style={styles.inputRow}>
                <TextInput
                  value={password}
                  onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: '' })); }}
                  style={[styles.inputFlex, errors.password && styles.inputError]}
                  placeholder="Use a strong password"
                  placeholderTextColor="#8fabc7"
                  secureTextEntry={!showPass}
                  autoCapitalize="none"
                  maxLength={120}
                />
                <Pressable style={styles.eyeBtn} onPress={() => setShowPass((v) => !v)}>
                  <Text style={styles.eyeIcon}>{showPass ? '🙈' : '👁'}</Text>
                </Pressable>
              </View>
              {isSignup && password.length > 0 && (
                <View style={styles.strengthRow}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <View
                      key={i}
                      style={[
                        styles.strengthBar,
                        { backgroundColor: i <= strengthLevel() ? strengthColor() : '#d8e4ef' }
                      ]}
                    />
                  ))}
                  <Text style={[styles.strengthLabel, { color: strengthColor() }]}>
                    {strengthLevel() <= 1 ? 'Weak' : strengthLevel() <= 3 ? 'Fair' : 'Strong'}
                  </Text>
                </View>
              )}
              <FieldError msg={errors.password} />

              {isSignup && (
                <>
                  <Text style={styles.label}>Confirm password</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      value={confirmPassword}
                      onChangeText={(v) => { setConfirmPassword(v); setErrors((e) => ({ ...e, confirmPassword: '' })); }}
                      style={[styles.inputFlex, errors.confirmPassword && styles.inputError]}
                      placeholder="Re-enter password"
                      placeholderTextColor="#8fabc7"
                      secureTextEntry={!showConfirmPass}
                      autoCapitalize="none"
                      maxLength={120}
                    />
                    <Pressable style={styles.eyeBtn} onPress={() => setShowConfirmPass((v) => !v)}>
                      <Text style={styles.eyeIcon}>{showConfirmPass ? '🙈' : '👁'}</Text>
                    </Pressable>
                  </View>
                  <FieldError msg={errors.confirmPassword} />
                </>
              )}

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, busy && styles.disabledBtn, pressed && styles.btnPressed]}
                onPress={handleSubmit}
                disabled={busy}
              >
                <Text style={styles.btnText}>{busy ? 'Please wait...' : isSignup ? 'Create Account' : 'Sign In'}</Text>
              </Pressable>

              <Pressable style={styles.secondaryBtn} onPress={() => switchMode(isSignup ? 'login' : 'signup')}>
                <Text style={styles.secondaryText}>
                  {isSignup ? 'Already have an account? ' : 'No account yet? '}
                  <Text style={styles.secondaryLink}>{isSignup ? 'Sign In' : 'Create one'}</Text>
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function TabButton({ label, icon, isActive, onPress }) {
  return (
    <Pressable style={styles.tabButton} onPress={onPress}>
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
      {isActive && <View style={styles.tabIndicator} />}
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
  const [tick, setTick] = useState(0);

  const [authMode, setAuthMode] = useState('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  const [tracker, setTracker] = useState(createEmptyTrackerState());

  const [calViewYear, setCalViewYear] = useState(new Date().getFullYear());
  const [calViewMonth, setCalViewMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState(null);

  const [leaveType, setLeaveType] = useState('CL');
  const [leaveStart, setLeaveStart] = useState(toDateOnlyString(new Date()));
  const [leaveEnd, setLeaveEnd] = useState(toDateOnlyString(new Date()));
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveErrors, setLeaveErrors] = useState({});

  const [profileName, setProfileName] = useState('');
  const [profileTimezone, setProfileTimezone] = useState('Asia/Kolkata');
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profilePhoto, setProfilePhoto] = useState(null);

  const sessions = tracker.sessions;
  const activeCheckIn = tracker.activeCheckIn;
  const leaveEntries = tracker.leaveEntries;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [tick]);
  const today = useMemo(() => toDateOnlyString(now), [now]);
  const fy = useMemo(() => getFiscalYearRange(now), [now]);

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
    } catch {}
  };

  const fetchCloudStateRecord = async (pb, userId) => {
    try {
      return await pb.collection(CLOUD_COLLECTION).getFirstListItem(`user="${userId}"`);
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

  const upsertCloudState = async (nextState) => {
    if (!user || !pbRef.current) return;
    setSyncStatus('syncing');
    const pb = pbRef.current;
    try {
      const current = await fetchCloudStateRecord(pb, user.id);
      if (current) {
        await pb.collection(CLOUD_COLLECTION).update(current.id, { payload: nextState });
      } else {
        await pb.collection(CLOUD_COLLECTION).create({ user: user.id, payload: nextState });
      }
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
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
            if (parsed?.token) pb.authStore.save(parsed.token, parsed.model || null);
          } catch {
            await SecureStore.deleteItemAsync(AUTH_STORE_KEY);
          }
        }
        pb.authStore.onChange(async () => {
          if (!alive) return;
          await persistAuthStore(pb);
          setUser(pb.authStore.isValid ? pb.authStore.model : null);
        });
        if (alive) setUser(pb.authStore.isValid ? pb.authStore.model : null);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    const tickInterval = setInterval(() => setTick((t) => t + 1), 60000);

    return () => {
      alive = false;
      clearInterval(tickInterval);
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
          await upsertCloudState(resolution.state);
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
    return () => { alive = false; };
  }, [user, localDataKey]);

  useEffect(() => {
    if (!user || !syncReady || !localDataKey) return;
    AsyncStorage.setItem(localDataKey, JSON.stringify(tracker)).catch(() => {});
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => upsertCloudState(tracker), 700);
  }, [tracker, user, syncReady, localDataKey]);

  const liveMins = useMemo(() => {
    if (!activeCheckIn) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(activeCheckIn).getTime()) / 60000));
  // tick keeps this fresh every minute while checked in
  }, [activeCheckIn, tick]);

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
    const y = calViewYear;
    const m = calViewMonth;
    const presentDates = new Set(
      sessions
        .filter((s) => { const d = new Date(s.date); return d.getFullYear() === y && d.getMonth() === m; })
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
    // sessions indexed by date for tap-to-view
    const sessionsByDate = {};
    sessions.forEach((s) => {
      if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
      sessionsByDate[s.date].push(s);
    });
    // month stats for the viewed month
    const monthSessions = sessions.filter((s) => {
      const d = new Date(s.checkIn);
      return d.getFullYear() === y && d.getMonth() === m;
    });
    const viewMonthDaysPresent = new Set(monthSessions.map((s) => s.date)).size;
    const viewMonthMinutes = monthSessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    return { presentDates, leaveDates, sessionsByDate, viewMonthDaysPresent, viewMonthMinutes };
  }, [sessions, leaveEntries, calViewYear, calViewMonth]);

  const handleSignIn = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    await pbRef.current.collection('users').authWithPassword(normalizedEmail, password);
    setPassword('');
    setConfirmPassword('');
    // throws on failure — caught by AuthScreen.handleSubmit
  };

  const handleSignUp = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    const cleanTimezone = timezone.trim() || 'Asia/Kolkata';
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
    // throws on failure — caught by AuthScreen.handleSubmit
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
    if (!cleanName) { setProfileError('Name cannot be empty.'); return; }
    setProfileError('');
    try {
      const updated = await pbRef.current.collection('users').update(user.id, { name: cleanName, timezone: cleanTimezone });
      pbRef.current.authStore.save(pbRef.current.authStore.token, { ...user, ...updated });
      setUser((prev) => ({ ...prev, name: cleanName, timezone: cleanTimezone }));
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch {
      setProfileError('Failed to save. Check your connection.');
    }
  };

  const checkIn = () => {
    if (activeCheckIn) return;
    updateTracker((prev) => ({ ...prev, activeCheckIn: new Date().toISOString() }));
  };

  const checkOut = () => {
    if (!activeCheckIn) return;
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
    updateTracker((prev) => ({ ...prev, sessions: [newSession, ...prev.sessions], activeCheckIn: null }));
  };

  const addLeave = () => {
    const errs = {};
    if (!validateIsoDate(leaveStart)) errs.leaveStart = 'Use YYYY-MM-DD format.';
    if (!validateIsoDate(leaveEnd)) errs.leaveEnd = 'Use YYYY-MM-DD format.';
    const diffDays = validateIsoDate(leaveStart) && validateIsoDate(leaveEnd)
      ? daysBetweenInclusive(leaveStart, leaveEnd)
      : null;
    if (!errs.leaveStart && !errs.leaveEnd && !diffDays) errs.leaveEnd = 'End must be on or after start date.';
    setLeaveErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const record = {
      id: `${Date.now()}`,
      type: leaveType,
      startDate: leaveStart,
      endDate: leaveEnd,
      days: diffDays,
      reason: sanitizeReason(leaveReason)
    };
    updateTracker((prev) => ({ ...prev, leaveEntries: [record, ...prev.leaveEntries] }));
    setLeaveReason('');
  };

  const removeLeave = (id) => {
    updateTracker((prev) => ({ ...prev, leaveEntries: prev.leaveEntries.filter((l) => l.id !== id) }));
  };

  const shiftMonth = (delta) => {
    setSelectedDay(null);
    setCalViewMonth((m) => {
      const newM = m + delta;
      if (newM < 0) { setCalViewYear((y) => y - 1); return 11; }
      if (newM > 11) { setCalViewYear((y) => y + 1); return 0; }
      return newM;
    });
  };

  const resetToday = () => {
    Alert.alert(
      'Reset Today',
      'This will remove all check-ins and sessions recorded today. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            updateTracker((prev) => ({
              ...prev,
              activeCheckIn: null,
              sessions: prev.sessions.filter((s) => s.date !== today)
            }));
          }
        }
      ]
    );
  };

  const pickProfilePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      const uri = result.assets[0].uri;
      setProfilePhoto(uri);
      try {
        const formData = new FormData();
        formData.append('avatar', { uri, type: 'image/jpeg', name: 'avatar.jpg' });
        await pbRef.current.collection('users').update(user.id, formData);
        const refreshed = { ...user, avatar: uri };
        pbRef.current.authStore.save(pbRef.current.authStore.token, refreshed);
        setUser((prev) => ({ ...prev, avatar: uri }));
      } catch {
        Alert.alert('Upload Failed', 'Photo saved locally but could not sync to cloud. It will show on this device only.');
      }
    }
  };

  if (booting) {
    return (
      <View style={styles.centered}>
        <Text style={styles.bootText}>⏱ Loading...</Text>
      </View>
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
        setBusy={setAuthBusy}
      />
    );
  }

  const monthCells = monthDays(now.getFullYear(), now.getMonth());

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerText}>{TAB_ICONS[tab]} {tab}</Text>
          <Text style={styles.headerSub}>Hi, {user.name || user.email}</Text>
        </View>
        <View style={[styles.syncBadge, { backgroundColor: SYNC_COLORS[syncStatus] + '22' }]}>
          <Text style={[styles.syncBadgeText, { color: SYNC_COLORS[syncStatus] }]}>
            {SYNC_LABELS[syncStatus]}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {tab === 'Dashboard' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Today's Status</Text>
              <View style={styles.rowTwo}>
                <View style={styles.timeBox}>
                  <Text style={styles.timeBoxLabel}>Check In</Text>
                  <Text style={styles.timeBoxValue}>
                    {todaySummary.first ? formatDate(todaySummary.first, true).split(' ').slice(1).join(' ') : '—'}
                  </Text>
                </View>
                <View style={styles.timeBox}>
                  <Text style={styles.timeBoxLabel}>Check Out</Text>
                  <Text style={styles.timeBoxValue}>
                    {todaySummary.last ? formatDate(todaySummary.last, true).split(' ').slice(1).join(' ') : '—'}
                  </Text>
                </View>
              </View>
              <View style={styles.workedBox}>
                <Text style={styles.workedIcon}>⏳</Text>
                <Text style={styles.workedText}>{minutesToDisplay(todaySummary.minutes)} worked today</Text>
              </View>
              <View style={styles.rowTwo}>
                <Pressable
                  style={({ pressed }) => [
                    styles.checkBtn,
                    { backgroundColor: activeCheckIn ? '#8ba6d6' : '#3aaa52' },
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={checkIn}
                  disabled={!!activeCheckIn}
                >
                  <Text style={styles.checkBtnIcon}>▶</Text>
                  <Text style={styles.btnText}>Check In</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.checkBtn,
                    { backgroundColor: !activeCheckIn ? '#8ba6d6' : '#d14a3f' },
                    pressed && { opacity: 0.8 }
                  ]}
                  onPress={checkOut}
                  disabled={!activeCheckIn}
                >
                  <Text style={styles.checkBtnIcon}>■</Text>
                  <Text style={styles.btnText}>Check Out</Text>
                </Pressable>
              </View>
              {activeCheckIn && (
                <Text style={styles.liveIndicator}>● Live session — {minutesToDisplay(liveMins)} elapsed</Text>
              )}
              <Pressable style={styles.resetBtn} onPress={resetToday}>
                <Text style={styles.resetBtnText}>↺ Reset Today's Data</Text>
              </Pressable>
            </View>

            <View style={styles.rowTwo}>
              <View style={[styles.statCard, { borderTopColor: '#3778e6' }]}>
                <Text style={styles.statValue}>{monthSummary.daysPresent}</Text>
                <Text style={styles.statLabel}>Days Present</Text>
                <Text style={styles.statSub}>this month</Text>
              </View>
              <View style={[styles.statCard, { borderTopColor: '#3aaa52' }]}>
                <Text style={styles.statValue}>{(monthSummary.totalMinutes / 60).toFixed(1)}h</Text>
                <Text style={styles.statLabel}>Total Hours</Text>
                <Text style={styles.statSub}>this month</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave Balance</Text>
              <Text style={styles.fyLabel}>FY {fy.label}</Text>
              <View style={styles.leaveRow}>
                <Text style={styles.leaveTypeTag}>CL</Text>
                <View style={styles.leaveBarWrap}>
                  <ProgressBar used={leaveSummary.clUsed} total={CL_ENTITLEMENT} color="#3778e6" />
                </View>
                <Text style={styles.leaveCount}>{leaveSummary.clLeft}/{CL_ENTITLEMENT}</Text>
              </View>
              <View style={styles.leaveRow}>
                <Text style={[styles.leaveTypeTag, { backgroundColor: '#e8f7ed', color: '#2f8a3a' }]}>PL</Text>
                <View style={styles.leaveBarWrap}>
                  <ProgressBar used={leaveSummary.plUsed} total={PL_ENTITLEMENT} color="#3aaa52" />
                </View>
                <Text style={styles.leaveCount}>{leaveSummary.plLeft}/{PL_ENTITLEMENT}</Text>
              </View>
            </View>
          </>
        )}

        {tab === 'Calendar' && (() => {
          const calCells = monthDays(calViewYear, calViewMonth);
          const calMonthName = new Date(calViewYear, calViewMonth, 1).toLocaleString('default', { month: 'long' });
          const isCurrentMonth = calViewYear === now.getFullYear() && calViewMonth === now.getMonth();
          const selectedSessions = selectedDay ? (calendarState.sessionsByDate[selectedDay] || []) : [];
          const selectedIsLeave = selectedDay && calendarState.leaveDates.has(selectedDay);
          const workDaysInMonth = calCells.filter((d) => {
            if (!d) return false;
            const dow = new Date(calViewYear, calViewMonth, d).getDay();
            return dow !== 0 && dow !== 6;
          }).length;
          const attendancePct = workDaysInMonth > 0
            ? Math.round((calendarState.viewMonthDaysPresent / workDaysInMonth) * 100)
            : 0;

          return (
            <>
              <View style={styles.card}>
                {/* Month navigation */}
                <View style={styles.calNavRow}>
                  <Pressable style={styles.calNavBtn} onPress={() => shiftMonth(-1)}>
                    <Text style={styles.calNavArrow}>‹</Text>
                  </Pressable>
                  <Text style={styles.calNavTitle}>{calMonthName} {calViewYear}</Text>
                  <Pressable style={styles.calNavBtn} onPress={() => shiftMonth(1)}>
                    <Text style={styles.calNavArrow}>›</Text>
                  </Pressable>
                </View>

                {/* Week labels */}
                <View style={styles.weekRow}>
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
                    <Text key={i} style={styles.weekLabel}>{w}</Text>
                  ))}
                </View>

                {/* Calendar grid */}
                <View style={styles.grid}>
                  {calCells.map((d, idx) => {
                    if (!d) return <View key={`e${idx}`} style={styles.dayCell} />;
                    const date = new Date(calViewYear, calViewMonth, d).toISOString().slice(0, 10);
                    const isToday = isCurrentMonth && date === today;
                    const isLeave = calendarState.leaveDates.has(date);
                    const isPresent = calendarState.presentDates.has(date);
                    const isSelected = selectedDay === date;
                    return (
                      <Pressable
                        key={date}
                        style={[
                          styles.dayCell,
                          isToday && styles.todayCell,
                          isSelected && !isToday && styles.selectedCell
                        ]}
                        onPress={() => setSelectedDay(isSelected ? null : date)}
                      >
                        <Text style={[styles.dayText, isToday && styles.todayText, isSelected && !isToday && styles.selectedDayText]}>{d}</Text>
                        {(isPresent || isLeave) && (
                          <View style={[styles.dot, isLeave ? styles.orange : styles.green]} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>

                {/* Legend */}
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.dot, styles.green, { marginTop: 0 }]} />
                    <Text style={styles.legendText}>Present</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.dot, styles.orange, { marginTop: 0 }]} />
                    <Text style={styles.legendText}>Leave</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={styles.todayDot} />
                    <Text style={styles.legendText}>Today</Text>
                  </View>
                </View>
              </View>

              {/* Selected day detail */}
              {selectedDay && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>
                    {new Date(selectedDay + 'T00:00:00').toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </Text>
                  {selectedIsLeave && (
                    <View style={styles.dayDetailLeave}>
                      <Text style={styles.dayDetailLeaveText}>🌿 Leave day</Text>
                    </View>
                  )}
                  {selectedSessions.length === 0 && !selectedIsLeave && (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyIcon}>📋</Text>
                      <Text style={styles.emptyText}>No sessions recorded</Text>
                    </View>
                  )}
                  {selectedSessions.map((s, i) => (
                    <View key={s.id} style={styles.daySessionRow}>
                      <Text style={styles.daySessionNum}>#{i + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.daySessionTime}>
                          {formatDate(s.checkIn, true).split(' ').slice(1).join(' ')} → {formatDate(s.checkOut, true).split(' ').slice(1).join(' ')}
                        </Text>
                        <Text style={styles.daySessionDur}>{minutesToDisplay(s.durationMinutes)}</Text>
                      </View>
                    </View>
                  ))}
                  {selectedSessions.length > 0 && (
                    <View style={styles.daySessionTotal}>
                      <Text style={styles.daySessionTotalText}>
                        Total: {minutesToDisplay(selectedSessions.reduce((s, x) => s + x.durationMinutes, 0))}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Month stats */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {calMonthName} {calViewYear} Summary
                </Text>
                <View style={styles.rowTwo}>
                  <View style={[styles.statCard, { borderTopColor: '#3778e6' }]}>
                    <Text style={styles.statValue}>{calendarState.viewMonthDaysPresent}</Text>
                    <Text style={styles.statLabel}>Days Present</Text>
                  </View>
                  <View style={[styles.statCard, { borderTopColor: '#3aaa52' }]}>
                    <Text style={styles.statValue}>{(calendarState.viewMonthMinutes / 60).toFixed(1)}h</Text>
                    <Text style={styles.statLabel}>Hours Worked</Text>
                  </View>
                </View>
                <View style={styles.leaveRow}>
                  <Text style={styles.attendanceLabel}>Attendance</Text>
                  <View style={styles.leaveBarWrap}>
                    <ProgressBar used={calendarState.viewMonthDaysPresent} total={Math.max(1, workDaysInMonth)} color={attendancePct >= 80 ? '#3aaa52' : attendancePct >= 50 ? '#ef9d34' : '#d14a3f'} />
                  </View>
                  <Text style={styles.leaveCount}>{attendancePct}%</Text>
                </View>
              </View>
            </>
          );
        })()}

        {tab === 'Leaves' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave Balance</Text>
              <Text style={styles.fyLabel}>FY {fy.label}</Text>
              <View style={styles.leaveRow}>
                <Text style={styles.leaveTypeTag}>CL</Text>
                <View style={styles.leaveBarWrap}>
                  <ProgressBar used={leaveSummary.clUsed} total={CL_ENTITLEMENT} color="#3778e6" />
                </View>
                <Text style={styles.leaveCount}>{leaveSummary.clLeft} left</Text>
              </View>
              <View style={styles.leaveRow}>
                <Text style={[styles.leaveTypeTag, { backgroundColor: '#e8f7ed', color: '#2f8a3a' }]}>PL</Text>
                <View style={styles.leaveBarWrap}>
                  <ProgressBar used={leaveSummary.plUsed} total={PL_ENTITLEMENT} color="#3aaa52" />
                </View>
                <Text style={styles.leaveCount}>{leaveSummary.plLeft} left</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Add Leave</Text>
              <View style={styles.toggleRow}>
                {['CL', 'PL'].map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.toggleBtn, leaveType === t && styles.toggleBtnActive]}
                    onPress={() => setLeaveType(t)}
                  >
                    <Text style={[styles.toggleBtnText, leaveType === t && styles.toggleBtnTextActive]}>{t}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Start Date</Text>
              <TextInput
                value={leaveStart}
                onChangeText={(v) => { setLeaveStart(autoFormatDate(v)); setLeaveErrors((e) => ({ ...e, leaveStart: '' })); }}
                style={[styles.input, leaveErrors.leaveStart && styles.inputError]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#8fabc7"
                keyboardType="numeric"
                maxLength={10}
              />
              <FieldError msg={leaveErrors.leaveStart} />

              <Text style={styles.label}>End Date</Text>
              <TextInput
                value={leaveEnd}
                onChangeText={(v) => { setLeaveEnd(autoFormatDate(v)); setLeaveErrors((e) => ({ ...e, leaveEnd: '' })); }}
                style={[styles.input, leaveErrors.leaveEnd && styles.inputError]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#8fabc7"
                keyboardType="numeric"
                maxLength={10}
              />
              <FieldError msg={leaveErrors.leaveEnd} />

              <Text style={styles.label}>Reason (optional)</Text>
              <TextInput
                value={leaveReason}
                onChangeText={setLeaveReason}
                style={[styles.input, { minHeight: 60 }]}
                placeholder="Brief reason for leave"
                placeholderTextColor="#8fabc7"
                multiline
                maxLength={250}
              />

              <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]} onPress={addLeave}>
                <Text style={styles.btnText}>+ Save Leave</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Leave History</Text>
              {leaveEntries.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🌿</Text>
                  <Text style={styles.emptyText}>No leave records yet</Text>
                </View>
              )}
              {leaveEntries.slice(0, 12).map((l) => (
                <View key={l.id} style={styles.historyItem}>
                  <View style={styles.historyHeader}>
                    <Text style={[styles.leaveTypeTag, l.type === 'PL' && { backgroundColor: '#e8f7ed', color: '#2f8a3a' }]}>
                      {l.type}
                    </Text>
                    <Text style={styles.historyDays}>{l.days} day{l.days !== 1 ? 's' : ''}</Text>
                    <Pressable onPress={() => removeLeave(l.id)} style={styles.deleteBtn}>
                      <Text style={styles.deleteText}>✕</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.historyDates}>{l.startDate} → {l.endDate}</Text>
                  {!!l.reason && <Text style={styles.historyReason}>{l.reason}</Text>}
                </View>
              ))}
            </View>
          </>
        )}

        {tab === 'Settings' && (
          <>
            <View style={styles.card}>
              <View style={styles.avatarRow}>
                <Pressable onPress={pickProfilePhoto} style={styles.avatarWrap}>
                  {profilePhoto || user.avatar ? (
                    <Image
                      source={{ uri: profilePhoto || user.avatar }}
                      style={styles.avatarImage}
                    />
                  ) : (
                    <View style={styles.avatarCircle}>
                      <Text style={styles.avatarText}>{(user.name || user.email || 'U')[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.avatarEditBadge}>
                    <Text style={styles.avatarEditIcon}>📷</Text>
                  </View>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileName}>{user.name || user.email}</Text>
                  <Text style={styles.profileEmail}>{user.email}</Text>
                  <Text style={styles.avatarHint}>Tap photo to change</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Profile</Text>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                value={profileName}
                onChangeText={setProfileName}
                style={styles.input}
                maxLength={80}
                placeholderTextColor="#8fabc7"
              />
              <Text style={styles.label}>Timezone</Text>
              <TextInput
                value={profileTimezone}
                onChangeText={setProfileTimezone}
                style={styles.input}
                maxLength={80}
                placeholderTextColor="#8fabc7"
              />
              {!!profileError && <Text style={styles.fieldError}>{profileError}</Text>}
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                onPress={handleProfileSave}
              >
                <Text style={styles.btnText}>{profileSaved ? '✓ Saved!' : 'Save Profile'}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Security</Text>
              <Text style={styles.secNote}>🔒 Passwords are never stored in plain AsyncStorage.</Text>
              <Text style={styles.secNote}>🛡 Session token is stored in device SecureStore.</Text>
              <Text style={styles.secNote}>☁ Cloud data is private to your account only.</Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.8 }]}
              onPress={handleLogout}
            >
              <Text style={styles.logoutText}>Sign Out</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <View style={styles.tabBar}>
        {['Dashboard', 'Calendar', 'Leaves', 'Settings'].map((t) => (
          <TabButton key={t} label={t} icon={TAB_ICONS[t]} isActive={tab === t} onPress={() => setTab(t)} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ── Global ──────────────────────────────────────────────
  container: { flex: 1, backgroundColor: '#f0f4f9', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f2d6b' },
  bootText: { color: '#fff', fontSize: 20, fontWeight: '600' },

  // ── Auth ────────────────────────────────────────────────
  authBg: { flex: 1, backgroundColor: '#0f2d6b' },
  authContent: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 10, flexGrow: 1, justifyContent: 'center' },
  authLogoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8, marginTop: 10 },
  authAppIcon: { fontSize: 28, marginRight: 8 },
  authAppName: { fontSize: 26, fontWeight: '800', color: '#ffffff', letterSpacing: 0.5 },
  authAnimationWrap: { alignItems: 'center', marginBottom: 0 },
  authAnimation: { width: SCREEN_W * 0.75, height: SCREEN_W * 0.5 },
  authCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10
  },
  authTitle: { fontSize: 28, fontWeight: '800', color: '#0f2d6b', textAlign: 'center', marginBottom: 4 },
  authSubTitle: { textAlign: 'center', color: '#6b84a0', marginBottom: 20, fontSize: 14 },

  // ── Form fields ─────────────────────────────────────────
  label: { color: '#3a5068', marginBottom: 6, fontSize: 14, fontWeight: '600', marginTop: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: '#d0dcea',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f7fafd',
    fontSize: 15,
    color: '#1a2c46'
  },
  inputError: { borderColor: '#d14a3f' },
  inputFlex: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#d0dcea',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f7fafd',
    fontSize: 15,
    color: '#1a2c46',
    marginBottom: 0
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  eyeBtn: { paddingHorizontal: 10, paddingVertical: 10 },
  eyeIcon: { fontSize: 18 },
  fieldError: { color: '#d14a3f', fontSize: 12, marginBottom: 4, marginTop: 2 },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, marginBottom: 2 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontWeight: '700', marginLeft: 4 },

  // ── Buttons ─────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: '#3778e6',
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    shadowColor: '#3778e6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6
  },
  disabledBtn: { opacity: 0.6, shadowOpacity: 0 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { marginTop: 14, padding: 6, alignItems: 'center' },
  secondaryText: { color: '#4d6480', fontSize: 14 },
  secondaryLink: { color: '#3778e6', fontWeight: '700' },

  // ── Header ──────────────────────────────────────────────
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2eaf3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  headerText: { fontSize: 22, fontWeight: '800', color: '#0f2d6b' },
  headerSub: { fontSize: 13, color: '#6b84a0', marginTop: 2 },
  syncBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  syncBadgeText: { fontSize: 12, fontWeight: '700' },

  // ── Content ─────────────────────────────────────────────
  content: { padding: SCREEN_W * 0.035, paddingBottom: 110 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#0f2d6b', marginBottom: 12 },

  // ── Dashboard ───────────────────────────────────────────
  rowTwo: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  timeBox: {
    flex: 1,
    backgroundColor: '#f0f5ff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center'
  },
  timeBoxLabel: { fontSize: 12, color: '#6b84a0', fontWeight: '600', marginBottom: 4 },
  timeBoxValue: { fontSize: Math.min(18, SCREEN_W * 0.045), fontWeight: '800', color: '#0f2d6b' },
  workedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f7ed',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12
  },
  workedIcon: { fontSize: 18, marginRight: 8 },
  workedText: { fontSize: 16, fontWeight: '700', color: '#2f8a3a' },
  checkBtn: {
    flex: 1,
    borderRadius: 30,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4
  },
  checkBtnIcon: { color: '#fff', fontSize: 12 },
  liveIndicator: { textAlign: 'center', color: '#d14a3f', fontSize: 12, fontWeight: '600', marginTop: 8 },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3
  },
  statValue: { fontSize: Math.min(40, SCREEN_W * 0.09), fontWeight: '800', color: '#0f2d6b' },
  statLabel: { fontSize: Math.min(14, SCREEN_W * 0.035), fontWeight: '700', color: '#3a5068', marginTop: 2 },
  statSub: { fontSize: 11, color: '#8fabc7', marginTop: 2 },

  // ── Leave progress ───────────────────────────────────────
  fyLabel: { fontSize: 12, color: '#8fabc7', fontWeight: '600', marginBottom: 10, marginTop: -6 },
  leaveRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  leaveTypeTag: {
    backgroundColor: '#eaf0fb',
    color: '#1e5bc4',
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 32,
    textAlign: 'center'
  },
  leaveBarWrap: { flex: 1 },
  progressTrack: { height: 8, backgroundColor: '#e8edf5', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  leaveCount: { fontSize: 13, fontWeight: '700', color: '#3a5068', minWidth: 44, textAlign: 'right' },

  // ── Calendar ─────────────────────────────────────────────
  calNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calNavBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  calNavArrow: { fontSize: 22, color: '#3778e6', fontWeight: '700' },
  calNavTitle: { fontSize: 17, fontWeight: '800', color: '#0f2d6b' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  weekLabel: { width: '14.2%', textAlign: 'center', color: '#8fabc7', fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.2%', height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  todayCell: { backgroundColor: '#0f2d6b' },
  selectedCell: { backgroundColor: '#e8f0fd', borderWidth: 1.5, borderColor: '#3778e6' },
  dayText: { color: '#213a5c', fontSize: 14, fontWeight: '600' },
  todayText: { color: '#ffffff', fontWeight: '800' },
  selectedDayText: { color: '#3778e6', fontWeight: '800' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  green: { backgroundColor: '#3aaa52' },
  orange: { backgroundColor: '#ef9d34' },
  legendRow: { flexDirection: 'row', gap: 16, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f0f4f9' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontSize: 12, color: '#6b84a0' },
  todayDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#0f2d6b' },
  dayDetailLeave: { backgroundColor: '#fff8ec', borderRadius: 10, padding: 10, marginBottom: 8 },
  dayDetailLeaveText: { color: '#b87700', fontWeight: '700', fontSize: 14 },
  daySessionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f4f9' },
  daySessionNum: { fontSize: 13, fontWeight: '700', color: '#8fabc7', minWidth: 24 },
  daySessionTime: { fontSize: 13, color: '#3a5068', fontWeight: '600' },
  daySessionDur: { fontSize: 12, color: '#3aaa52', fontWeight: '700', marginTop: 2 },
  daySessionTotal: { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e8edf5', marginTop: 4, alignItems: 'flex-end' },
  daySessionTotalText: { fontSize: 14, fontWeight: '800', color: '#0f2d6b' },
  attendanceLabel: { fontSize: 13, fontWeight: '700', color: '#3a5068', minWidth: 80 },

  // ── Leaves tab ───────────────────────────────────────────
  toggleRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 30,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#d0dcea',
    backgroundColor: '#f7fafd'
  },
  toggleBtnActive: { backgroundColor: '#3778e6', borderColor: '#3778e6' },
  toggleBtnText: { fontWeight: '700', color: '#6b84a0', fontSize: 15 },
  toggleBtnTextActive: { color: '#fff' },
  historyItem: {
    borderTopWidth: 1,
    borderTopColor: '#f0f4f9',
    paddingTop: 10,
    marginTop: 8
  },
  historyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  historyDays: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0f2d6b' },
  deleteBtn: { padding: 4 },
  deleteText: { color: '#d14a3f', fontWeight: '700', fontSize: 14 },
  historyDates: { fontSize: 13, color: '#6b84a0', marginBottom: 2 },
  historyReason: { fontSize: 13, color: '#3a5068', fontStyle: 'italic' },
  emptyState: { alignItems: 'center', paddingVertical: 24 },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: { color: '#8fabc7', fontSize: 15, fontWeight: '600' },

  // ── Reset today ───────────────────────────────────────────
  resetBtn: { marginTop: 10, paddingVertical: 8, alignItems: 'center' },
  resetBtnText: { color: '#8fabc7', fontSize: 13, fontWeight: '600' },

  // ── Settings ─────────────────────────────────────────────
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { position: 'relative' },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0f2d6b',
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarImage: { width: 72, height: 72, borderRadius: 36 },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3
  },
  avatarEditIcon: { fontSize: 14 },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  profileName: { fontSize: 18, fontWeight: '800', color: '#0f2d6b' },
  profileEmail: { fontSize: 13, color: '#6b84a0', marginTop: 2 },
  avatarHint: { fontSize: 11, color: '#8fabc7', marginTop: 4 },
  secNote: { color: '#3a5068', fontSize: 14, marginBottom: 8 },
  logoutBtn: {
    backgroundColor: '#fff2f2',
    borderWidth: 1.5,
    borderColor: '#d14a3f',
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12
  },
  logoutText: { color: '#d14a3f', fontWeight: '800', fontSize: 16 },

  // ── Tab bar ──────────────────────────────────────────────
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2eaf3',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 10
  },
  tabButton: { flex: 1, paddingVertical: 10, alignItems: 'center', position: 'relative' },
  tabIcon: { fontSize: 20, marginBottom: 2 },
  tabText: { color: '#8fabc7', fontWeight: '600', fontSize: 11 },
  tabTextActive: { color: '#0f2d6b', fontWeight: '800' },
  tabIndicator: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#3778e6'
  }
});
