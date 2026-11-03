# StudyMate AI — Gemini + Groq automatic fallback

Premium Bangla + English admission-preparation tutor. Includes subject selection, AI chat, question-image upload, saved answers, local history, and installable PWA shell. Capacitor configuration is included for an Android wrapper.

## Automatic AI switching

The server tries Gemini first. If Gemini is rate-limited, quota-exhausted, temporarily unavailable, or has a network failure, it tries Groq automatically. Image questions use Gemini first and a Groq vision model as backup. If both providers are unavailable, the app shows a retry message. Free tiers are limited and are not unlimited service.

## Important security note

Create fresh API keys if any previous keys were shared or exposed. Store them only as server environment variables. Never put API keys in `public/`, browser JavaScript, an Android APK, or a public repository. Use spending limits/usage alerts where available.

## Run locally

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and enter newly created keys.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Android APK

This source bundle is not a compiled APK. A signed or installable APK requires Android SDK/Android Studio and a publicly reachable HTTPS backend. Do not embed the keys in the APK.

1. Deploy this Node server to an HTTPS host and set `GEMINI_API_KEY` and `GROQ_API_KEY` as server secrets.
2. Configure the app's API base URL for that backend (the current front-end uses same-origin `/api` routes).
3. Install Android Studio, Android SDK and JDK 17+.
4. Run `npm install`, `npx cap add android`, `npx cap sync android`, then open the Android project in Android Studio and build the APK.

For production, add user authentication, per-user rate limits, privacy notice, abuse protection, and server-side usage controls. Free provider quotas can change and may be exhausted; failover does not guarantee uninterrupted or unlimited answers.
