const ENV = "prod";

const config = {
    dev: {
        API_URL: "http://localhost:8080",
    },
    prod: {
        API_URL: "https://sea-lion-app-ut382.ondigitalocean.app",
    },
};

const API_URL = config[ENV].API_URL;

async function getCurrentUserInfo() {
    // Simulate a user object from local storage
    const { userInfo } = await chrome.storage.local.get(["userInfo"]);
    return userInfo || { email: "offline@user", telegramId: null };
}

async function getToken() {
    const result = await chrome.storage.local.get(["token"]);
    return result.token;
}

// Check if extension enabled/disabled for current site

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);

    return tab;
}

async function notifyContentAboutChanges(actionName, content) {
    const currentTab = await getCurrentTab();

    if (currentTab && currentTab.id) {
        try {
            await chrome.tabs.sendMessage(currentTab.id, {
                action: actionName,
                newValue: content,
            });
        } catch (error) {
            if (error.message.includes("Receiving end does not exist")) {
                console.log("Content script not available on this tab. Can be ignored.");
            } else {
                console.error("Error sending message to content script:", error);
            }
        }
    }
}

function notifyPopupAboutChanges(actionName, content) {
    chrome.runtime.sendMessage({
        action: actionName,
        newValue: content,
    });
}

// Handle onboarding redirect requests and tab closure
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'needOnboarding') {
        console.log('Opening onboarding from background...');
        chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
        return true;
    } else if (request.action === 'closeSelf') {
        console.log('Closing onboarding tab from background...');
        if (sender.tab && sender.tab.id) {
            chrome.tabs.remove(sender.tab.id);
        }
        return true;
    } else if (request.action === 'onboardingCompleted') {
        console.log('Onboarding completed notification received');
        return true;
    }
});

// Firebase ID token helpers (for backend integration)
const FIREBASE_API_KEY_BG = "AIzaSyDhSsOp7mkwf4NVeYIhk_RZZNaHpC0ZUho";
const FIREBASE_PROJECT_ID = "lazylex-9d161";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/lazylexdb/documents`;

async function refreshFirebaseIdTokenBg(refreshToken) {
    const url = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY_BG}`;
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    if (!res.ok) throw new Error(`refreshToken failed: ${res.status}`);
    const data = await res.json();
    const now = Date.now();
    const expiresInMs = (parseInt(data.expires_in || '3600') - 60) * 1000;
    await chrome.storage.local.set({
        firebase_id_token: data.id_token,
        firebase_refresh_token: data.refresh_token || refreshToken,
        firebase_token_exp: now + expiresInMs
    });
    return data.id_token;
}

async function getFirebaseIdTokenBg() {
    const state = await chrome.storage.local.get(['firebase_id_token','firebase_refresh_token','firebase_token_exp']);
    const now = Date.now();
    if (state.firebase_id_token && state.firebase_token_exp && now < state.firebase_token_exp) {
        return state.firebase_id_token;
    }
    if (state.firebase_refresh_token) {
        try { return await refreshFirebaseIdTokenBg(state.firebase_refresh_token); } catch (_) {}
    }
    return null;
}

// Derive the Firebase Auth UID from ID token claims; fallback to Google profile id if needed
async function getAuthUidBg() {
    try {
        const { firebase_id_token, userInfo } = await chrome.storage.local.get(['firebase_id_token','userInfo']);
        if (firebase_id_token) {
            const payload = JSON.parse(atob(firebase_id_token.split('.')[1]));
            if (payload && payload.user_id) return String(payload.user_id);
            if (payload && payload.sub) return String(payload.sub);
        }
        if (userInfo && (userInfo.uid || userInfo.id)) return String(userInfo.uid || userInfo.id);
    } catch (_) {}
    return null;
}

// Force an exchange from Google access token → Firebase ID token (background)
async function exchangeGoogleTokenForFirebaseIdTokenBg(googleAccessToken) {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY_BG}`;
    const body = {
        postBody: `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnIdpCredential: true,
        returnSecureToken: true
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`signInWithIdp failed: ${res.status}`);
    const data = await res.json();
    const now = Date.now();
    const expiresInMs = (parseInt(data.expiresIn || '3600') - 60) * 1000;
    await chrome.storage.local.set({
        firebase_id_token: data.idToken,
        firebase_refresh_token: data.refreshToken,
        firebase_token_exp: now + expiresInMs
    });
    return data.idToken;
}

