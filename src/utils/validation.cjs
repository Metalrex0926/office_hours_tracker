const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  return EMAIL_RE.test(value);
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 10) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/\d/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

function sanitizeReason(reason) {
  return String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 250);
}

function validateIsoDate(dateInput) {
  const value = String(dateInput || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function daysBetweenInclusive(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) {
    return null;
  }
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

module.exports = {
  validateEmail,
  validatePassword,
  sanitizeReason,
  validateIsoDate,
  daysBetweenInclusive
};
