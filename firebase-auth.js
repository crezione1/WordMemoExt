// Firebase authentication functions for Chrome extension
// Using global firebase object instead of ES6 modules

// Google OAuth provider
function createGoogleProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    return provider;
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
                    // Store the token and simulate successful login
                    chrome.storage.local.set({ 'auth_token': token }, () => {
                        console.log('Authentication token stored');
                        resolve({ 
                            user: { 
                                accessToken: token,
                                email: 'user@gmail.com' // This will be populated from user info API
                            } 
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
    // Check current auth state
    getCurrentUser().then(callback);
    
    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.auth_token || changes.user_info) {
            getCurrentUser().then(callback);
        }
    });
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