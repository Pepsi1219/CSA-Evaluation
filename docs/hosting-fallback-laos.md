# Firebase Hosting fallback for Laos

The current Vercel URL remains the primary address. The same Vite app is now available from the existing Firebase project at `https://ie-calc.web.app/` and `https://ie-calc.firebaseapp.com/`. This gives operators another hostname and delivery network if their connection cannot reach `*.vercel.app`. The app uses the existing Firebase Auth accounts and Firestore data.

On 2 October 2026, release `projects/339028977914/sites/ie-calc/versions/c17b92289fc1042b` was deployed from commit `3cea24c` (`origin/main`). The source was exported to a separate temporary directory and built with the existing ignored `.env` so the unrelated, uncommitted calculator edits in the working tree were not published. Before release, [three Globalping probes](https://api.globalping.io/v1/measurements/2rlYFsKGK9VxwjTMV00021F3j) in Vientiane (all on LaoDC/AS17804) reached `ie-calc.web.app` over valid HTTPS and received HTTP 404. After release, all three returned HTTP 200 for the [page](https://api.globalping.io/v1/measurements/21LFSYcaeWkrbaBn000021F3p), [JavaScript](https://api.globalping.io/v1/measurements/2Thx1brhDrsnQZTkK00021F3p), [CSS](https://api.globalping.io/v1/measurements/2yJsQGYvHmq4fTEM300021F3p), and [service worker](https://api.globalping.io/v1/measurements/2anhyambuHzjBznCb00021F3p). The [firebaseapp.com hostname](https://api.globalping.io/v1/measurements/2kkLGiPtXDVYa3wqK00021F3p) also returned HTTP 200 at all three probes. This confirms access from that LaoDC network at that time; the factory network has not been tested.

## Build and deployment

`firebase.json` selects only the existing `ie-calc` Hosting site and publishes `dist/`. It contains no Firestore or Auth deployment config. `.firebaserc` binds this checkout to the same project. `npm run build:hosting` checks that all six Firebase web configuration values are present and that the build points to `ie-calc`; it does not print their values.

Before publishing, review all local changes. The current working tree contains unrelated, uncommitted calculator edits, and a build includes them. The commands for a reviewed checkout are:

```powershell
npm test
npm run build:hosting
firebase deploy --project ie-calc --only hosting
```

`npm run build:hosting` reads the existing ignored `.env` locally; CI must provide the same `VITE_FIREBASE_*` variables securely. A normal `npm run build` still supports the repo's local-only development mode when the Firebase environment is absent.

The deployed `/`, generated `/assets/index-*.js` and `/assets/index-*.css`, `/sw.js`, and `/manifest.json` returned HTTP 200 with valid content types and the configured cache headers from a direct network check. A browser sign-in and Firestore read/write still need a real employee test account; those flows were not exercised by the network probes. If the Google Cloud Browser API key has HTTP referrer restrictions, include `https://ie-calc.web.app/*` and `https://ie-calc.firebaseapp.com/*` while preserving existing allowed origins. Check Firebase Auth authorized domains if authentication reports an unauthorized-domain error.

The app's service worker and localStorage are scoped to each origin. Existing cloud history and tutorial progress remain in the same Firebase project, while local unsynced data on the Vercel origin will not automatically move to the Firebase origin. A network that also blocks `web.app` or Google Firebase APIs will still require its IT/network operator to resolve those blocks.
