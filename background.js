importScripts("extension-config.js");

const {
    firebaseApiKey,
    firebaseProjectId,
    functionsBaseUrl,
    identityRequestUri
} = globalThis.LAZYLEX_CONFIG;

const API_TIMEOUT_MS = 12000;
const cloudConfirmedWordMutations = new Set();

class LazyLexApiError extends Error {
    constructor(message, { code = "api/error", status = 0 } = {}) {
        super(message);
        this.name = "LazyLexApiError";
        this.code = code;
        this.status = status;
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new LazyLexApiError("The request timed out. Please try again.", {
                code: "api/timeout"
            });
        }
        throw new LazyLexApiError("Unable to reach LazyLex. Check your connection and try again.", {
            code: "api/network"
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function requireSuccessfulResponse(response, operation) {
    if (response.ok) {
        return response;
    }

    const responseText = await response.text().catch(() => "");
    const suffix = responseText ? `: ${responseText.slice(0, 240)}` : "";
    throw new LazyLexApiError(`${operation} failed (${response.status})${suffix}`, {
        code: `api/http-${response.status}`,
        status: response.status
    });
}

function serializeApiError(error) {
    return {
        code: error?.code || "api/error",
        message: error?.message || "The operation failed. Please try again.",
        status: Number(error?.status) || 0
    };
}

async function getCurrentUserInfo() {
    const { userInfo } = await chrome.storage.local.get(["userInfo"]);
    return userInfo || null;
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
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents`;

async function refreshFirebaseIdTokenBg(refreshToken) {
    const url = `https://securetoken.googleapis.com/v1/token?key=${firebaseApiKey}`;
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
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${firebaseApiKey}`;
    const body = {
        postBody: `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`,
        requestUri: identityRequestUri,
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
    try {
        const hostname = new URL(url).hostname.toLocaleLowerCase();
        const normalizedDomain = String(domain || "")
            .trim()
            .replace(/^\.+|\.+$/g, "")
            .toLocaleLowerCase();
        return Boolean(normalizedDomain)
            && (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`));
    } catch {
        return false;
    }
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

function addUpdateMask(url, fieldPaths) {
    const target = new URL(url);
    fieldPaths.forEach((fieldPath) => {
        target.searchParams.append("updateMask.fieldPaths", fieldPath);
    });
    return target.toString();
}

async function fsHeaders(required = false) {
    // Require Firebase ID token for Firestore (Rules rely on request.auth)
    let idToken = await getFirebaseIdTokenBg();
    if (!idToken) {
        try { await ensureFirebaseIdTokenReady(); } catch (_) {}
        idToken = await getFirebaseIdTokenBg();
    }
    if (!idToken) {
        if (required) {
            throw new LazyLexApiError("Please sign in to sync your dictionary.", {
                code: "auth/required",
                status: 401
            });
        }
        return null;
    }
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
        const profileFields = {
            uid: String(uid),
            email: userInfo.email || '',
            displayName: userInfo.name || userInfo.displayName || '',
            photoURL: userInfo.picture || userInfo.photoURL || '',
            lastLoginAt: new Date()
        };
        if (userInfo.telegramName) {
            profileFields.telegramName = String(userInfo.telegramName).replace(/^@+/, "");
        }
        const url = addUpdateMask(
            `${FIRESTORE_BASE}/users/${uid}`,
            Object.keys(profileFields)
        );
        const response = await fetchWithTimeout(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(fsEncodeFields(profileFields))
        });
        await requireSuccessfulResponse(response, "Updating the user profile");
    } catch (error) {
        console.warn("Unable to update the user profile:", error?.message || error);
    }
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