// Ensure Firebase ID token exists if user already has a Google token
async function ensureFirebaseIdTokenReady() {
    try {
        const { auth_token, firebase_id_token, firebase_token_exp } = await chrome.storage.local.get([
            'auth_token','firebase_id_token','firebase_token_exp'
        ]);
        const now = Date.now();
        const hasValidFirebase = firebase_id_token && firebase_token_exp && now < firebase_token_exp;
        if (auth_token && !hasValidFirebase) {
            await exchangeGoogleTokenForFirebaseIdTokenBg(auth_token);
            console.log('[Auth] Exchanged Google token for Firebase ID token');
        }
    } catch (e) {
        console.warn('[Auth] ensureFirebaseIdTokenReady failed:', e?.message || e);
    }
}

function isSiteEqualToCurrentSite(url, domain) {
    const urlObject = new URL(url);

    return urlObject.hostname.includes(domain);
}

async function checkIfExtensionEnabled() {
    const result = await chrome.storage.local.get({
        excludedSites: [],
    });
    const excludedSites = result.excludedSites;
    const currentTab = await getCurrentTab();

    const isEnabled = !excludedSites.some((site) => isSiteEqualToCurrentSite(currentTab.url, site));

    return isEnabled;
}

function getChangedSite(changes) {
    const newValue = changes.newValue;
    const oldValue = changes.oldValue;

    const [changedItem] =
        newValue.length > oldValue.length
            ? newValue.filter((item) => !oldValue.includes(item))
            : oldValue.filter((item) => !newValue.includes(item));

    return changedItem;
}

async function handleExcludedSitesChange(changes) {
    const changedSite = getChangedSite(changes);

    const currentTab = await getCurrentTab();
    const isCurrentChanged = isSiteEqualToCurrentSite(currentTab.url, changedSite);

    if (!isCurrentChanged) return;

    const enabled = await checkIfExtensionEnabled();
    await notifyContentAboutChanges("extensionStateChanged", enabled);
}

// Getting all words and manipulating them

async function getAllTranslations() {
    const { words } = await chrome.storage.local.get(["words"]);
    // Return as a dictionary for compatibility
    if (!words) return {};
    return words.reduce((acc, word) => {
        acc[word.word.toLowerCase()] = word;
        return acc;
    }, {});
}

async function saveWordsToStorage() {
    try {
        const { words = [] } = await chrome.storage.local.get(['words']);
        if (Array.isArray(words) && words.length > 0) {
            await chrome.storage.local.set({ words });
        } else {
            await fsSyncWordsFromCloudIfEmpty();
        }
    } catch (e) {
        console.warn('saveWordsToStorage failed:', e?.message || e);
    }
}

async function deleteWordFromDictionary(wordId) {
    const { words } = await chrome.storage.local.get(["words"]);
    if (!words) return;
    const updatedWords = words.filter((word) => word.id !== Number(wordId));
    await chrome.storage.local.set({ words: updatedWords });
}

// ---- Firestore helpers (minimal, additive) ----
function fsEncodeValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEncodeValue) } };
    if (typeof v === 'object') {
        const m = {};
        Object.entries(v).forEach(([mk, mv]) => { m[mk] = fsEncodeValue(mv); });
        return { mapValue: { fields: m } };
    }
    return { stringValue: String(v) };
}

function fsEncodeFields(obj) {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => {
        if (v === undefined) return;
        out[k] = fsEncodeValue(v);
    });
    return { fields: out };
}

