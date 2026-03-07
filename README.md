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

## PocketBase Setup (Detailed)
Use Admin UI: `http://127.0.0.1:8090/_/`

1. Sign in to PocketBase Admin.
2. Go to `Collections` -> `+ New collection`.
3. Create auth collection `users`:
   - Type: `Auth`
   - Name: `users`
   - Keep default auth fields (`email`, `password`)
4. In `users` -> `Fields` add:
   - `name` (text, required, min 2, max 80)
   - `timezone` (text, required, default `Asia/Kolkata`, max 80)
5. In `users` -> `API Rules` set:
   - List: `id = @request.auth.id`
   - View: `id = @request.auth.id`
   - Update: `id = @request.auth.id`
   - Delete: `id = @request.auth.id`
   - Create can remain default for signup from app.
6. Create `user_state` collection:
   - Type: `Base`
   - Name: `user_state`
7. In `user_state` -> `Fields` add:
   - `user` (relation -> `users`, max select 1, required, unique)
   - `payload` (JSON, required)
   - `lastModified` (date, required)
8. In `user_state` -> `API Rules` set all to:
   - List: `@request.auth.id != "" && user = @request.auth.id`
   - View: `@request.auth.id != "" && user = @request.auth.id`
   - Create: `@request.auth.id != "" && user = @request.auth.id`
   - Update: `@request.auth.id != "" && user = @request.auth.id`
   - Delete: `@request.auth.id != "" && user = @request.auth.id`
9. Save and test:
   - Sign up from app on Android.
   - Sign in with same account on iOS.
   - Add one leave/session on one device and verify it appears on the other device after sync.

This setup keeps data private per user and has no manager/HR approval flow.

### Import and Start (recommended)
You can keep a reusable schema export inside this repo:
- Folder: `pocketbase/`
- Guide: `pocketbase/README.md`
- Placeholder: `pocketbase/collections.template.json`
- Expected import file name: `pocketbase/collections.json`

Once `collections.json` exists, a new user can directly import from:
`Settings -> Import collections -> Load from JSON file`.

## Environment
Create `.env`:
```bash
EXPO_PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090
```

For physical Android/iOS devices, replace `127.0.0.1` with your computer LAN IP (example `192.168.1.10`) because phone localhost is not your laptop localhost.

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
