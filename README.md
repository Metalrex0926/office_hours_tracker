# Office Hours Tracker (Android + iOS)

React Native (Expo) app for:
- Check-in / check-out tracking
- Monthly attendance summary
- Leave tracking (CL/PL)
- PIN-based local security (no sign-up/login)

## Features
- `Dashboard`: today's status, worked hours, month summary, leave balance
- `Calendar`: month view with present/leave indicators
- `Leaves`: apply leave and view leave history
- `Settings`: policy, schedule, and PIN change
- `Security`: 4-digit PIN gate stored locally on device

## Leave policy configured
- Casual Leave (CL): 12/year
- Privilege Leave (PL): 15/year
- Fiscal year: April to March

## Run
0. Use Node 24 (required):
   ```bash
   nvm use
   ```
   If Node 24 is not installed:
   ```bash
   nvm install 24
   nvm use 24
   ```
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start app:
   ```bash
   npm run start
   ```
3. Open in Expo Go on Android/iOS by scanning the QR code.

## Notes
- No sign in or sign up is required.
- All data is stored locally using AsyncStorage.
