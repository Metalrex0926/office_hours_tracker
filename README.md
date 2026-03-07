# Office Hours Tracker (Personal Multi-Device)

Expo React Native app for personal office-hour tracking with:
- Email/password auth
- PocketBase cloud sync (Android + iOS for same user)
- Leave tracking (CL/PL)
- Profile setup
- Animated login/signup screens (Lottie)

## Node
Use Node 24:
```bash
nvm install 24
nvm use 24
```

## Install
```bash
npm install
```

## PocketBase Setup
1. Run PocketBase server.
2. Create collection `users` (PocketBase auth collection).
3. Add optional `timezone` text field to `users`.
4. Create collection `user_state` with fields:
   - `user` (relation -> `users`, required, unique)
   - `payload` (json or text, required)
   - `lastModified` (date or text)

### `user_state` API rules (privacy)
- List rule: `@request.auth.id != "" && user = @request.auth.id`
- View rule: `@request.auth.id != "" && user = @request.auth.id`
- Create rule: `@request.auth.id != "" && user = @request.auth.id`
- Update rule: `@request.auth.id != "" && user = @request.auth.id`
- Delete rule: `@request.auth.id != "" && user = @request.auth.id`

This keeps every user fully isolated (no manager/HR approvals, no cross-user access).

## Environment
Create `.env`:
```bash
EXPO_PUBLIC_POCKETBASE_URL=http://YOUR_IP:8090
```

Optional animation overrides:
```bash
EXPO_PUBLIC_LOGIN_LOTTIE_URL=https://...
EXPO_PUBLIC_SIGNUP_LOTTIE_URL=https://...
```

## LottieFiles Used
Auth screen defaults use LottieFiles CDN URLs configured in `App.js`:
- Login animation source page: https://lottiefiles.com/free-animation/login-QFhJRgQyEc
- Sign up animation source page: https://lottiefiles.com/free-animation/sign-up-YgekaOmwhu

If you want exact downloadable JSON from these pages, download and replace via env URLs above.

## Run
```bash
npm run start
```

## Tests
Validation/privacy-focused tests:
```bash
npm test
```

Covers:
- Email and password validation
- Leave date/range validation
- Input sanitization
- Sync-state normalization and conflict choice

## Security Notes
- Password is never stored in local AsyncStorage.
- Auth token/model is stored in `expo-secure-store`.
- Tracker data cache is per-user key.
- Cloud access depends on strict per-user PocketBase rules above.
