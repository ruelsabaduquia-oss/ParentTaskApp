# ParentTaskApp / MissionNest

MissionNest is a family mission and quiz app with separate parent, child, tutor,
and subscription administrator workflows. The Android apps bundle the web UI and
connect directly to Supabase; no hosted Django server is needed.

## Project Layout

- `missionnest_android/app`: family Android app and shared HTML/CSS/JavaScript UI.
- `missionnest_android/admin`: separate subscription administrator Android app.
- `missionnest_android/tests`: browser and PostgreSQL regression tests.
- `supabase`: MissionNest schema and incremental migrations.

This repository contains only the current MissionNest mobile project. The
inventory application and older Django prototype are intentionally excluded.

## Setup

See [Android setup and subscriptions](missionnest_android/README.md) for migration
order, family invitations, tutor permissions, and administrator setup.

Open `missionnest_android` in Android Studio. Configure your local Android SDK
using Android Studio or an untracked `local.properties` file. Build both test APKs:

```powershell
cd missionnest_android
.\gradlew.bat :app:assembleDebug :admin:assembleDebug
```

The Gradle wrapper requires a compatible Java installation. No signing keystore,
SDK paths, generated APKs, or local databases are committed.

## Browser Preview

With Node.js installed, run:

```powershell
node missionnest_android/preview.cjs
```

Family app: http://127.0.0.1:8088/

Admin app: http://127.0.0.1:8088/admin.html

Edit the UI directly in `missionnest_android/app/src/main/assets/www`. There is
no asset synchronization step from the inventory project.

## Tests

Install Playwright and PGlite in an external dependency directory, then expose
that directory's `node_modules` with `NODE_PATH`:

```powershell
node missionnest_android/tests/subscriptions.cjs
node missionnest_android/tests/subscription-ui.cjs
node missionnest_android/tests/family-access.cjs
node missionnest_android/tests/family-flow.cjs
```

Browser tests currently launch installed Microsoft Edge. `quiz-flow.cjs` also
accepts the path to the two-column question/answer CSV fixture used for quiz tests.

## Release Status

These are development/test builds, not a production or Play Store release.
The legacy child name/PIN authentication and anonymous data policies need
hardening before public distribution. Subscription notifications are in-app
while connected, not closed-app push notifications. GCash payments require
manual verification by the administrator.

The Supabase publishable key is client configuration, not an administrator
credential. Never commit a service-role key, account password, or signing key.
