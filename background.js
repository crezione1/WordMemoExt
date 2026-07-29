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

// Force an exchange from Google access token â†’ Firebase ID token (background)
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
    consßm¹¶‰žËkºwµç@€€€€€€€€€€ô(€€€€€€€€€€€ô(€€€€€€€ô(€€€ô•±Í”ì(€€€€€€€½¹Í½±”¹±½œ ‰½Õ±¹½Ð‘•Ñ•Éµ¥¹”¡…¹•Ý½É°™½É¥¹œÉ•±½…¸ˆ¤ì(€€€€€€€…Ý…¥Ð¹½Ñ¥™å½¹Ñ•¹Ñ‰½ÕÑ¡…¹•Ì ‰Ý½É‘Í¡…¹•ˆ°ì½Á•É…Ñ¥½¸è€É•±½…œ°Ý½É‘Ìè¹•ÝY…±Õ”ô¤ì4(€€€€€€€€¼¼	•ÍÐµ•™™½ÉÐèÕÁÍ•ÉÐ…±°Ý½É‘ÌÑ¼•¹ÍÕÉ”±½Õ¥Ì¥¸Íå¹Œ4(€€€€€€€ÑÉäì4(€€€€€€€€€€€½¹ÍÐ¡•…‘•ÉÌ€ô…Ý…¥Ð™Í!•…‘•ÉÌ ¤ì4(€€€€€€€€€€€¥˜€¡¡•…‘•ÉÌ¤ì4(€€€€€€€€€€€€€€€™½È€¡½¹ÍÐÜ½˜¹•ÝY…±Õ”¤ì4(€€€€€€€€€€€€€€€€€€€…Ý…¥Ð™ÍUÁÍ•ÉÑ]½É¡Ü¤ì4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€ô4(€€€€€€€ô…Ñ €¡”¤ì4(€€€€€€€€€€€½¹Í½±”¹Ý…É¸ I•±½…µ¥ÉÉ½È™…¥±•èœ°”ü¹µ•ÍÍ…”ñð”¤ì4(€€€€€€€ô4(€€€ô4)ô4(4(¼¼Ù•¹Ð±¥ÍÑ•¹•ÉÌ…¹¥¹¥Ñ¥…±¥é…Ñ¥½¸4(4)¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹%¹ÍÑ…±±•¹…‘‘1¥ÍÑ•¹•È ¡‘•Ñ…¥±Ì¤€ôøì4(€€€¥˜€¡‘•Ñ…¥±Ì¹É•…Í½¸€ôôô€‰¥¹ÍÑ…±°ˆ¤ì(€€€€€€€¡É½µ”¹Ñ…‰Ì¹É•…Ñ”¡ìÕÉ°è¡É½µ”¹ÉÕ¹Ñ¥µ”¹•ÑUI0 ‰½¹‰½…É‘¥¹œ¹¡Ñµ°ˆ¤ô¤ì(€€€€€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹Í•Ð¡ì€4(€€€€€€€€€€€Ñ½­•¸è€ˆˆ°4(€€€€€€€€€€€½¹‰½…É‘¥¹½µÁ±•Ñ•è™…±Í”4(€€€€€€€ô¤ì4(€€€ô•±Í”¥˜€¡‘•Ñ…¥±Ì¹É•…Í½¸€ôôô€‰ÕÁ‘…Ñ”ˆ¤ì4(€€€€€€€€¼¼9¼…ÕÑ¼µ½¹‰½…É‘¥¹œ½¸ÕÁ‘…Ñ”4(€€€ô4)ô¤ì4(4)¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹%¹ÍÑ…±±•¹…‘‘1¥ÍÑ•¹•È  ¤€ôøì4(€€€¡É½µ”¹½¹Ñ•áÑ5•¹ÕÌ¹É•…Ñ”¡ì4(€€€€€€€¥è€‰Í…Ù•]½É‘½¹Ñ•áÑ5•¹Ôˆ°4(€€€€€€€Ñ¥Ñ±”è€‰M…Ù”€œ•Ìœˆ°4(€€€€€€€½¹Ñ•áÑÌèl‰Í•±•Ñ¥½¸‰t°4(€€€ô¤ì4)ô¤ì4(4)¡É½µ”¹½¹Ñ•áÑ5•¹ÕÌ¹½¹±¥­•¹…‘‘1¥ÍÑ•¹•È ¡¥¹™¼°Ñ…ˆ¤€ôøì4(€€€¥˜€¡¥¹™¼¹µ•¹Õ%Ñ•µ%€ôôô€‰Í…Ù•]½É‘½¹Ñ•áÑ5•¹Ôˆ¤ì4(€€€€€€€½¹ÍÐÍ•±•Ñ•‘Q•áÐ€ô¥¹™¼¹Í•±•Ñ¥½¹Q•áÐì4(€€€€€€€¡É½µ”¹Ñ…‰Ì¹Í•¹‘5•ÍÍ…”¡Ñ…ˆ¹¥°ì…Ñ¥½¸è€‰Í…Ù•]½É‘Q½¥Ñ¥½¹…Éäˆ°Ñ•áÐèÍ•±•Ñ•‘Q•áÐô°€¡É•ÍÁ½¹Í”¤€ôø4(€€€€€€€€€€€½¹Í½±”¹±½œ¡É•ÍÁ½¹Í”¤4(€€€€€€€€¤ì4(€€€ô4)ô¤ì4(4)¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È ¡É•ÅÕ•ÍÐ°Í•¹‘•È°Í•¹‘I•ÍÁ½¹Í”¤€ôøì4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰¡•­áÑ•¹Í¥½¹MÑ…Ñ”ˆ¤ì4(€€€€€€€¡•­%™áÑ•¹Í¥½¹¹…‰±• ¤4(€€€€€€€€€€€€¹Ñ¡•¸ ¡•¹…‰±•¤€ôøì4(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ì•¹…‰±•ô¤ì4(€€€€€€€€€€€ô¤4(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì4(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ‰ÉÉ½È¡•­¥¹œ•áÑ•¹Í¥½¸ÍÑ…Ñ”èˆ°•ÉÉ½È¤ì4(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ì•¹…‰±•è™…±Í”ô¤ì4(€€€€€€€€€€€ô¤ì4(4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€ô4(4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰Í…Ù•]½É‘ÍQ½MÑ½É…”ˆ¤ì4(€€€€€€€Í…Ù•]½É‘ÍQ½MÑ½É…” ¤ì4(€€€ô4(4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰•ÑUÍ•É%¹™¼ˆ¤ì(€€€€€€€•ÑÕÉÉ•¹ÑUÍ•É%¹™¼ ¤(€€€€€€€€€€€€¹Ñ¡•¸ ¡ÕÍ•É%¹™¼¤€ôøì(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÕÍ•É%¹™¼ô¤ì(€€€€€€€€€€€ô¤(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì4(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ‰ÉÉ½È•ÑÑ¥¹œÕÍ•È¥¹™¼èˆ°•ÉÉ½È¤ì4(€€€€€€€€€€€ô¤ì4(4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€ô4(4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰•Ñ¥É•‰…Í•%‘Q½­•¸ˆ¤ì(€€€€€€€•Ñ¥É•‰…Í•%‘Q½­•¹	œ ¤4(€€€€€€€€€€€€¹Ñ¡•¸ ¡Ñ½­•¸¤€ôøÍ•¹‘I•ÍÁ½¹Í”¡ìÑ½­•¸ô¤¤4(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì4(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ÉÉ½È•ÑÑ¥¹œ¥É•‰…Í”%Ñ½­•¸èœ°•ÉÉ½È¤ì4(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÑ½­•¸è¹Õ±°ô¤ì4(€€€€€€€€€€€ô¤ì4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ô((€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰Á•ÉÍ¥ÍÑ]½Éˆ¤ì(€€€€€€€Á•ÉÍ¥ÍÑ]½É‘5ÕÑ…Ñ¥½¸¡É•ÅÕ•ÍÐ¹Ý½É¤(€€€€€€€€€€€€¹Ñ¡•¸ ¡Ý½É¤€ôøÍ•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌèÑÉÕ”°Ý½Éô¤¤(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ‰Á•ÉÍ¥ÍÑ]½É™…¥±•èˆ°•ÉÉ½È¤ì(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌè™…±Í”°•ÉÉ½ÈèÍ•É¥…±¥é•Á¥ÉÉ½È¡•ÉÉ½È¤ô¤ì(€€€€€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ô((€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰‘•±•Ñ•]½Éˆ¤ì(€€€€€€€‘•±•Ñ•]½É‘5ÕÑ…Ñ¥½¸¡É•ÅÕ•ÍÐ¹Ý½É‘%¤(€€€€€€€€€€€€¹Ñ¡•¸ ¡Ý½É‘%¤€ôøÍ•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌèÑÉÕ”°Ý½É‘%ô¤¤(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ‰‘•±•Ñ•]½É™…¥±•èˆ°•ÉÉ½È¤ì(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌè™…±Í”°•ÉÉ½ÈèÍ•É¥…±¥é•Á¥ÉÉ½È¡•ÉÉ½È¤ô¤ì(€€€€€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ô((€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰ÕÁ‘…Ñ•Q•±•É…´ˆ¤ì(€€€€€€€ÕÁ‘…Ñ•Q•±•É…µ5ÕÑ…Ñ¥½¸¡É•ÅÕ•ÍÐ¹Ñ•±•É…µ9…µ”¤(€€€€€€€€€€€€¹Ñ¡•¸ ¡Ñ•±•É…µ9…µ”¤€ôøÍ•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌèÑÉÕ”°Ñ•±•É…µ9…µ”ô¤¤(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ‰ÕÁ‘…Ñ•Q•±•É…´™…¥±•èˆ°•ÉÉ½È¤ì(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌè™…±Í”°•ÉÉ½ÈèÍ•É¥…±¥é•Á¥ÉÉ½È¡•ÉÉ½È¤ô¤ì(€€€€€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì(€€€ô((€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰ÑÉ…¹Í±…Ñ•]½Éˆ¤ì(€€€€€€€€¡…Íå¹Œ€ ¤€ôøì4(€€€€€€€€€€€ÑÉäì4(€€€€€€€€€€€€€€€½¹ÍÐ¥‘Q½­•¸€ô…Ý…¥Ð•Ñ¥É•‰…Í•%‘Q½­•¹	œ ¤ì4(€€€€€€€€€€€€€€€¥˜€ …¥‘Q½­•¸¤Ñ¡É½Ü¹•ÜÉÉ½È 9¼¥É•‰…Í”%Ñ½­•¸œ¤ì4(€€€€€€€€€€€€€€€½¹ÍÐÕÉ°€ô€‘í™Õ¹Ñ¥½¹Í	…Í•UÉ±ô½ÑÉ…¹Í±…Ñ•]½É‘€ì(€€€€€€€€€€€€€€€½¹ÍÐÉ•Ì€ô…Ý…¥Ð™•Ñ¡]¥Ñ¡Q¥µ•½ÕÐ¡ÕÉ°°ì(€€€€€€€€€€€€€€€€€€€µ•Ñ¡½è€A=MPœ°(€€€€€€€€€€€€€€€€€€€¡•…‘•ÉÌèì4(€€€€€€€€€€€€€€€€€€€€€€€€ÕÑ¡½É¥é…Ñ¥½¸œè	•…É•È€‘í¥‘Q½­•¹õ€°4(€€€€€€€€€€€€€€€€€€€€€€€€½¹Ñ•¹ÐµQåÁ”œè€…ÁÁ±¥…Ñ¥½¸½©Í½¸œ4(€€€€€€€€€€€€€€€€€€€ô°4(€€€€€€€€€€€€€€€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ì‘…Ñ„èìÝ½ÉèÉ•ÅÕ•ÍÐ¹Ý½É°Ñ…É•Ñ1…¹Õ…”èÉ•ÅÕ•ÍÐ¹Ñ…É•Ñ1…¹Õ…”ôô¤4(€€€€€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€€€€€…Ý…¥ÐÉ•ÅÕ¥É•MÕ•ÍÍ™Õ±I•ÍÁ½¹Í”¡É•Ì°€‰QÉ…¹Í±…Ñ¥½¸ˆ¤ì(€€€€€€€€€€€€€€€½¹ÍÐ©Í½¸€ô…Ý…¥ÐÉ•Ì¹©Í½¸ ¤ì(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌèÑÉÕ”°É•ÍÕ±Ðè©Í½¸¹É•ÍÕ±Ðñð©Í½¸ô¤ì(€€€€€€€€€€€ô…Ñ €¡”¤ì(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ÑÉ…¹Í±…Ñ•]½É•ÉÉ½Èèœ°”¤ì(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌè™…±Í”°•ÉÉ½ÈèÍ•É¥…±¥é•Á¥ÉÉ½È¡”¤ô¤ì(€€€€€€€€€€€ô4(€€€€€€€ô¤ ¤ì4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€ô4(4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰¡•­MÕ‰ÍÉ¥ÁÑ¥½¹1¥µ¥ÑÌˆ¤ì4(€€€€€€€¡•­MÕ‰ÍÉ¥ÁÑ¥½¹1¥µ¥ÑÌ ¤4(€€€€€€€€€€€€¹Ñ¡•¸ ¡É•ÍÕ±Ð¤€ôøÍ•¹‘I•ÍÁ½¹Í”¡É•ÍÕ±Ð¤¤4(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì4(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ÉÉ½È¡•­¥¹œÍÕ‰ÍÉ¥ÁÑ¥½¸±¥µ¥ÑÌèœ°•ÉÉ½È¤ì4(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ì…¹‘èÑÉÕ”°É•…Í½¸è€•ÉÉ½Èœô¤ì4(€€€€€€€€€€€ô¤ì4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€ô4(4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰¥¹É•µ•¹Ñ…¥±å]½É‘½Õ¹Ðˆ¤ì4(€€€€€€€¥¹É•µ•¹Ñ…¥±å]½É‘½Õ¹Ð ¤4(€€€€€€€€€€€€¹Ñ¡•¸  ¤€ôøÍ•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌèÑÉÕ”ô¤¤4(€€€€€€€€€€€€¹…Ñ  ¡•ÉÉ½È¤€ôøì4(€€€€€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È ÉÉ½È¥¹É•µ•¹Ñ¥¹œ‘…¥±äÝ½É½Õ¹Ðèœ°•ÉÉ½È¤ì4(€€€€€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌè™…±Í”°•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”ô¤ì4(€€€€€€€€€€€ô¤ì4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€ô4)ô¤ì4(4)¡É½µ”¹ÍÑ½É…”¹½¹¡…¹•¹…‘‘1¥ÍÑ•¹•È¡…Íå¹Œ€¡¡…¹•Ì°¹…µ•ÍÁ…”¤€ôøì4(€€€¥˜€¡¹…µ•ÍÁ…”€ôôô€‰±½…°ˆ€˜˜€‰•á±Õ‘•‘M¥Ñ•Ìˆ¥¸¡…¹•Ì¤ì4(€€€€€€€…Ý…¥Ð¡…¹‘±•á±Õ‘•‘M¥Ñ•Í¡…¹”¡¡…¹•Ì¹•á±Õ‘•‘M¥Ñ•Ì¤ì4(€€€ô4(4(€€€¥˜€¡¹…µ•ÍÁ…”€ôôô€‰±½…°ˆ€˜˜€‰Ý½É‘Ìˆ¥¸¡…¹•Ì¤ì4(€€€€€€€…Ý…¥Ð¡…¹‘±•]½É‘Í¡…¹”¡¡…¹•Ì¹Ý½É‘Ì¤ì4(€€€ô4(4(€€€€¼¼]¡•¸ÕÍ•ÈÍ¥¹Ì¥¸°•¹ÍÕÉ”ÁÉ½™¥±”‘½Œ…¹¥¹¥Ñ¥…°Ý½É‘ÌÍå¹Œ(€€€¥˜€¡¹…µ•ÍÁ…”€ôôô€±½…°œ€˜˜€ÕÍ•É%¹™¼œ¥¸¡…¹•Ì€˜˜¡…¹•Ì¹ÕÍ•É%¹™¼ü¹¹•ÝY…±Õ”¤ì(€€€€€€€ÑÉäì(€€€€€€€€€€€…Ý…¥Ð™Í¹ÍÕÉ•UÍ•É½Œ¡¡…¹•Ì¹ÕÍ•É%¹™¼¹¹•ÝY…±Õ”¤ì(€€€€€€€€€€€…Ý…¥Ð™ÍMå¹]½É‘ÍÉ½µ±½Õ‘%™µÁÑä ¤ì(€€€€€€€ô…Ñ €¡”¤ì€¼¨¥¹½É”€¨¼ô(€€€ô((€€€€¼¼%˜½½±”Ñ½­•¸ÍÑ½É•½¡…¹•°•¹ÍÕÉ”¥É•‰…Í”%Ñ½­•¸•á¥ÍÑÌ(€€€¥˜€¡¹…µ•ÍÁ…”€ôôô€±½…°œ€˜˜€…ÕÑ¡}Ñ½­•¸œ¥¸¡…¹•Ì€˜˜¡…¹•Ì¹…ÕÑ¡}Ñ½­•¸ü¹¹•ÝY…±Õ”¤ì4(€€€€€€€ÑÉäì…Ý…¥Ð•¹ÍÕÉ•¥É•‰…Í•%‘Q½­•¹I•…‘ä ¤ìô…Ñ €¡”¤ì€¼¨¥¹½É”€¨¼ô4(€€€ô4(4(€€€€¼¼5¥ÉÉ½È½ÁÑ¥½¹ÌÑ¼¥É•ÍÑ½É”ÁÉ•™•É•¹•Ì4(€€€½¹ÍÐÍ•ÑÑ¥¹Í-•åÌ€ôlÑÉ…¹Í±…Ñ•Q¼œ°…¹¥µ…Ñ¥½¹Q½±”œ°Í•¹Ñ•¹•½Õ¹Ñ•Èœ°¡¥¡±¥¡Ñ¥¹¹…‰±•œ°™É•ÅÕ•¹å½±½É¥¹¹…‰±•œ°¡¥¡±¥¡Ñ½±½Èœ°ÑÉ…¹Í±…Ñ¥½¹½±½Ètì(€€€¥˜€¡¹…µ•ÍÁ…”€ôôô€±½…°œ€˜˜Í•ÑÑ¥¹Í-•åÌ¹Í½µ”¡¬€ôø¬¥¸¡…¹•Ì¤¤ì4(€€€€€€€ÑÉäì4(€€€€€€€€€€€½¹ÍÐìÕÍ•É%¹™¼ô€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÕÍ•É%¹™¼t¤ì4(€€€€€€€€€€€¥˜€ …ÕÍ•É%¹™¼¤É•ÑÕÉ¸ì4(€€€€€€€€€€€½¹ÍÐ¡•…‘•ÉÌ€ô…Ý…¥Ð™Í!•…‘•ÉÌ ¤ì4(€€€€€€€€€€€¥˜€ …¡•…‘•ÉÌ¤É•ÑÕÉ¸ì4(€€€€€€€€€€€½¹ÍÐÕ¥€ôÕÍ•É%¹™¼¹¥ñðÕÍ•É%¹™¼¹Õ¥ì4(€€€€€€€€€€€¥˜€ …Õ¥¤É•ÑÕÉ¸ì4(€€€€€€€€€€€½¹ÍÐÕÉ°€ô€‘í%IMQ=I}	Mô½ÕÍ•ÉÌ¼‘íÕ¥‘ô½ÕÍ•ÉM•ÑÑ¥¹Ì½ÁÉ•™•É•¹•Í€ì4(€€€€€€€€€€€½¹ÍÐÕÉÉ•¹Ð€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡Í•ÑÑ¥¹Í-•åÌ¤ì4(€€€€€€€€€€€½¹ÍÐ‰½‘ä€ô™Í¹½‘•¥•±‘Ì¡ì4(€€€€€€€€€€€€€€€ÑÉ…¹Í±…Ñ•Q¼èÕÉÉ•¹Ð¹ÑÉ…¹Í±…Ñ•Q¼ñð€Õ¬œ°(€€€€€€€€€€€€€€€…¹¥µ…Ñ¥½¹Q½±”è€¡ÕÉÉ•¹Ð¹…¹¥µ…Ñ¥½¹Q½±”€ôôô€ÑÉÕ”œ¤ñðÕÉÉ•¹Ð¹…¹¥µ…Ñ¥½¹Q½±”€ôôôÑÉÕ”°4(€€€€€€€€€€€€€€€Í•¹Ñ•¹•½Õ¹Ñ•Èè9Õµ‰•È¡ÕÉÉ•¹Ð¹Í•¹Ñ•¹•½Õ¹Ñ•Èñð€Ä¤°4(€€€€€€€€€€€€€€€¡¥¡±¥¡Ñ¥¹¹…‰±•èÕÉÉ•¹Ð¹¡¥¡±¥¡Ñ¥¹¹…‰±•€„ôô™…±Í”°(€€€€€€€€€€€€€€€™É•ÅÕ•¹å½±½É¥¹¹…‰±•èÕÉÉ•¹Ð¹™É•ÅÕ•¹å½±½É¥¹¹…‰±•€„ôô™…±Í”°(€€€€€€€€€€€€€€€¡¥¡±¥¡Ñ½±½ÈèÕÉÉ•¹Ð¹¡¥¡±¥¡Ñ½±½Èñð€É‰„ ÈÔÔ°€À°€À°€À¸ÈÈ¤œ°4(€€€€€€€€€€€€€€€ÑÉ…¹Í±…Ñ¥½¹½±½ÈèÕÉÉ•¹Ð¹ÑÉ…¹Í±…Ñ¥½¹½±½Èñð€œÁÁÀœ°4(€€€€€€€€€€€€€€€ÕÁ‘…Ñ•‘Ðè¹•Ü…Ñ” ¤4(€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€…Ý…¥Ð™•Ñ ¡ÕÉ°°ìµ•Ñ¡½è€AQ œ°¡•…‘•ÉÌ°‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡‰½‘ä¤ô¤ì4(€€€€€€€ô…Ñ €¡”¤ì4(€€€€€€€€€€€½¹Í½±”¹Ý…É¸ …¥±•Ñ¼µ¥ÉÉ½ÈÍ•ÑÑ¥¹Ìèœ°”ü¹µ•ÍÍ…”ñð”¤ì4(€€€€€€€ô4(€€€ô4)ô¤ì4(4(¼¼MÕ‰ÍÉ¥ÁÑ¥½¸µ…¹…•µ•¹Ð™Õ¹Ñ¥½¹Ì4)…Íå¹Œ™Õ¹Ñ¥½¸¡•­MÕ‰ÍÉ¥ÁÑ¥½¹1¥µ¥ÑÌ ¤ì4(€€€ÑÉäì4(€€€€€€€½¹ÍÐ¡•…‘•ÉÌ€ô…Ý…¥Ð™Í!•…‘•ÉÌ ¤ì4(€€€€€€€¥˜€ …¡•…‘•ÉÌ¤É•ÑÕÉ¸ì…¹‘èÑÉÕ”°É•…Í½¸è€¹½}…ÕÑ œôì4(4(€€€€€€€½¹ÍÐÕ¥€ô…Ý…¥Ð•ÑÕÑ¡U¥‘	œ ¤ì4(€€€€€€€¥˜€ …Õ¥¤É•ÑÕÉ¸ì…¹‘èÑÉÕ”°É•…Í½¸è€¹½}Õ¥œôì4(4(€€€€€€€½¹ÍÐÕÉ°€ô€‘í%IMQ=I}	Mô½ÕÍ•ÉÌ¼‘íÕ¥‘õ€ì4(€€€€€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð™•Ñ ¡ÕÉ°°ì¡•…‘•ÉÌô¤ì4(€€€€€€€€4(€€€€€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì4(€€€€€€€€€€€€¼¼UÍ•È‘½Õµ•¹Ð‘½•Í¸Ð•á¥ÍÐ°É•…Ñ”‘•™…Õ±Ð…¹…±±½Ü4(€€€€€€€€€€€…Ý…¥ÐÉ•…Ñ••™…Õ±ÑUÍ•ÉMÕ‰ÍÉ¥ÁÑ¥½¸¡Õ¥¤ì4(€€€€€€€€€€€É•ÑÕÉ¸ì…¹‘èÑÉÕ”°É•…Í½¸è€¹•Ý}ÕÍ•Èœ°‘…¥±å]½É‘Í‘‘•è€À°‘…¥±å]½É‘1¥µ¥Ðè€Ôôì4(€€€€€€€ô4(4(€€€€€€€½¹ÍÐÕÍ•É…Ñ„€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹©Í½¸ ¤ì4(€€€€€€€½¹ÍÐ™¥•±‘Ì€ôÕÍ•É…Ñ„¹™¥•±‘Ìñðíôì4(€€€€€€€€4(€€€€€€€½¹ÍÐÍÕ‰ÍÉ¥ÁÑ¥½¹MÑ…ÑÕÌ€ô™¥•±‘Ì¹ÍÕ‰ÍÉ¥ÁÑ¥½¹MÑ…ÑÕÌü¹ÍÑÉ¥¹Y…±Õ”ñð€™É•”œì4(€€€€€€€½¹ÍÐÑ½‘…ä€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹ÍÁ±¥Ð Pœ¥lÁtì4(€€€€€€€½¹ÍÐ‘…¥±å]½É‘ÍI•Í•Ñ…Ñ”€ô™¥•±‘Ì¹‘…¥±å]½É‘ÍI•Í•Ñ…Ñ”ü¹ÍÑÉ¥¹Y…±Õ”ñðÑ½‘…äì4(€€€€€€€½¹ÍÐ‘…¥±å]½É‘Í‘‘•€ô™¥•±‘Ì¹‘…¥±å]½É‘Í‘‘•ü¹¥¹Ñ••ÉY…±Õ”ñð™¥•±‘Ì¹‘…¥±å]½É‘Í‘‘•ü¹‘½Õ‰±•Y…±Õ”ñð€Àì4(€€€€€€€€4(€€€€€€€€¼¼I•Í•Ð‘…¥±ä½Õ¹Ð¥˜¥ÐÌ„¹•Ü‘…ä4(€€€€€€€½¹ÍÐÉ•Í•Ñ…¥±å½Õ¹Ð€ô‘…¥±å]½É‘ÍI•Í•Ñ…Ñ”€„ôôÑ½‘…äì4(€€€€€€€½¹ÍÐÕÉÉ•¹Ñ…¥±å½Õ¹Ð€ôÉ•Í•Ñ…¥±å½Õ¹Ð€ü€À€è9Õµ‰•È¡‘…¥±å]½É‘Í‘‘•¤ì4(€€€€€€€€4(€€€€€€€€¼¼¡•¬¥˜ÕÍ•È¡…ÌÁÉ•µ¥Õ´…•ÍÌ4(€€€€€€€½¹ÍÐ¥ÍAÉ•µ¥Õ´€ôÍÕ‰ÍÉ¥ÁÑ¥½¹MÑ…ÑÕÌ€ôôô€ÁÉ•µ¥Õ´œñðÍÕ‰ÍÉ¥ÁÑ¥½¹MÑ…ÑÕÌ€ôôô€±¥™•Ñ¥µ”œì4(€€€€€€€€4(€€€€€€€¥˜€¡¥ÍAÉ•µ¥Õ´¤ì4(€€€€€€€€€€€É•ÑÕÉ¸ì€4(€€€€€€€€€€€€€€€…¹‘èÑÉÕ”°€4(€€€€€€€€€€€€€€€É•…Í½¸è€ÁÉ•µ¥Õ´œ°€4(€€€€€€€€€€€€€€€‘…¥±å]½É‘Í‘‘•èÕÉÉ•¹Ñ…¥±å½Õ¹Ð°4(€€€€€€€€€€€€€€€¥ÍAÉ•µ¥Õ´èÑÉÕ”°4(€€€€€€€€€€€€€€€¹••‘ÍI•Í•ÐèÉ•Í•Ñ…¥±å½Õ¹Ð4(€€€€€€€€€€€ôì4(€€€€€€€ô4(4(€€€€€€€€¼¼É•”ÕÍ•È€´¡•¬‘…¥±ä±¥µ¥Ð4(€€€€€€€½¹ÍÐ‘…¥±å1¥µ¥Ð€ô€Ôì4(€€€€€€€½¹ÍÐ…¹‘€ôÕÉÉ•¹Ñ…¥±å½Õ¹Ð€ð‘…¥±å1¥µ¥Ðì4(€€€€€€€€4(€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€…¹‘°4(€€€€€€€€€€€É•…Í½¸è…¹‘€ü€Ý¥Ñ¡¥¹}±¥µ¥Ðœ€è€‘…¥±å}±¥µ¥Ñ}É•…¡•œ°4(€€€€€€€€€€€‘…¥±å]½É‘Í‘‘•èÕÉÉ•¹Ñ…¥±å½Õ¹Ð°4(€€€€€€€€€€€‘…¥±å]½É‘1¥µ¥Ðè‘…¥±å1¥µ¥Ð°4(€€€€€€€€€€€¥ÍAÉ•µ¥Õ´è™…±Í”°4(€€€€€€€€€€€¹••‘ÍI•Í•ÐèÉ•Í•Ñ…¥±å½Õ¹Ð4(€€€€€€€ôì4(€€€ô…Ñ €¡•ÉÉ½È¤ì4(€€€€€€€½¹Í½±”¹•ÉÉ½È ÉÉ½È¡•­¥¹œÍÕ‰ÍÉ¥ÁÑ¥½¸±¥µ¥ÑÌèœ°•ÉÉ½È¤ì4(€€€€€€€€¼¼•™…Õ±ÐÑ¼…±±½Ý¥¹œ½¸•ÉÉ½ÈÑ¼…Ù½¥‰±½­¥¹œÕÍ•ÉÌ4(€€€€€€€É•ÑÕÉ¸ì…¹‘èÑÉÕ”°É•…Í½¸è€•ÉÉ½Èœôì4(€€€ô4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸¥¹É•µ•¹Ñ…¥±å]½É‘½Õ¹Ð ¤ì4(€€€ÑÉäì4(€€€€€€€½¹ÍÐ¡•…‘•ÉÌ€ô…Ý…¥Ð™Í!•…‘•ÉÌ ¤ì4(€€€€€€€¥˜€ …¡•…‘•ÉÌ¤É•ÑÕÉ¸ì4(4(€€€€€€€½¹ÍÐÕ¥€ô…Ý…¥Ð•ÑÕÑ¡U¥‘	œ ¤ì4(€€€€€€€¥˜€ …Õ¥¤É•ÑÕÉ¸ì4(4(€€€€€€€€¼¼•ÐÕÉÉ•¹ÐÍÕ‰ÍÉ¥ÁÑ¥½¸‘…Ñ„4(€€€€€€€½¹ÍÐ±¥µ¥Ñ¡•¬€ô…Ý…¥Ð¡•­MÕ‰ÍÉ¥ÁÑ¥½¹1¥µ¥ÑÌ ¤ì4(€€€€€€€½¹ÍÐÑ½‘…ä€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹ÍÁ±¥Ð Pœ¥lÁtì4(€€€€€€€€4(€€€€€€€±•Ð¹•Ý½Õ¹Ð€ô±¥µ¥Ñ¡•¬¹‘…¥±å]½É‘Í‘‘•€¬€Äì4(€€€€€€€¥˜€¡±¥µ¥Ñ¡•¬¹¹••‘ÍI•Í•Ð¤ì4(€€€€€€€€€€€¹•Ý½Õ¹Ð€ô€Äì€¼¼I•Í•ÐÑ¼€Ä™½È¹•Ü‘…ä4(€€€€€€€ô4(4(€€€€€€€½¹ÍÐÕÉ°€ô€‘í%IMQ=I}	Mô½ÕÍ•ÉÌ¼‘íÕ¥‘õ€ì4(€€€€€€€½¹ÍÐÕÁ‘…Ñ•…Ñ„€ôì4(€€€€€€€€€€€™¥•±‘Ìèì4(€€€€€€€€€€€€€€€‘…¥±å]½É‘Í‘‘•èì¥¹Ñ••ÉY…±Õ”èMÑÉ¥¹œ¡¹•Ý½Õ¹Ð¤ô°4(€€€€€€€€€€€€€€€‘…¥±å]½É‘ÍI•Í•Ñ…Ñ”èìÍÑÉ¥¹Y…±Õ”èÑ½‘…äô4(€€€€€€€€€€€ô4(€€€€€€€ôì4(4(€€€€€€€…Ý…¥Ð™•Ñ ¡ÕÉ°°ì4(€€€€€€€€€€€µ•Ñ¡½è€AQ œ°4(€€€€€€€€€€€¡•…‘•ÉÌ°4(€€€€€€€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ÕÁ‘…Ñ•…Ñ„¤4(€€€€€€€ô¤ì4(4(€€€€€€€½¹Í½±”¹±½œ¡…¥±äÝ½É½Õ¹ÐÕÁ‘…Ñ•Ñ¼€‘í¹•Ý½Õ¹Ñô™½È€‘íÑ½‘…åõ€¤ì4(€€€ô…Ñ €¡•ÉÉ½È¤ì4(€€€€€€€½¹Í½±”¹•ÉÉ½È ÉÉ½È¥¹É•µ•¹Ñ¥¹œ‘…¥±äÝ½É½Õ¹Ðèœ°•ÉÉ½È¤ì4(€€€ô4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸É•…Ñ••™…Õ±ÑUÍ•ÉMÕ‰ÍÉ¥ÁÑ¥½¸¡Õ¥¤ì4(€€€ÑÉäì4(€€€€€€€½¹ÍÐ¡•…‘•ÉÌ€ô…Ý…¥Ð™Í!•…‘•ÉÌ ¤ì4(€€€€€€€¥˜€ …¡•…‘•ÉÌ¤É•ÑÕÉ¸ì4(4(€€€€€€€½¹ÍÐìÕÍ•É%¹™¼ô€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÕÍ•É%¹™¼t¤ì4(€€€€€€€½¹ÍÐÑ½‘…ä€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤¹ÍÁ±¥Ð Pœ¥lÁtì4(€€€€€€€½¹ÍÐ¹½Ü€ô¹•Ü…Ñ” ¤¹Ñ½%M=MÑÉ¥¹œ ¤ì4(4(€€€€€€€½¹ÍÐÕÉ°€ô€‘í%IMQ=I}	Mô½ÕÍ•ÉÌ¼‘íÕ¥‘õ€ì4(€€€€€€€½¹ÍÐÕÍ•É…Ñ„€ôì4(€€€€€€€€€€€™¥•±‘Ìèì4(€€€€€€€€€€€€€€€Õ¥èìÍÑÉ¥¹Y…±Õ”èÕ¥ô°4(€€€€€€€€€€€€€€€•µ…¥°èìÍÑÉ¥¹Y…±Õ”èÕÍ•É%¹™¼ü¹•µ…¥°ñð€œœô°4(€€€€€€€€€€€€€€€‘¥ÍÁ±…å9…µ”èìÍÑÉ¥¹Y…±Õ”èÕÍ•É%¹™¼ü¹¹…µ”ñðÕÍ•É%¹™¼ü¹‘¥ÍÁ±…å9…µ”ñð€œœô°4(€€€€€€€€€€€€€€€Á¡½Ñ½UI0èìÍÑÉ¥¹Y…±Õ”èÕÍ•É%¹™¼ü¹Á¥ÑÕÉ”ñðÕÍ•É%¹™¼ü¹Á¡½Ñ½UI0ñð€œœô°4(€€€€€€€€€€€€€€€ÍÕ‰ÍÉ¥ÁÑ¥½¹MÑ…ÑÕÌèìÍÑÉ¥¹Y…±Õ”è€™É•”œô°4(€€€€€€€€€€€€€€€‘…¥±å]½É‘Í‘‘•èì¥¹Ñ••ÉY…±Õ”è€œÀœô°4(€€€€€€€€€€€€€€€‘…¥±å]½É‘ÍI•Í•Ñ…Ñ”èìÍÑÉ¥¹Y…±Õ”èÑ½‘…äô°4(€€€€€€€€€€€€€€€‘…¥±å]½É‘1¥µ¥Ðèì¥¹Ñ••ÉY…±Õ”è€œÔœô°4(€€€€€€€€€€€€€€€É•…Ñ•‘ÐèìÑ¥µ•ÍÑ…µÁY…±Õ”è¹½Üô°4(€€€€€€€€€€€€€€€±…ÍÑ1½¥¹ÐèìÑ¥µ•ÍÑ…µÁY…±Õ”è¹½Üô4(€€€€€€€€€€€ô4(€€€€€€€ôì4(4(€€€€€€€…Ý…¥Ð™•Ñ ¡ÕÉ°°ì4(€€€€€€€€€€€µ•Ñ¡½è€AQ œ°4(€€€€€€€€€€€¡•…‘•ÉÌ°4(€€€€€€€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ÕÍ•É…Ñ„¤4(€€€€€€€ô¤ì4(4(€€€€€€€½¹Í½±”¹±½œ É•…Ñ•‘•™…Õ±ÐÕÍ•ÈÍÕ‰ÍÉ¥ÁÑ¥½¸‘½Õµ•¹Ðœ¤ì4(€€€ô…Ñ €¡•ÉÉ½È¤ì4(€€€€€€€½¹Í½±”¹•ÉÉ½È ÉÉ½ÈÉ•…Ñ¥¹œ‘•™…Õ±ÐÕÍ•ÈÍÕ‰ÍÉ¥ÁÑ¥½¸èœ°•ÉÉ½È¤ì4(€€€ô4)ô4(4)™Õ¹Ñ¥½¸Í¡½Ý]•±½µ•A…” ¤ì(€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÝ•±½µ•M¡½Ý¸œ°€½¹‰½…É‘¥¹½µÁ±•Ñ•t°€¡É•ÍÕ±Ð¤€ôøì(€€€€€€€¥˜€ …É•ÍÕ±Ð¹Ý•±½µ•M¡½Ý¸€˜˜€…É•ÍÕ±Ð¹½¹‰½…É‘¥¹½µÁ±•Ñ•¤ì(€€€€€€€€€€€¡É½µ”¹Ñ…‰Ì¹É•…Ñ”¡ì(€€€€€€€€€€€€€€€ÕÉ°è¡É½µ”¹ÉÕ¹Ñ¥µ”¹•ÑUI0 ½¹‰½…É‘¥¹œ¹¡Ñµ°œ¤°(€€€€€€€€€€€€€€€…Ñ¥Ù”èÑÉÕ”(€€€€€€€€€€€ô¤ì(€€€€€€€ô4(€€€ô¤ì4)ô4(4)™Õ¹Ñ¥½¸¡•­]•±½µ•MÑ…ÑÕÌ ¤ì4(€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÝ•±½µ•M¡½Ý¸œ°€½¹‰½…É‘¥¹½µÁ±•Ñ•t°€¡É•ÍÕ±Ð¤€ôøì4(€€€€€€€€¼¼%˜¹•¥Ñ¡•ÈÝ•±½µ”¹½È½¹‰½…É‘¥¹œÝ…Ì½µÁ±•Ñ•°Í¡½ÜÝ•±½µ”4(€€€€€€€¥˜€ …É•ÍÕ±Ð¹Ý•±½µ•M¡½Ý¸€˜˜€…É•ÍÕ±Ð¹½¹‰½…É‘¥¹½µÁ±•Ñ•¤ì4(€€€€€€€€€€€Í¡½Ý]•±½µ•A…” ¤ì4(€€€€€€€ô4(€€€ô¤ì4)ô4(4(¼¼!…¹‘±”Ý•±½µ”Á…”É•ÅÕ•ÍÑÌ4)¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È ¡É•ÅÕ•ÍÐ°Í•¹‘•È°Í•¹‘I•ÍÁ½¹Í”¤€ôøì4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€½Á•¹]•±½µ”œ¤ì4(€€€€€€€Í¡½Ý]•±½µ•A…” ¤ì4(€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌèÑÉÕ”ô¤ì4(€€€ô4(€€€€4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€½Á•¹=¹‰½…É‘¥¹œœ¤ì4(€€€€€€€¡É½µ”¹Ñ…‰Ì¹É•…Ñ”¡ì4(€€€€€€€€€€€ÕÉ°è¡É½µ”¹ÉÕ¹Ñ¥µ”¹•ÑUI0 ½¹‰½…É‘¥¹œ¹¡Ñµ°œ¤°4(€€€€€€€€€€€…Ñ¥Ù”èÑÉÕ”4(€€€€€€€ô¤ì4(€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ìÍÕ•ÍÌèÑÉÕ”ô¤ì4(€€€ô4(€€€€4(€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€¡•­]•±½µ•MÑ…ÑÕÌœ¤ì4(€€€€€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÝ•±½µ•M¡½Ý¸œ°€½¹‰½…É‘¥¹½µÁ±•Ñ•t°€¡É•ÍÕ±Ð¤€ôøì4(€€€€€€€€€€€Í•¹‘I•ÍÁ½¹Í”¡ì4(€€€€€€€€€€€€€€€Ý•±½µ•M¡½Ý¸èÉ•ÍÕ±Ð¹Ý•±½µ•M¡½Ý¸ñð™…±Í”°4(€€€€€€€€€€€€€€€½¹‰½…É‘¥¹½µÁ±•Ñ•èÉ•ÍÕ±Ð¹½¹‰½…É‘¥¹½µÁ±•Ñ•ñð™…±Í”4(€€€€€€€€€€€ô¤ì4(€€€€€€€ô¤ì4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€ô4)ô¤ì4(4(¼¼ÑÑ•µÁÐÑ¼ÁÉ•Á…É”¥É•‰…Í”%Ñ½­•¸½¸Í•ÉÙ¥”Ý½É­•ÈÍÑ…ÉÐ4(¡…Íå¹Œ€ ¤€ôøìÑÉäì…Ý…¥Ð•¹ÍÕÉ•¥É•‰…Í•%‘Q½­•¹I•…‘ä ¤ìô…Ñ €¡”¤ì€¼¨¥¹½É”€¨¼ôô¤ ¤ì4(