function fsDecodeValue(v) {
    if (v == null) return null;
    if ('nullValue' in v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return parseInt(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
    if ('arrayValue' in v) {
        const arr = v.arrayValue.values || [];
        return arr.map(fsDecodeValue);
    }
    if ('mapValue' in v) {
        const m = {};
        const fields = v.mapValue.fields || {};
        for (const [mk, mv] of Object.entries(fields)) m[mk] = fsDecodeValue(mv);
        return m;
    }
    return undefined;
}

function fsDecodeFields(doc) {
    const data = {};
    if (!doc || !doc.fields) return data;
    for (const [k, v] of Object.entries(doc.fields)) {
        data[k] = fsDecodeValue(v);
    }
    return data;
}

async function fsHeaders() {
    // Require Firebase ID token for Firestore (Rules rely on request.auth)
    let idToken = await getFirebaseIdTokenBg();
    if (!idToken) {
        try { await ensureFirebaseIdTokenReady(); } catch (_) {}
        idToken = await getFirebaseIdTokenBg();
    }
    if (!idToken) return null;
    return {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
    };
}

async function fsEnsureUserDoc(userInfo) {
    try {
        const headers = await fsHeaders();
        if (!headers) return;
    const uid = await getAuthUidBg();
        if (!uid) return;
        const url = `${FIRESTORE_BASE}/users/${uid}`;
        const profile = fsEncodeFields({
            uid: String(uid),
            email: userInfo.email || '',
            displayName: userInfo.name || userInfo.displayName || '',
            photoURL: userInfo.picture || userInfo.photoURL || '',
            lastLoginAt: new Date()
        });
        await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(profile) });
    } catch (_) { /* ignore */ }
}

async function fsSyncWordsFromCloudIfEmpty() {
    const { userInfo, words } = await chrome.storage.local.get(['userInfo', 'words']);
    if (!userInfo || (Array.isArray(words) && words.length > 0)) return;
    const headers = await fsHeaders();
    if (!headers) return;
    const uid = await getAuthUidBg();
    if (!uid) return;
    const url = `${FIRESTORE_BASE}/users/${uid}/words`;
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents) return;
    const imported = data.documents.map(d => ({ id: Number(d.name.split('/').pop()), ...fsDecodeFields(d) }))
        .filter(w => w && w.word && w.translation);
    if (imported.length > 0) {
        await chrome.storage.local.set({ words: imported });
    }
}