async function fsUpsertWord(changedWord, required = false) {
    const headers = await fsHeaders(required);
    if (!headers) return false;
    const uid = await getAuthUidBg();
    if (!uid) {
        if (required) {
            throw new LazyLexApiError("The signed-in user could not be identified.", {
                code: "auth/invalid",
                status: 401
            });
        }
        return false;
    }
    const docId = String(changedWord.id);
    const url = `${FIRESTORE_BASE}/users/${uid}/words?documentId=${encodeURIComponent(docId)}`;
    const body = fsEncodeFields({
        id: Number(changedWord.id),
        word: String(changedWord.word || '').toLowerCase(),
        translation: String(changedWord.translation || ''),
        learned: !!changedWord.learned,
        status: String(changedWord.status || (changedWord.learned ? "learned" : "new")),
        encounterCount: Number(changedWord.encounterCount || 0),
        dateAdded: Number(changedWord.dateAdded || Date.now()),
        userId: String(uid),
        synonyms: Array.isArray(changedWord.synonyms) ? changedWord.synonyms : [],
        examples: Array.isArray(changedWord.examples) ? changedWord.examples : []
    });
    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (res.ok) return true;
    const patchUrl = `${FIRESTORE_BASE}/users/${uid}/words/${docId}`;
    const res2 = await fetchWithTimeout(patchUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body)
    });
    await requireSuccessfulResponse(res2, "Saving the word");
    return true;
}

async function fsDeleteWord(changedWord, required = false) {
    const headers = await fsHeaders(required);
    if (!headers) return false;
    const uid = await getAuthUidBg();
    if (!uid) {
        if (required) {
            throw new LazyLexApiError("The signed-in user could not be identified.", {
                code: "auth/invalid",
                status: 401
            });
        }
        return false;
    }
    const docId = String(changedWord.id);
    const url = `${FIRESTORE_BASE}/users/${uid}/words/${docId}`;
    const response = await fetchWithTimeout(url, { method: 'DELETE', headers });
    if (response.status !== 404) {
        await requireSuccessfulResponse(response, "Deleting the word");
    }
    return true;
}

async function fsPatchWord(changedWord) {
    await fsUpsertWord(changedWord);
}

function validateWordPayload(candidate) {
    if (!candidate || typeof candidate !== "object") {
        throw new LazyLexApiError("The word payload is missing.", {
            code: "validation/word"
        });
    }

    const id = Number(candidate.id);
    const word = String(candidate.word || "").trim().toLocaleLowerCase();
    const translation = String(candidate.translation || "").trim();
    if (!Number.isSafeInteger(id) || !word || !translation) {
        throw new LazyLexApiError("The word or translation is invalid.", {
            code: "validation/word"
        });
    }

    return {
        ...candidate,
        id,
        word,
        translation,
        lastUpdated: Number(candidate.lastUpdated) || Date.now()
    };
}

async function persistWordMutation(candidate) {
    const word = validateWordPayload(candidate);
    await fsUpsertWord(word, true);

    const { words = [] } = await chrome.storage.local.get({ words: [] });
    const existingIndex = words.findIndex((item) => Number(item.id) === word.id);
    const updatedWords = [...words];
    if (existingIndex >= 0) {
        updatedWords[existingIndex] = word;
    } else {
        updatedWords.push(word);
        await incrementDailyWordCount();
    }

    cloudConfirmedWordMutations.add(word.id);
    await chrome.storage.local.set({ words: updatedWords });
    return word;
}

async function deleteWordMutation(wordId) {
    const id = Number(wordId);
    if (!Number.isSafeInteger(id)) {
        throw new LazyLexApiError("The word id is invalid.", {
            code: "validation/word-id"
        });
    }

    const { words = [] } = await chrome.storage.local.get({ words: [] });
    const word = words.find((item) => Number(item.id) === id);
    if (!word) {
        return id;
    }

    await fsDeleteWord(word, true);
    cloudConfirmedWordMutations.add(id);
    await chrome.storage.local.set({
        words: words.filter((item) => Number(item.id) !== id)
    });
    return id;
}

// Premium sentence storage (issue #28)
//
// Sentences are private per authenticated user and are deliberately kept
// out of the word dictionary model and out of any shared word/phrase
// cache: they live in their own chrome.storage.local key ("sentences",
// scoped to the signed-in uid) and their own Firestore subcollection
// (users/{uid}/sentences), mirroring the users/{uid}/words pattern above
// but never touching the words collection, translateWord, or a shared
// translations/lexicon store.

