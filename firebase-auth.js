// Chrome Identity API authentication functions for Chrome extension
// Adds Firebase-compatible token exchange (ID token) without touching business logic

// Firebase API key for token exchange
const FIREBASE_API_KEY = "AIzaSyDhSsOp7mkwf4NVeYIhk_RZZNaHpC0ZUho";

async function exchangeGoogleTokenForFirebaseIdToken(googleAccessToken) {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`;
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
    const expiresInMs = (parseInt(data.expiresIn || '3600') - 60) * 1000; // 60s buffer
    await chrome.storage.local.set({
        firebase_id_token: data.idToken,
        firebase_refresh_token: data.refreshToken,
        firebase_token_exp: now + expiresInMs
    });
    return data.idToken;
}

async function refreshFirebaseIdToken(refreshToken) {
    const url = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
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

async function getFirebaseIdToken() {
    const state = await new Promise((resolve) => {
        chrome.storage.local.get(['firebase_id_token','firebase_refresh_token','firebase_token_exp','auth_token'], resolve);
    });
    const now = Date.now();
    if (state.firebase_id_token && state.firebase_token_exp && now < state.firebase_token_exp) {
        return state.firebase_id_token;
    }
    if (state.firebase_refresh_token) {
        try { return await refreshFirebaseIdToken(state.firebase_refresh_token); } catch (_) {}
    }
    if (state.auth_token) {
        try { return await exchangeGoogleTokenForFirebaseIdToken(state.auth_token); } catch (_) {}
    }
    return null;
}

// Google OAuth provider (Chrome Identity API)
function createGoogleProvider() {
    // Chrome identity API handles this automatically
    return {
        scopes: ['profile', 'email']
    };
}

// Sign in with Google using Chrome identity API (simplified for extension)
async function signInWithGoogle() {
    try {
        // Use Chrome identity API to get auth token directly
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (token) {
                    // Get user info from Google API
                    fetch('https://www.googleapis.com/oauth2/v1/userinfo?access_token=' + token)
                        .then(response => response.json())
                        .then(userInfo => {
                            // Store the token and user info
                            chrome.storage.local.set({
                                'auth_token': token,
                                'user_info': userInfo,
                                'userInfo': userInfo,
                                'token': token
                            }, () => {
                                console.log('Authentication token and user info stored');
                                // Best-effort exchange for Firebase ID token for backend/Firebase usage
                                exchangeGoogleTokenForFirebaseIdToken(token)
                                    .catch((e) => console.warn('Firebase ID token exchange failed:', e?.message || e));
                                resolve({
                                    user: {
                                        accessToken: token,
                                        email: userInfo.email,
                                        name: userInfo.name,
                                        picture: userInfo.picture
                                    }
                                });
                            });
                        })
                        .catch(error => {
                            console.error('Error fetching user info:', error);
                            // Still resolve with basic info
                            chrome.storage.local.set({ 'auth_token': token, 'token': token }, () => {
                                exchangeGoogleTokenForFirebaseIdToken(token)
                                    .catch((e) => console.warn('Firebase ID token exchange failed:', e?.message || e));
                                resolve({
                                    user: {
                                        accessToken: token,
                                        email: 'user@gmail.com'
                                    }
                                });
                            });
                        });
                } else {
                    reject(new Error('No token received'));
                }
            });
        });
    } catch (error) {
        console.error('Sign in error:', error);
        throw error;
    }
}

// Sign out
async function signOut() {
    try {
        // Get current token and remove it
        const token = await getCachedToken();
        if (token) {
            chrome.identity.removeCachedAuthToken({ token }, () => {
                console.log('Token removed from cache');
            });
        }

        // Clear local storage
        chrome.storage.local.remove(['auth_token', 'user_info', 'userInfo', 'token'], () => {
            console.log('Signed out successfully');
        });
    } catch (error) {
        console.error('Sign out error:', error);
        throw error;
    }
}

// Get current user (from Chrome storage)
async function getCurrentUser() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['auth_token', 'user_info'], (result) => {
            if (result.auth_token) {
                resolve(result.user_info || { accessToken: result.auth_token });
            } else {
                resolve(null);
            }
        });
    });
}

// Listen for auth state changes (simplified for extension)
function onAuthStateChanged(callback) {
    // Check current auth state immediately
    getCurrentUser().then(callback);

    // Listen for storage changes (but don't re-add listeners)
    if (!window.authStateListenerAdded) {
        chrome.storage.onChanged.addListener((changes) => {
            if (changes.auth_token || changes.user_info) {
                getCurrentUser().then(callback);
            }
        });
        window.authStateListenerAdded = true;
    }
}

// Get cached Chrome identity token
function getCachedToken() {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            resolve(token);
        });
    });
}

// Export functions to global scope for use in other scripts
window.firebaseAuth = {
    signInWithGoogle,
    signOut,
    getCurrentUser,
    onAuthStateChanged,
    createGoogleProvider,
    getFirebaseIdToken
};
