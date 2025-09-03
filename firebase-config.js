// Firebase configuration for Chrome extension
// Using the global Firebase SDK instead of ES6 modules

const firebaseConfig = {
    apiKey: "AIzaSyBXoJP-example-key", // Replace with your actual Firebase config
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase when the script loads
let auth = null;

// Initialize Firebase using the global firebase object
function initializeFirebase() {
    if (typeof firebase !== 'undefined' && !auth) {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        console.log('Firebase initialized successfully');
        return auth;
    } else if (auth) {
        return auth;
    } else {
        console.error('Firebase SDK not loaded');
        return null;
    }
}

// Export functions for use in other scripts
window.firebaseConfig = firebaseConfig;
window.initializeFirebase = initializeFirebase;
window.getAuth = () => auth;