async function getSubscriptionStatus() {
    try {
        const headers = await fsHeaders();
        if (!headers) {
            return { authenticated: false, isPremium: false, subscriptionStatus: "free" };
        }

        const uid = await getAuthUidBg();
        if (!uid) {
            return { authenticated: false, isPremium: false, subscriptionStatus: "free" };
        }

        const response = await fetch(`${FIRESTORE_BASE}/users/${uid}`, { headers });
        if (!response.ok) {
            return { authenticated: true, isPremium: false, subscriptionStatus: "free" };
        }

        const userData = await response.json();
        const fields = userData.fields || {};
        const subscriptionStatus = fields.subscriptionStatus?.stringValue || "free";
        const isPremium = subscriptionStatus === "premium" || subscriptionStatus === "lifetime";

        return { authenticated: true, isPremium, subscriptionStatus };
    } catch (error) {
        console.error("Error checking subscription status:", error);
        // Fail closed for a gated, potentially billable feature: an error
        // reading entitlement must not be treated as "premium".
        return { authenticated: false, isPremium: false, subscriptionStatus: "free" };
    }
}

function validateSentencePayload(candidate) {
    if (!candidate || typeof candidate !== "object") {
        throw new LazyLexApiError("The sentence payload is missing.", {
            code: "validation/sentence"
        });
    }

    const text = String(candidate.text || "").trim();
    const translation = String(candidate.translation || "").trim();
    if (!text || text.length > 500 || !translation) {
        throw new LazyLexApiError("The sentence or its translation is invalid.", {
            code: "validation/sentence"
        });
    }

    const id = Number(candidate.id) || Date.now();

    return {
        id,
        text,
        translation,
        sourceLanguage: String(candidate.sourceLanguage || "auto"),
        targetLanguage: String(candidate.targetLanguage || "uk"),
        dateAdded: Number(candidate.dateAdded) || Date.now()
    };
}

async function fsUpsertSentence(sentence, required = false) {
    const headers = await fsHeaders(required);
    if (!headers) return false;
    const uid = await getAuthUidBg();
    if (!uid) {
        if (required) {
            throw new LazyLexApiError("The signed-in user could not be identified.", {
                code: "auth/invalid",
                status: 401
            });
        }
        return false;
    }

    const docId = String(sentence.id);
    // Deliberately users/{uid}/sentences -- never the shared words/
    // translations/lexicon collections.
    const url = `${FIRESTORE_BASE}/users/${uid}/sentences?documentId=${encodeURIComponent(docId)}`;
    const body = fsEncodeFields({
        id: Number(sentence.id),
        text: sentence.text,
        translation: sentence.translation,
        sourceLanguage: sentence.sourceLanguage,
        targetLanguage: sentence.targetLanguage,
        dateAdded: Number(sentence.dateAdded || Date.now()),
        userId: String(uid)
    });

    const res = await fetchWithTimeout(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.ok) return true;

    const patchUrl = `${FIRESTORE_BASE}/users/${uid}/sentences/${docId}`;
    const res2 = await fetchWithTimeout(patchUrl, { method: "PATCH", headers, body: JSON.stringify(body) });
    await requireSuccessfulResponse(res2, "Saving the sentence");
    return true;
}

async function fsDeleteSentence(sentenceId, required = false) {
    const headers = await fsHeaders(required);
    if (!headers) return false;
    const uid = await getAuthUidBg();
    if (!uid) {
        if (required) {
            throw new LazyLexApiError("The signed-in user could not be identified.", {
                code: "auth/invalid",
                status: 401
            });
        }
        return false;
    }

    const url = `${FIRESTORE_BASE}/users/${uid}/sentences/${String(sentenceId)}`;
    const response = await fetchWithTimeout(url, { method: "DELETE", headers });
    if (response.status !== 404) {
        await requireSuccessfulResponse(response, "Deleting the sentence");
    }
    return true;
}