async function fsUpsertWord(changedWord) {
    console.log('AAAAAAAAAAAAAAAAA')
    const headers = await fsHeaders();
    if (!headers) return;
    const uid = await getAuthUidBg();
    if (!uid) return;
    console.log('BBBBBBBBBBBB')
    const docId = String(changedWord.id);
    const url = `${FIRESTORE_BASE}/users/${uid}/words?documentId=${encodeURIComponent(docId)}`;
    const body = fsEncodeFields({
        id: Number(changedWord.id),
        word: String(changedWord.word || '').toLowerCase(),
        translation: String(changedWord.translation || ''),
        learned: !!changedWord.learned,
        dateAdded: Number(changedWord.dateAdded || Date.now()),
        userId: String(uid),
        synonyms: Array.isArray(changedWord.synonyms) ? changedWord.synonyms : [],
        examples: Array.isArray(changedWord.examples) ? changedWord.examples : []
    });
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    console.log('CCCCCCCCCCCCCCCCC')
    if (res.ok) return;
    const patchUrl = `${FIRESTORE_BASE}/users/${uid}/words/${docId}`;
    const res2 = await fetch(patchUrl, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (!res2.ok) {
        const text2 = await res2.text().catch(()=> '');
        console.warn('Firestore upsert failed (patch)', res2.status, text2);
        // One more best-effort retry after ensuring token
        try {
            const retryHeaders = await fsHeaders();
            if (retryHeaders) {
                const res3 = await fetch(patchUrl, { method: 'PATCH', headers: retryHeaders, body: JSON.stringify(body) });
                if (!res3.ok) {
                    console.warn('Firestore upsert retry failed', res3.status, await res3.text().catch(()=>''));
                }
            }
        } catch (e) {
            console.warn('Firestore upsert retry error', e?.message || e);
        }
    }
}

async function fsDeleteWord(changedWord) {
    const headers = await fsHeaders();
    if (!headers) return;
    const uid = await getAuthUidBg();
    if (!uid) return;
    const docId = String(changedWord.id);
    const url = `${FIRESTORE_BASE}/users/${uid}/words/${docId}`;
    await fetch(url, { method: 'DELETE', headers });
}

async function fsPatchWord(changedWord) {
    await fsUpsertWord(changedWord);
}

function getChangedWord(changes) {
    const newValue = changes.newValue;
    const oldValue = changes.oldValue;

    if (newValue.length !== oldValue.length) {
        // Handle add or delete
        const newValueIds = newValue.map((word) => word.id);
        const oldValueIds = oldValue.map((word) => word.id);

        const [changedItemId] =
            newValue.length > oldValue.length
                ? newValueIds.filter((item) => !oldValueIds.includes(item))
                : oldValueIds.filter((item) => !newValueIds.includes(item));

        const [changedItem] =
            newValue.length > oldValue.length
                ? newValue.filter((item) => item.id === changedItemId)
                : oldValue.filter((item) => item.id === changedItemId);
        return changedItem;
    } else {
        // Handle update - find the item with the newest timestamp
        const changedItem = newValue.find(newItem => {
            const oldItem = oldValue.find(old => old.id === newItem.id);
            // If oldItem doesn't exist or timestamp is different, it's the one that changed.
            return !oldItem || newItem.lastUpdated !== oldItem.lastUpdated;
        });
        return changedItem;
    }
}

async function handleWordsChange(changes) {
    console.log(changes);
    const newValue = changes.newValue;
    const oldValue = changes.oldValue;

    if (!newValue) {
        // All words cleared
        await notifyContentAboutChanges("wordsChanged", { operation: 'clear' });
        return;
    }

    if (!oldValue) {
        // This is the initial load, not a change. Or first word added.
        // Let's treat it as a full refresh.
        await notifyContentAboutChanges("wordsChanged", { operation: 'reload', words: newValue });
        notifyPopupAboutChanges("wordsChanged", { operation: "getAllWords" });
        // Also mirror all current words to Firestore on first set
        try {
            const headers = await fsHeaders();
            if (headers) {
                for (const w of newValue) {
                    await fsUpsertWord(w);
                }
            }
        } catch (e) {
            console.warn('Initial mirror failed:', e?.message || e);
        }
        return;
    }
    let operation;
    if (newValue.length > oldValue.length) {
        operation = 'add';
    } else if (newValue.length < oldValue.length) {
        operation = 'delete';
    } else {
        operation = 'update';
    }

    const changedWord = getChangedWord(changes);

    if (changedWord) {
        const message = {
            operation: operation,
            word: changedWord,
            words: newValue // Pass the full list for add/reload cases
        };
        await notifyContentAboutChanges("wordsChanged", message);
        notifyPopupAboutChanges("wordsChanged", {
            operation: operation,
            wordId: changedWord.id,
        });
        console.log(`Operation: ${operation}, Word: ${changedWord.word}`);
        console.log('Mirroring to Firestore:', operation, changedWord?.id);

        // Mirror to Firestore (best-effort)
        try {
            if (operation === 'add') await fsUpsertWord(changedWord);
            else if (operation === 'delete') await fsDeleteWord(changedWord);
            else if (operation === 'update') await fsPatchWord(changedWord);
        } catch (e) {
            console.warn('Firestore mirror failed:', e?.message || e);
        }
    } else {
        console.log("Could not determine changed word, forcing reload.");
        await notifyContentAboutChanges("wordsChanged", { operation: 'reload', words: newValue });
        // Best-effort: upsert all words to ensure cloud is in sync
        try {
            const headers = await fsHeaders();
            if (headers) {
                for (const w of newValue) {
                    await fsUpsertWord(w);
                }
            }
        } catch (e) {
            console.warn('Reload mirror failed:', e?.message || e);
        }
    }
}

// Event listeners and initialization

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        // This is a first install! Show onboarding instead of popup
        chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
        chrome.storage.local.set({ 
            token: "",
            onboardingCompleted: false
        });
    } else if (details.reason === "update") {
        // This is an update. You can also handle updates here if needed.
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "saveWordContextMenu",
        title: "Save '%s'",
        contexts: ["selection"],
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "saveWordContextMenu") {
        const selectedText = info.selectionText;
        chrome.tabs.sendMessage(tab.id, { action: "saveWordToDictionary", text: selectedText }, (response) =>
            console.log(response)
        );
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "checkExtensionState") {
        checkIfExtensionEnabled()
            .then((enabled) => {
                sendResponse({ enabled });
            })
            .catch((error) => {
                console.error("Error checking extension state:", error);
                sendResponse({ enabled: false });
            });

        return true;
    }

    if (request.action === "saveWordsToStorage") {
        saveWordsToStorage();
    }

    if (request.action === "getUserInfo") {
        getCurrentUserInfo()
            .then(() => {
                sendResponse({ userInfo });
            })
            .catch((error) => {
                console.error("Error getting user info:", error);
            });

        return true;
    }

    if (request.action === "getFirebaseIdToken") {
        getFirebaseIdTokenBg()
            .then((token) => sendResponse({ token }))
            .catch((error) => {
                console.error('Error getting Firebase ID token:', error);
                sendResponse({ token: null });
            });
        return true;
    }

    if (request.action === "translateWord") {
        (async () => {
            try {
                const idToken = await getFirebaseIdTokenBg();
                if (!idToken) throw new Error('No Firebase ID token');
                const url = `https://europe-central2-lazylex-9d161.cloudfunctions.net/translateWord`;
                console.log('[translateWord] Calling function', {
                    word: request.word,
                    targetLanguage: request.targetLanguage
                });
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ data: { word: request.word, targetLanguage: request.targetLanguage } })
                });
                if (!res.ok) {
                    const text = await res.text().catch(()=> '');
                    throw new Error(`translateWord failed ${res.status}: ${text}`);
                }
                const json = await res.json();
                console.log('[translateWord] Function response', json);
                sendResponse({ success: true, result: json.result || json });
            } catch (e) {
                console.error('translateWord error:', e);
                sendResponse({ success: false, error: e?.message || String(e) });
            }
        })();
        return true;
    }
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === "local" && "excludedSites" in changes) {
        await handleExcludedSitesChange(changes.excludedSites);
    }

    if (namespace === "local" && "words" in changes) {
        await handleWordsChange(changes.words);
    }

    // When user signs in, ensure profile doc and initial words sync
    if (namespace === 'local' && 'userInfo' in changes && changes.userInfo?.newValue) {
        try {
            await fsEnsureUserDoc(changes.userInfo.newValue);
            await fsSyncWordsFromCloudIfEmpty();
        } catch (e) { /* ignore */ }
    }

    // If Google token stored/changed, ensure Firebase ID token exists
    if (namespace === 'local' && 'auth_token' in changes && changes.auth_token?.newValue) {
        try { await ensureFirebaseIdTokenReady(); } catch (e) { /* ignore */ }
    }

    // Mirror options to Firestore preferences
    const settingsKeys = ['translateTo','animationToggle','sentenceCounter','highlightingEnabled','highlightColor','translationColor'];
    if (namespace === 'local' && settingsKeys.some(k => k in changes)) {
        try {
            const { userInfo } = await chrome.storage.local.get(['userInfo']);
            if (!userInfo) return;
            const headers = await fsHeaders();
            if (!headers) return;
            const uid = userInfo.id || userInfo.uid;
            if (!uid) return;
            const url = `${FIRESTORE_BASE}/users/${uid}/userSettings/preferences`;
            const current = await chrome.storage.local.get(settingsKeys);
            const body = fsEncodeFields({
                translateTo: current.translateTo || 'UK',
                animationToggle: (current.animationToggle === 'true') || current.animationToggle === true,
                sentenceCounter: Number(current.sentenceCounter || 1),
                highlightingEnabled: current.highlightingEnabled !== false,
                highlightColor: current.highlightColor || 'rgba(255, 0, 0, 0.22)',
                translationColor: current.translationColor || '#d0d0d0',
                updatedAt: new Date()
            });
            await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
        } catch (e) {
            console.warn('Failed to mirror settings:', e?.message || e);
        }
    }
});

// Attempt to prepare Firebase ID token on service worker start
(async () => { try { await ensureFirebaseIdTokenReady(); } catch (e) { /* ignore */ } })();
