# LazyLex Chrome extension

LazyLex saves and translates vocabulary while the user browses. This branch contains a local-QA build connected to the deployed LazyLex stack:

- Landing site: `https://lazylex.com`
- Firebase project: `lazylex-9d161`
- Functions region: `europe-central2`

## Local QA build

```powershell
npm run check
npm test
npm run build:local
```

Load `dist/lazylex-local` from `chrome://extensions` using **Load unpacked**.

The build uses Chrome Identity for Google consent, exchanges the Google credential for a Firebase ID token, and accesses only the configured deployed Functions, Firestore, Firebase Authentication, and Google profile endpoints.

See [MANUAL_TESTING.md](MANUAL_TESTING.md) for the complete manual smoke test, OAuth extension-id setup, and troubleshooting.

## Configuration

Public deployed-environment identifiers are centralized in `extension-config.js`. Do not commit service-account keys, refresh tokens, access tokens, Firebase runtime configuration, or a tester-specific OAuth override.

The build accepts optional local OAuth registration values without changing source:

```powershell
npm run build:local -- --oauth-client-id=YOUR_REGISTERED_CLIENT_ID
```

## Firebase deployment source

The `firebase-functions` and `firebase-rules` directories mirror the currently deployed Firebase integration for recovery and review. They are intentionally excluded from the generated extension package. Firebase source ownership and supported-runtime migration are tracked separately in `crezione1/WordMemo#29` and `crezione1/WordMemo#30`.
