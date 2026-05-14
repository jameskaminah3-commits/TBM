# Mobile App

This project uses Capacitor to package Bila Matata as an Android app without changing the existing Railway web deployment.

## Current Setup

- Android app id: `com.tembeabilamatata.app`
- App name: `Bila Matata`
- Native project: `android/`
- Capacitor config: `capacitor.config.ts`
- The native app currently loads `https://tembeabilamatata.com` through Capacitor, so the deployed web app remains the source of truth.

## Commands

```bash
npm run mobile:sync
npm run mobile:open:android
npm run mobile:run:android
```

`mobile:sync` builds the web app and syncs Capacitor assets/config into `android/`.

## Local Android Testing

When the production deployment is unavailable, run the local web/server app first:

```bash
npm run dev
```

Then sync the Android wrapper to load the local server from an Android emulator:

```bash
npm run mobile:sync:local:android
npm run mobile:open:android
```

The local Android script uses `http://10.0.2.2:5000`, which Android emulators map back to the host machine. For a physical Android phone, replace `CAPACITOR_SERVER_URL` with your computer's LAN URL, for example `http://192.168.1.20:5000`, and make sure the phone is on the same Wi-Fi network.

## Bundled App Option

The client also supports `VITE_API_BASE_URL` for a future bundled mobile build. When that value is set, `/api/...` fetch calls can be resolved against a production API domain instead of the local WebView origin.

For a fully bundled app with authenticated cross-origin API calls, the backend will also need explicit mobile CORS and cookie settings before that mode is enabled in production.

## iOS

iOS can be added with Capacitor on a macOS machine with Xcode installed.
