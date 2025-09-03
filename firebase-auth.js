// Chrome Identity API authentication functions for Chrome extension
// No Firebase dependencies

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
                                'user_info': userInfo
                            }, () => {
                                console.log('Authentication token and user info stored');
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
                            chrome.storage.local.set({ 'auth_token': token }, () => {
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
        chrome.storage.local.remove(['auth_token', 'user_info'], () => {
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
    createGoogleProvider
};