async function persistSentenceMutation(candidate) {
    const sentence = validateSentencePayload(candidate);
    await fsUpsertSentence(sentence, true);

    const { userInfo, sentences = [] } = await chrome.storage.local.get({ userInfo: null, sentences: [] });
    const uid = userInfo?.uid || userInfo?.id || null;
    const updatedSentences = [...sentences, sentence];
    await chrome.storage.local.set({ sentences: updatedSentences, sentencesOwnerUid: uid });
    notifyPopupAboutChanges("sentencesChanged", { operation: "add", sentence, sentences: updatedSentences });
    return sentence;
}

async function deleteSentenceMutation(sentenceId) {
    const id = Number(sentenceId);
    if (!Number.isSafeInteger(id)) {
        throw new LazyLexApiError("The sentence id is invalid.", {
            code: "validation/sentence-id"
        });
    }

    await fsDeleteSentence(id, true);

    const { sentences = [] } = await chrome.storage.local.get({ sentences: [] });
    const updatedSentences = sentences.filter((item) => Number(item.id) !== id);
    await chrome.storage.local.set({ sentences: updatedSentences });
    notifyPopupAboutChanges("sentencesChanged", { operation: "delete", sentenceId: id, sentences: updatedSentences });
    return id;
}

async function translateSentenceMutation(text, targetLanguage) {
    const trimmed = String(text || "").trim();
    if (!trimmed || trimmed.length > 500) {
        throw new LazyLexApiError("Sentences are limited to 500 characters.", {
            code: "validation/sentence-length",
            status: 400
        });
    }

    // Authoritative-as-possible check from the extension side: never call
    // the (billable) translation backend for a non-premium account. The
    // deployed callable function is expected to re-check this server side
    // (see crezione1/LazyLexFunctions#1) -- that is the real authority.
    const subscription = await getSubscriptionStatus();
    if (!subscription.isPremium) {
        throw new LazyLexApiError("Sentence translation requires Premium.", {
            code: "entitlement",
            status: 403
        });
    }

    const idToken = await getFirebaseIdTokenBg();
    if (!idToken) {
        throw new LazyLexApiError("Please sign in to translate sentences.", {
            code: "auth/required",
            status: 401
        });
    }

    // Deliberately a distinct callable from translateWord, and never
    // shares the word/phrase translation cache -- see issue #28 and the
    // backend contract in crezione1/LazyLexFunctions#1.
    const url = `${functionsBaseUrl}/translateSentence`;
    const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            data: {
                text: trimmed,
                sourceLanguage: "auto",
                targetLanguage: targetLanguage || "uk",
                type: "sentence"
            }
        })
    });
    await requireSuccessfulResponse(res, "Sentence translation");
    const json = await res.json();
    const result = json.result || json;
    const translation = String(result?.translation || "").trim();
    if (!translation) {
        throw new LazyLexApiError("LazyLex did not return a sentence translation.", {
            code: "api/empty-translation"
        });
    }

    return persistSentenceMutation({
        text: trimmed,
        translation,
        sourceLanguage: "auto",
        targetLanguage: targetLanguage || "uk"
    });
}

async function updateTelegramMutation(telegramName) {
    const normalizedTelegram = String(telegramName || "")
        .trim()
        .replace(/^@+/, "");
    if (!/^[A-Za-z0-9_]{5,32}$/.test(normalizedTelegram)) {
        throw new LazyLexApiError(
            "Enter a valid Telegram username (5–32 letters, numbers, or underscores).",
            { code: "validation/telegram" }
        );
    }

    const headers = await fsHeaders(true);
    const uid = await getAuthUidBg();
    if (!uid) {
        throw new LazyLexApiError("The signed-in user could not be identified.", {
            code: "auth/invalid",
            status: 401
        });
    }

    const response = await fetchWithTimeout(addUpdateMask(
        `${FIRESTORE_BASE}/users/${uid}`,
        ["telegramName", "updatedAt"]
    ), {
        method: "PATCH",
        headers,
        body: JSON.stringify(fsEncodeFields({
            telegramName: normalizedTelegram,
            updatedAt: new Date()
        }))
    });
    await requireSuccessfulResponse(response, "Updating Telegram");

    const { userInfo = {} } = await chrome.storage.local.get({ userInfo: {} });
    await chrome.storage.local.set({
        userInfo: {
            ...userInfo,
            telegramName: normalizedTelegram
        }
    });
    return normalizedTelegram;
}

