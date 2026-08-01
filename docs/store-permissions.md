# Chrome Web Store — permission justifications

Reference material for the Chrome Web Store submission form (LazyLex, manifest v3).
Each section below is written so it can be pasted more or less verbatim into the
matching field on the developer dashboard.

Every claim here was traced to a real call site in this repository. File and line
references are given so a reviewer — or the next person to fill in the form — can
check them rather than take them on trust.

---

## Single purpose

LazyLex helps a language learner build a personal vocabulary list from the pages they
already read: it saves words they select on any web page, translates them, and then
highlights those saved words the next time they appear anywhere on the web.

---

## Permission justifications

### `storage`

LazyLex stores the user's saved word list, saved sentences, translation target
language, highlight colours, per-site exclusions, and the cached Firebase session
token in `chrome.storage.local`. This is the extension's primary data store and the
feature does not work without it. Representative call sites: `background.js:147` and
`background.js:199` (persisting the session), `background.js:277`–`background.js:303`
(reading and writing the word list), `background.js:707`–`background.js:727` (saved
sentences), and `popup.js:525` (reading the per-site exclusion list).

### `contextMenus`

LazyLex adds a single right-click entry, `Save '%s'`, shown only when the user has
text selected. It is the primary way a user saves a word without opening the popup.
The menu item is registered at `background.js:960` with `contexts: ["selection"]`, and
its click handler at `background.js:967` forwards the selected text to the content
script for saving. No other context menu entries are created.

### `identity`

LazyLex uses Google sign-in so a user's vocabulary list syncs across their devices.
`chrome.identity.getAuthToken` at `firebase-auth.js:46` obtains a Google OAuth access
token, which is exchanged for a Firebase session (`firebase-auth.js:76`). On sign-out,
`chrome.identity.removeCachedAuthToken` at `firebase-auth.js:220` clears the cached
token so the next user of the machine does not inherit the session. The only scopes
requested are `openid`, `userinfo.email` and `userinfo.profile`.

### `tabs`

Two things require this permission:

1. **Broadcasting updates to already-open tabs.** When a word is saved or deleted, or
   when the user changes highlight settings, every open tab must be told to re-run its
   highlighting. `background.js:81` enumerates tabs with `chrome.tabs.query({})` and
   `background.js:90` messages each one; `options.js:102`–`options.js:105` does the same
   after a settings change.
2. **Reading the current tab's URL.** The popup shows whether LazyLex is enabled on the
   site the user is looking at, and lets them exclude that site. `popup.js:534` queries
   the active tab and `popup.js:539` reads its `url`. Reading `tab.url` requires either
   `tabs` or a host permission for that origin; `options.js:104` also reads `tab.url` in
   order to skip `chrome://` and `chrome-extension://` tabs, which cannot receive
   messages.

The extension also opens its own packaged onboarding page with `chrome.tabs.create`
(`background.js:116`, `background.js:1329`), which does not by itself require `tabs`.

### `activeTab`

Requested so that a user-initiated action — clicking the toolbar icon, or the
`Ctrl+Shift+S` command declared in the manifest — can act on the page the user is
currently viewing.

**Note for whoever fills in the form:** in the current code this permission is
effectively redundant. The content script is already injected declaratively into every
page, and the one place that reads the active tab's URL (`popup.js:534`) is covered by
the `tabs` permission. `activeTab` is low-risk and does not trigger a warning on
install, so keeping it is harmless, but it could be dropped without changing behaviour.
See "Unused permission" below for the one that genuinely should go.

---

## Unused permission — recommend removal

### `scripting` — **not used anywhere in shipped code**

`manifest.json` requests the `scripting` permission, but no shipped file calls
`chrome.scripting.executeScript`, `insertCSS`, `registerContentScripts`, or any other
member of that API. A repository-wide search for those identifiers returns exactly one
hit, in `chrome-mock.js:164` — and `chrome-mock.js` is a development stub that is not
referenced by any page or script and is **not** in the `runtimeFiles` list in
`scripts/build-extension.mjs`, so it is never copied into the packaged extension.

All content-script injection is declarative, via the `content_scripts` block in
`manifest.json:31`–`manifest.json:37`. Nothing is injected programmatically.

An unused permission is a common Chrome Web Store rejection reason, and `scripting`
combined with an `<all_urls>` content script reads as broader access than the extension
actually takes. **Recommendation: remove `"scripting"` from the `permissions` array
before submitting.** It has deliberately not been removed in this pull request, which
is scoped to documentation, so that the change can be made and smoke-tested on its own.

