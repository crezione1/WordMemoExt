// Firebase configuration for WordMemo Extension
// Using environment variables for security

const firebaseConfig = {
    apiKey: "AIzaSyBvOiSH5kKIIkLj2HFlbmGqm8TfAH8Pc7s",
    authDomain: "wordmemo-6c5b1.firebaseapp.com", 
    projectId: "wordmemo-6c5b1",
    storageBucket: "wordmemo-6c5b1.appspot.com",
    messagingSenderId: "93068966734",
    appId: "1:93068966734:web:2fa3e0d42b3e7dc6ddc99c"
};

// Note: Firebase modules will be loaded via script tags in HTML files

// Initialize Firebase
let app;
let auth;
let db;

try {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

// Export Firebase instances
window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDb = db;

// Firestore collections structure
const COLLECTIONS = {
    USERS: 'users',
    WORDS: 'words',
    TRANSLATIONS: 'translations',
    USER_SETTINGS: 'userSettings'
};

window.FIREBASE_COLLECTIONS = COLLECTIONS;

// Helper function to get current user's document reference
function getCurrentUserRef() {
    const user = auth.currentUser;
    if (!user) throw new Error('No authenticated user');
    return db.collection(COLLECTIONS.USERS).doc(user.uid);
}

// Helper function to get user's words collection
function getUserWordsRef() {
    return getCurrentUserRef().collection(COLLECTIONS.WORDS);
}

// Helper function to get user's settings document
function getUserSettingsRef() {
    return getCurrentUserRef().collection(COLLECTIONS.USER_SETTINGS).doc('preferences');
}

window.getCurrentUserRef = getCurrentUserRef;
window.getUserWordsRef = getUserWordsRef;
window.getUserSettingsRef = getUserSettingsRef;