function getChangedWords(changes) {
    const newValue = Array.isArray(changes.newValue) ? changes.newValue : [];
    const oldValue = Array.isArray(changes.oldValue) ? changes.oldValue : [];
    const newById = new Map(newValue.map((word) => [Number(word.id), word]));
    const oldById = new Map(oldValue.map((word) => [Number(word.id), word]));
    const changedWords = [];

    for (const [id, word] of newById) {
        const previousWord = oldById.get(id);
        if (!previousWord) {
            changedWords.push({ operation: "add", word });
        } else if (JSON.stringify(word) !== JSON.stringify(previousWord)) {
            changedWords.push({ operation: "update", word });
        }
    }

    for (const [id, word] of oldById) {
        if (!newById.has(id)) {
            changedWords.push({ operation: "delete", word });
        }
    }

    return changedWords;
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
    const changedWords = getChangedWords(changes);

    if (changedWords.length > 0) {
        for (const { operation, word: changedWord } of changedWords) {
            const alreadySynced = cloudConfirmedWordMutations.delete(Number(changedWord.id));
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

            if (!alreadySynced) {
                // Mirror legacy/local-only mutations. Interactive mutations use the
                // strict message handlers below and reach storage only after cloud success.
                try {
                    if (operation === 'add') {
                        await fsUpsertWord(changedWord);
                        await incrementDailyWordCount();
                    }
                    else if (operation === 'delete') await fsDeleteWord(changedWord);
                    else if (operation === 'update') await fsPatchWord(changedWord);
                } catch (e) {
                    console.warn('Firestore mirror failed:', e?.message || e);
                }
            }
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
        chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
        chrome.storage.local.set({ 
            token: "",
            onboardingCompleted: false
        });
    } else if (details.reason === "update") {
        // No auto-onboarding on update
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
            .then((userInfo) => {
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

    if (request.action === "persistWord") {
        persistWordMutation(request.word)
            .then((word) => sendResponse({ success: true, word }))
            .catch((error) => {
                console.error("persistWord failed:", error);
                sendResponse({ success: false, error: serializeApiError(error) });
            });
        return true;
    }

    if (request.action === "deleteWord") {
        deleteWordMutation(request.wordId)
            .then((wordId) => sendResponse({ success: true, wordId }))
            .catch((error) => {
                console.error("deleteWord failed:", error);
                sendResponse({ success: false, error: serializeApiError(error) });
            });
        return true;
    }

    if (request.action === "updateTelegram") {
        updateTelegramMutation(request.telegramName)
            .then((telegramName) => sendResponse({ success: true, telegramName }))
            .catch((error) => {
                console.error("updateTelegram failed:", error);
                sendResponse({ success: false, error: serializeApiError(error) });
            });
        return true;
    }

    if (request.action === "translateWord") {
        (async () => {
            try {
                const idToken = await getFirebaseIdTokenBg();
                if (!idToken) throw new Error('No Firebase ID token');
                const url = `${functionsBaseUrl}/translateWord`;
                const res = await fetchWithTimeout(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ data: { word: request.word, targetLanguage: request.targetLanguage } })
                });
                await requireSuccessfulResponse(res, "Translation");
                const json = await res.json();
                sendResponse({ success: true, result: json.result || json });
            } catch (e) {
                console.error('translateWord error:', e);
                sendResponse({ success: false, error: serializeApiError(e) });
            }
        })();
        return true;
    }

    if (request.action === "checkSubscriptionLimits") {
        checkSubscriptionLimits()
            .then((result) => sendResponse(result))
            .catch((error) => {
                console.error('Error checking subscription limits:', error);
                sendResponse({ canAdd: true, reason: 'error' });
            });
        return true;
    }

    if (request.action === "incrementDailyWordCount") {
        incrementDailyWordCount()
            .then(() => sendResponse({ success: true }))
            .catch((error) => {
                console.error('Error incrementing daily word count:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === "getSubscriptionStatus") {
        getSubscriptionStatus()
            .then((result) => sendResponse(result))
            .catch((error) => {
                console.error('Error getting subscription status:', error);
                sendResponse({ authenticated: false, isPremium: false, subscriptionStatus: 'free' });
            });
        return true;
    }

    if (request.action === "translateSentence") {
        translateSentenceMutation(request.text, request.targetLanguage)
            .then((sentence) => sendResponse({ success: true, sentence }))
            .catch((error) => {
                console.error('translateSentence error:', error);
                sendResponse({ success: false, error: serializeApiError(error) });
            });
        return true;
    }

    if (request.action === "deleteSentence") {
        deleteSentenceMutation(request.sentenceId)
            .then((sentenceId) => sendResponse({ success: true, sentenceId }))
            .catch((error) => {
                console.error('deleteSentence error:', error);
                sendResponse({ success: false, error: serializeApiError(error) });
            });
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

    // Locally mirrored sentences are private to one account. If the signed-in
    // uid changes (account switch without an explicit logout) or auth is
    // cleared, drop any locally cached sentences that belonged to a
    // different (or no) uid so they can never be shown against the wrong
    // account.
    if (namespace === 'local' && 'userInfo' in changes) {
        try {
            const newUserInfo = changes.userInfo?.newValue || null;
            const newUid = newUserInfo?.uid || newUserInfo?.id || null;
            const { sentencesOwnerUid } = await chrome.storage.local.get(['sentencesOwnerUid']);
            if (sentencesOwnerUid && sentencesOwnerUid !== newUid) {
                await chrome.storage.local.set({ sentences: [], sentencesOwnerUid: newUid || null });
            }
        } catch (e) { /* ignore */ }
    }

    // If Google token stored/changed, ensure Firebase ID token exists
    if (namespace === 'local' && 'auth_token' in changes && changes.auth_token?.newValue) {
        try { await ensureFirebaseIdTokenReady(); } catch (e) { /* ignore */ }
    }

    // Mirror options to Firestore preferences
    const settingsKeys = ['translateTo','animationToggle','sentenceCounter','highlightingEnabled','frequencyColoringEnabled','highlightColor','translationColor'];
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
                translateTo: current.translateTo || 'uk',
                animationToggle: (current.animationToggle === 'true') || current.animationToggle === true,
                sentenceCounter: Number(current.sentenceCounter || 1),
                highlightingEnabled: current.highlightingEnabled !== false,
                frequencyColoringEnabled: current.frequencyColoringEnabled !== false,
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

// Subscription management functions
async function checkSubscriptionLimits() {
    try {
        const headers = await fsHeaders();
        if (!headers) return { canAdd: true, reason: 'no_auth' };

        const uid = await getAuthUidBg();
        if (!uid) return { canAdd: true, reason: 'no_uid' };

        const url = `${FIRESTORE_BASE}/users/${uid}`;
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            // User document doesn't exist, create default and allow
            await createDefaultUserSubscription(uid);
            return { canAdd: true, reason: 'new_user', dailyWordsAdded: 0, dailyWordLimit: 5 };
        }

        const userData = await response.json();
        const fields = userData.fields || {};
        
        const subscriptionStatus = fields.subscriptionStatus?.stringValue || 'free';
        const today = new Date().toISOString().split('T')[0];
        const dailyWordsResetDate = fields.dailyWordsResetDate?.stringValue || today;
        const dailyWordsAdded = fields.dailyWordsAdded?.integerValue || fields.dailyWordsAdded?.doubleValue || 0;
        
        // Reset daily count if it's a new day
        const resetDailyCount = dailyWordsResetDate !== today;
        const currentDailyCount = resetDailyCount ? 0 : Number(dailyWordsAdded);
        
        // Check if user has premium access
        const isPremium = subscriptionStatus === 'premium' || subscriptionStatus === 'lifetime';
        
        if (isPremium) {
            return { 
                canAdd: true, 
                reason: 'premium', 
                dailyWordsAdded: currentDailyCount,
                isPremium: true,
                needsReset: resetDailyCount
            };
        }

        // Free user - check daily limit
        const dailyLimit = 5;
        const canAdd = currentDailyCount < dailyLimit;
        
        return {
            canAdd,
            reason: canAdd ? 'within_limit' : 'daily_limit_reached',
            dailyWordsAdded: currentDailyCount,
            dailyWordLimit: dailyLimit,
            isPremium: false,
            needsReset: resetDailyCount
        };
    } catch (error) {
        console.error('Error checking subscription limits:', error);
        // Default to allowing on error to avoid blocking users
        return { canAdd: true, reason: 'error' };
    }
}

async function incrementDailyWordCount() {
    try {
        const headers = await fsHeaders();
        if (!headers) return;

        const uid = await getAuthUidBg();
        if (!uid) return;

        // Get current subscription data
        const limitCheck = await checkSubscriptionLimits();
        const today = new Date().toISOString().split('T')[0];
        
        let newCount = limitCheck.dailyWordsAdded + 1;
        if (limitCheck.needsReset) {
            newCount = 1; // Reset to 1 for new day
        }

        const url = `${FIRESTORE_BASE}/users/${uid}`;
        const updateData = {
            fields: {
                dailyWordsAdded: { integerValue: String(newCount) },
                dailyWordsResetDate: { stringValue: today }
            }
        };

        await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(updateData)
        });

        console.log(`Daily word count updated to ${newCount} for ${today}`);
    } catch (error) {
        console.error('Error incrementing daily word count:', error);
    }
}

async function createDefaultUserSubscription(uid) {
    try {
        const headers = await fsHeaders();
        if (!headers) return;

        const { userInfo } = await chrome.storage.local.get(['userInfo']);
        const today = new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();

        const url = `${FIRESTORE_BASE}/users/${uid}`;
        const userData = {
            fields: {
                uid: { stringValue: uid },
                email: { stringValue: userInfo?.email || '' },
                displayName: { stringValue: userInfo?.name || userInfo?.displayName || '' },
                photoURL: { stringValue: userInfo?.picture || userInfo?.photoURL || '' },
                subscriptionStatus: { stringValue: 'free' },
                dailyWordsAdded: { integerValue: '0' },
                dailyWordsResetDate: { stringValue: today },
                dailyWordLimit: { integerValue: '5' },
                createdAt: { timestampValue: now },
                lastLoginAt: { timestampValue: now }
            }
        };

        await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(userData)
        });

        console.log('Created default user subscription document');
    } catch (error) {
        console.error('Error creating default user subscription:', error);
    }
}

function showWelcomePage() {
    chrome.storage.local.get(['welcomeShown', 'onboardingCompleted'], (result) => {
        if (!result.welcomeShown && !result.onboardingCompleted) {
            chrome.tabs.create({
                url: chrome.runtime.getURL('onboarding.html'),
                active: true
            });
        }
    });
}

function checkWelcomeStatus() {
    chrome.storage.local.get(['welcomeShown', 'onboardingCompleted'], (result) => {
        // If neither welcome nor onboarding was completed, show welcome
        if (!result.welcomeShown && !result.onboardingCompleted) {
            showWelcomePage();
        }
    });
}

// Handle welcome page requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openWelcome') {
        showWelcomePage();
        sendResponse({ success: true });
    }
    
    if (request.action === 'openOnboarding') {
        chrome.tabs.create({
            url: chrome.runtime.getURL('onboarding.html'),
            active: true
        });
        sendResponse({ success: true });
    }
    
    if (request.action === 'checkWelcomeStatus') {
        chrome.storage.local.get(['welcomeShown', 'onboardingCompleted'], (result) => {
            sendResponse({
                welcomeShown: result.welcomeShown || false,
                onboardingCompleted: result.onboardingCompleted || false
            });
        });
        return true;
    }
});

// Attempt to prepare Firebase ID token on service worker start
(async () => { try { await ensureFirebaseIdTokenReady(); } catch (e) { /* ignore */ } })();
