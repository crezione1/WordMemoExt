# Manual local-extension testing

This workflow loads the extension locally while using the deployed LazyLex site and Firebase backend. The landing site and backend do not need to run on the tester's machine.

## Build

Requirements: Node.js 18 or newer and Chrome.

```powershell
npm run check
npm test
npm run build:local
```

The unpacked extension is generated at:

```text
dist/lazylex-local
```

The build contains only extension runtime files. It excludes repository metadata, development servers, Firebase deployment source, runtime configuration artifacts, and dependencies.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Remove or disable another LazyLex/WordMemo development build to avoid testing the wrong copy.
4. Select **Load unpacked**.
5. Choose `dist/lazylex-local`.
6. Pin **LazyLex (Local QA)** to the toolbar.
7. Copy the displayed extension id into the test notes.

Loading the unpacked directory for the first time opens `onboarding.html`. To retest
that install flow after a rebuild, remove the local extension and load the same
directory again. Chrome's **Reload** action uses the update flow and does not reopen
onboarding automatically.

`npm run build:local` uses the dedicated **LazyLex Local QA Extension** OAuth
client. A Chrome Extension OAuth client is bound to one exact extension id; using a
client registered for a different id makes Chrome reject the request before Firebase
is reached.

For the current local QA build, the observed unpacked extension id is:

```text
dechoakhakinenghbdgpefpigpfibhle
```

The dedicated client in Google Cloud project `lazylex-9d161` is registered for
that exact item id. Rebuild it with:

```powershell
npm run build:local
```

If Chrome assigns a different id after the extension is reloaded, register that
displayed id with a separate Chrome Extension OAuth client. Then build once with:

```powershell
npm run build:local -- --oauth-client-id=YOUR_REGISTERED_CLIENT_ID
```

If the OAuth registration uses a stable public extension key, it can also be supplied without committing it:

```powershell
npm run build:local -- --oauth-client-id=YOUR_REGISTERED_CLIENT_ID --extension-key=YOUR_PUBLIC_EXTENSION_KEY
```

## Smoke test

1. Open `https://lazylex.com` and confirm the landing page loads over HTTPS.
2. Open the extension popup and select **Sign in with Google**.
3. Complete Google consent and confirm the authenticated popup state appears.
4. Open a normal HTTPS article page.
5. Select an English word and save it.
6. Confirm a translated value appears rather than the original word fallback.
7. Open the popup dictionary and confirm the word is listed.
8. Edit the translation and reload the popup; confirm the change persists.
9. Delete the word and reload the popup; confirm it remains deleted.
10. Change the target language or highlighting settings and confirm the page responds.
11. Sign out, reopen the popup, and confirm authenticated data is no longer shown.

## Premium sentence selection (issue #28)

Note: the backend `translateSentence` callable described in
`crezione1/LazyLexFunctions#1` is not deployed yet as of this writing, so
steps 4+ below (the actual translate/save call) cannot be fully verified
until that backend work ships. Steps 1-3 (free-user gating) do not depend
on the backend and can be verified now.

1. As a **free** account, select a full sentence (roughly 6+ words, or any
   selection ending in `.`/`!`/`?`) on a normal webpage. Confirm a distinct
   "S+" control appears (not the usual "+" word button).
2. Click it. Confirm a "Sentence Saving is Premium" upsell appears and no
   network request to a translation endpoint is made (check the service
   worker's Network tab / console).
3. Confirm a short single-word or short-phrase selection still shows the
   normal "+" control and saves through the existing word flow unchanged.
4. As a **premium/lifetime** account (once the backend function is live),
   repeat step 1-2; confirm a loading state, then a saved-sentence
   confirmation, and that the sentence appears under the popup's
   "Sentences" tab (not mixed into "My Word List").
5. Select text longer than 500 characters as a premium account; confirm a
   length error appears and no network call is made.
6. Delete a saved sentence from the "Sentences" tab; confirm it is removed
   from Firestore (`users/{uid}/sentences/{id}`) as well as locally.
7. Sign out (or switch Google accounts) and confirm the "Sentences" tab no
   longer shows the previous account's sentences.

## Negative checks

1. Sign out and try to translate or sync. The extension must report an authentication failure and must not claim success.
2. In DevTools for the service worker, verify failed backend requests do not print access tokens, Firebase ID tokens, or word contents.
3. From a regular webpage console, post a message containing a fake `LAZYLEX_AUTH_FROM_WEBSITE` payload. The extension must ignore it.
4. Confirm all backend calls go only to the configured Firebase project and `europe-central2` Functions endpoint.

## Troubleshooting

- After every rebuild, select **Reload** on `chrome://extensions`.
- If an old extension tab still shows `ERR_FILE_NOT_FOUND`, close it; extension tabs
  opened before a reload are not redirected automatically.
- Inspect popup errors by right-clicking the popup and selecting **Inspect**.
- Inspect service-worker errors from the extension card on `chrome://extensions`.
- The popup now includes the current extension id when it detects an OAuth client/id mismatch. Register that exact id, rebuild with `--oauth-client-id`, and reload the unpacked extension.
- `No Firebase ID token` means Google sign-in succeeded but the Google-to-Firebase exchange did not. Check the service-worker console and Firebase Authentication's Google provider configuration.
