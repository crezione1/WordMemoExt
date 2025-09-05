// Firebase authentication functions for WordMemo Extension

// Initialize Google Auth Provider
function createGoogleProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    return provider;
}

// Sign in with Google using Firebase Auth
async function signInWithGoogle() {
    try {
        const provider = createGoogleProvider();
        
        // For Chrome extensions, we need to use signInWithRedirect or a popup approach
        // Since we're in an extension popup, we'll use Chrome Identity API to get the token
        // and then use it with Firebase
        
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, async (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                
                if (token) {
                    try {
                        // Create a Google credential using the token
                        const credential = firebase.auth.GoogleAuthProvider.credential(null, token);
                        
                        // Sign in to Firebase with the credential
                        const result = await firebase.auth().signInWithCredential(credential);
                        
                        // Store user info in Chrome storage
                        const userInfo = {
                            uid: result.user.uid,
                            email: result.user.email,
                            displayName: result.user.displayName,
                            photoURL: result.user.photoURL
                        };
                        
                        chrome.storage.local.set({ 
                            'auth_token': token,
                            'user_info': userInfo 
                        });
                        
                        // Create user document in Firestore if it doesn't exist
                        await createUserDocument(result.user);
                        
                        resolve(result);
                    } catch (error) {
                        console.error('Firebase auth error:', error);
                        reject(error);
                    }
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

// Create user document in Firestore
async function createUserDocument(user) {
    try {
        const userRef = firebase.firestore().collection('users').doc(user.uid);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            await userRef.set({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // Create default user settings
            await userRef.collection('userSettings').doc('preferences').set({
                translateTo: 'UK',
                languageFull: 'Ukrainian',
                animationToggle: true,
                sentenceCounter: 1,
                excludedSites: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('User document created');
        } else {
            // Update last login time
            await userRef.update({
                lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        console.error('Error creating user document:', error);
    }
}

// Sign out
async function signOut() {
    try {
        // Sign out from Firebase
        await firebase.auth().signOut();
        
        // Get current token and remove it from Chrome identity
        const token = await getCachedToken();
        if (token) {
            chrome.identity.removeCachedAuthToken({ token }, () => {
                console.log('Token removed from cache');
            });
        }
        
        // Clear local storage
        chrome.storage.local.remove(['auth_token', 'user_info', 'words'], () => {
            console.log('Signed out successfully');
        });
    } catch (error) {
        console.error('Sign out error:', error);
        throw error;
    }
}

// Get current user
async function getCurrentUser() {
    return new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

// Listen for auth state changes
function onAuthStateChanged(callback) {
    return firebase.auth().onAuthStateChanged(callback);
}

// Get cached Chrome identity token
function getCachedToken() {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            resolve(token);
        });
    });
}

// Refresh Firebase auth token
async function refreshAuthToken() {
    try {
        const user = firebase.auth().currentUser;
        if (user) {
            const token = await user.getIdToken(true);
            return token;
        }
        return null;
    } catch (error) {
        console.error('Error refreshing token:', error);
        return null;
    }
}

// Export functions to global scope for use in other scripts
window.firebaseAuth = {
    signInWithGoogle,
    signOut,
    getCurrentUser,
    onAuthStateChanged,
    createGoogleProvider,
    refreshAuthToken
};