---

## Why we need broad host access (`<all_urls>` content script)

LazyLex's core feature is highlighting the user's saved vocabulary on whatever page
they happen to be reading, and letting them save a new word by selecting it anywhere.
A learner reads news sites, blogs, documentation, forums, PDFs rendered as HTML, and
YouTube pages — there is no fixed list of sites that would cover this, and any
allowlist we shipped would simply be the wrong list for most users. The content script
(`content.js`, declared at `manifest.json:31`–`manifest.json:37`) therefore matches
`<all_urls>`.

What the content script actually does on a page is narrow: it listens for text
selection (`content.js:1026`), wraps occurrences of the user's own saved words in
highlight spans (`content.js:604` onward), and listens for messages from the extension
telling it to refresh (`content.js:1213`, `content.js:1221`). It does not read or
transmit page content on its own initiative — nothing leaves the page unless the user
selects a word or sentence and asks to save or translate it. Users can also disable
LazyLex per-site from the popup, and excluded sites are skipped entirely.

**Worth stating explicitly on the form:** despite the broad content-script match, this
extension's `host_permissions` are a *narrow allowlist of our own backends only*:

```
https://europe-central2-lazylex-9d161.cloudfunctions.net/*
https://firestore.googleapis.com/*
https://identitytoolkit.googleapis.com/*
https://securetoken.googleapis.com/*
https://www.googleapis.com/*
```

Each is used and none is speculative:

| Host | Used for | Call site |
|---|---|---|
| `europe-central2-...cloudfunctions.net` | our own Cloud Functions: `translateWord`, `translateSentence` | `background.js:1051`, `background.js:764`, base URL at `extension-config.js:7` |
| `firestore.googleapis.com` | reading/writing the user's word list and subscription document | `background.js:131`, `subscription-manager.js:60` |
| `identitytoolkit.googleapis.com` | exchanging the Google token for a Firebase session | `firebase-auth.js:76`, `background.js:183` |
| `securetoken.googleapis.com` | refreshing the expired Firebase ID token | `firebase-auth.js:113`, `background.js:134` |
| `www.googleapis.com` | reading the signed-in user's email and profile | `firebase-auth.js:176` |

The extension cannot make requests to arbitrary origins. This is also enforced a second
time by the `connect-src` directive in the extension's Content Security Policy
(`manifest.json`, `content_security_policy.extension_pages`), which lists the same five
hosts and nothing else.

---

## Data-usage disclosures

These must describe what the extension actually does. Understating them is both a
policy violation and a GDPR problem.

**What is collected and transmitted:**

- **Text the user selects.** When the user saves or translates a word or a sentence,
  that text is sent to our Cloud Functions endpoint
  (`background.js:1051` for words, `background.js:764` for sentences). This is
  user-initiated only — LazyLex does not scrape or upload page content in the
  background.
- **Onward processing by third parties.** Our `translateWord` Cloud Function passes the
  submitted text to the **Google Cloud Translation API**, and to **OpenAI**
  (`gpt-4o-mini`) to generate synonyms and example sentences
  (`firebase-functions/index.js:86`–`index.js:106`). If the OpenAI call is unavailable
  or its response cannot be parsed, it falls back to the **Datamuse API**
  (`firebase-functions/index.js:146`). Translations are cached in a shared Firestore
  `translations` collection (`firebase-functions/index.js:62`).
- **Email address and basic profile.** Collected at sign-in for authentication and to
  key the user's synced word list (`firebase-auth.js:176`).
- **The user's saved vocabulary.** Stored locally in `chrome.storage.local` and synced
  to Firestore against the signed-in account.

**Category selections on the form:**

- Personally identifiable information — **yes** (email address).
- Authentication information — **yes** (Firebase session tokens).
- Website content — **yes** (text the user explicitly selects for saving/translation).
- Location, health, financial, personal communications, web history, user activity —
  **no**.

**Required certifications:** we do not sell or transfer user data to third parties
outside the approved use cases; we do not use or transfer user data for purposes
unrelated to the extension's single purpose; and we do not use or transfer user data to
determine creditworthiness or for lending purposes.

**Privacy policy URL** — still outstanding; blocked on the privacy sub-task of #35.

---

## Outstanding before submission

- [ ] Remove the unused `scripting` permission (see above).
- [ ] Publish a privacy policy and put its URL on the form.
- [ ] Confirm the OpenAI and Google Cloud Translation data flows are reflected in that
      privacy policy, not just here.
