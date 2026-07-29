const {
    firebaseApiKey,
    identityRequestUri
} = globalThis.LAZYLEX_CONFIG;

function getReadableAuthError(error) {
    const rawMessage = String(error?.message || error || "").trim();
    const normalizedMessage = rawMessage.toLowerCase();
    const extensionId = chrome.runtime?.id || "unknown";

    if (
        normalizedMessage.includes("bad client id") ||
        normalizedMessage.includes("invalid oauth") ||
        normalizedMessage.includes("oauth2 request failed") ||
        normalizedMessage.includes("redirect_uri_mismatch") ||
        normalizedMessage.includes("unauthorized_client")
    ) {
        return `Google sign-in is not configured for this local extension (${extensionId}). Rebuild with an OAuth client registered for this extension ID.`;
    }

    if (
        normalizedMessage.includes("user did not approve") ||
        normalizedMessage.includes("user rejected") ||
        normalizedMessage.includes("cancelled") ||
        normalizedMessage.includes("canceled")
    ) {
        return "Google sign-in was cancelled.";
    }

    if (
        normalizedMessage.includes("network") ||
        normalizedMessage.includes("failed to fetch")
    ) {
        return "Google sign-in could not reach the authentication service. Check your connection and try again.";
    }

    if (normalizedMessage.includes("operation_not_allowed")) {
        return "Google sign-in is disabled for this Firebase project.";
    }

    return "Google sign-in failed. Inspect the extension popup for details and try again.";
}

function getGoogleAuthToken(interactive) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            if (!token) {
                reject(new Error("Google did not return an access token"));
                return;
            }

            resolve(token);
        });
    });
}

function decodeJwtPayload(token) {
    try {
        const payload = token.split(".")[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/");
        const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
        return JSON.parse(atob(padded));
    } catch {
        return {};
    }
}

async function exchangeGoogleTokenForFirebaseIdToken(googleAccessToken) {
    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${firebaseApiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                postBody: `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`,
                requestUri: identityRequestUri,
                returnIdpCredential: true,
                returnSecureToken: true
            })
        }
    );

    if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const errorCode = errorBody?.error?.message || `HTTP_${response.status}`;
        throw new Error(`Firebase sign-in failed: ${errorCode}`);
    }

    const data = await response.json();
    const expiresInMs = Math.max(0, (Number.parseInt(data.expiresIn || "3600", 10) - 60) * 1000);

    await chrome.storage.local.set({
        firebase_id_token: data.idToken,
        firebase_refresh_token: data.refreshToken,
        firebase_token_exp: Date.now() + expiresInMs
    });

    return data.idToken;
}

async function refreshFirebaseIdToken(refreshToken) {
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken
    });
    const response = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${firebaseApiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString()
        }
    );

    if (!response.ok) {
        throw new Error(`Firebase token refresh failed with status ${response.status}`);
    }

    const data = await response.json();
    const expiresInMs = Math.max(0, (Number.parseInt(data.expires_in || "3600", 10) - 60) * 1000);

    await chrome.storage.local.set({
        firebase_id_token: data.id_token,
        firebase_refresh_token: data.refresh_token || refreshToken,
        firebase_token_exp: Date.now() + expiresInMs
    });

    return data.id_token;
}

async function getFirebaseIdToken() {
    const state = await chrome.storage.local.get([
        "firebase_id_token",
        "firebase_refresh_token",
        "firebase_token_exp",
        "auth_token"
    ]);

    if (
        state.firebase_id_token &&
        state.firebase_token_exp &&
        Date.now() < state.firebase_token_exp
    ) {
        return state.firebase_id_token;
    }

    if (state.firebase_refresh_token) {
        try {
            return await refreshFirebaseIdToken(state.firebase_refresh_token);
        } catch {
            // Fall back to a fresh Google-to-Firebase exchange below.
        }
    }

    if (state.auth_token) {
        return exchangeGoogleTokenForFirebaseIdToken(state.auth_token);
    }

    return null;
}

function createGoogleProvider() {
    return {
        scopes: ["openid", "profile", "email"]
    };
}

async function signInWithGoogle() {
    const googleAccessToken = await getGoogleAuthToken(true);
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v1/userinfo", {
        headers: { Authorization: `Bearer ${googleAccessToken}` }
    });

    if (!userInfoResponse.ok) {
        throw new Error(`Google profile request failed with status ${userInfoResponse.status}`);
    }

    const googleUser = await userInfoResponse.json();
    const firebaseIdToken = await exchangeGoogleTokenForFirebaseIdToken(googleAccessToken);
    const firebaseClaims = decodeJwtPayload(firebaseIdToken);
    const userInfo = {
        ...googleUser,
        uid: firebaseClaims.user_id || firebaseClaims.sub,
        emailVerified: firebaseClaims.email_verified === true
    };

    await chrome.storage.local.set({
        auth_token: googleAccessToken,
        user_info: userInfo,
        userInfo
    });

    return {
        user: {
            uid: userInfo.uid,
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture
        }
    };
}

async function signOut() {
    let token = null;

    try {
        token = await getGoogleAuthToken(false);
    } catch {
        // A missing cached Google token still permits a local sign-out.
    }

    if (token) {
        await new Promise((resolve) => {
            chrome.identity.removeCachedAuthToken({ token }, resolve);
        });
    }

    await chrome.storage.local.remove([
        "auth_token",
        "user_info",
        "userInfo",
        "token",
        "firebase_id_token",
        "firebase_refresh_token",
        "firebase_token_exp",
        "words"
    ]);
}

async function getCurrentUser() {
    const result = await chrome.storage.local.get([
        "auth_token",
        "firebase_id_token",
        "user_info",
        "userInfo"
    ]);

    if (!result.auth_token || !result.firebase_id_token) {
        return null;
    }

    const user = {
        ...(result.user_info || {}),
        ...(result.userInfo || {})
    };
    return Object.keys(user).length > 0 ? user : null;
}

function onAuthStateChanged(callback) {
    getCurrentUser().then(callback);

    if (!window.authStateListenerAdded) {
        chrome.storage.onChanged.addListener((changes) => {
            if (
                changes.auth_token ||
                changes.firebase_id_token ||
                changes.user_info ||
                changes.userInfo
            ) {
                getCurrentUser().then(callback);
            }
        });
        window.authStateListenerAdded = true;
    }
}

async function signInWithEmailPassword() {
    throw new Error("Use Google sign-in in the local QA extension");
}

async function getEmailVerificationStatus() {
    const { userInfo } = await chrome.storage.local.get(["userInfo"]);
    return userInfo?.emailVerified === true;
}

window.firebaseAuth = {
    signInWithGoogle,
    signInWithEmailPassword,
    signOut,
    getCurrentUser,
    onAuthStateChanged,
    createGoogleProvider,
    getFirebaseIdToken,
    getEmailVerificationStatus,
    getReadableAuthError
};
