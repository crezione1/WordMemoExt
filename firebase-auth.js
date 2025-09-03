// Firebase authentication functions for Chrome extension
// Using global firebase object instead of ES6 modules

// Google OAuth provider
function createGoogleProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    return provider;
}

// Sign in with Google using Chrome identity API
async function signInWithGoogle() {
    try {
        // Initialize Firebase if not already done
        const auth = window.initializeFirebase();
        if (!auth) {
            throw new Error('Firebase not initialized');
        }

        // Use Chrome identity API to get Google access token
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                
                // Create credential from token
                const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
                
                // Sign in with credential
                auth.signInWithCredential(credential)
                    .then((result) => {
                        console.log('Successfully signed in:', result.user);
                        resolve(result);
                    })
                    .catch((error) => {
                        console.error('Firebase sign in error:', error);
                        reject(error);
                    });
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
        const auth = window.getAuth();
        if (auth) {
            await auth.signOut();
            
            // Also remove Chrome identity token
            chrome.identity.removeCachedAuthToken({
                token: await getCachedToken()
            }, () => {
                console.log('Signed out successfully');
            });
        }
    } catch (error) {
        console.error('Sign out error:', error);
        throw error;
    }
}

// Get current user
function getCurrentUser() {
    const auth = window.getAuth();
    return auth ? auth.currentUser : null;
}

// Listen for auth state changes
function onAuthStateChanged(callback) {
    const auth = window.getAuth();
    if (auth) {
        return auth.onAuthStateChanged(callback);
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