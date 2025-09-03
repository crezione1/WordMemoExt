// Simplified auth configuration for Chrome extension
// Using Chrome identity API instead of full Firebase

const authConfig = {
    // Extension uses Chrome identity API with Google OAuth
    // No Firebase configuration needed for basic auth
    useFirebase: false,
    useChromeIdentity: true
};

// Initialize auth system (simplified for extension)
function initializeFirebase() {
    console.log('Using Chrome Identity API for authentication');
    return true; // Return true to indicate auth system is ready
}

// Check if user is authenticated
function isAuthenticated() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['auth_token'], (result) => {
            resolve(!!result.auth_token);
        });
    });
}

// Export functions for use in other scripts
window.firebaseConfig = authConfig;
window.initializeFirebase = initializeFirebase;
window.getAuth = () => ({ isReady: true });
window.isAuthenticated = isAuthenticated;