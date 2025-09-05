// Firestore database operations for WordMemo Extension

// Collection names
const COLLECTIONS = {
    USERS: 'users',
    WORDS: 'words',
    USER_SETTINGS: 'userSettings'
};

// Initialize Firestore operations after Firebase is loaded
function initializeFirestore() {
    if (!firebase || !firebase.firestore) {
        console.error('Firebase Firestore not loaded');
        return false;
    }
    
    window.db = firebase.firestore();
    return true;
}

// Get current user's document reference
function getCurrentUserRef() {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('No authenticated user');
    return firebase.firestore().collection(COLLECTIONS.USERS).doc(user.uid);
}

// Get user's words collection reference
function getUserWordsRef() {
    return getCurrentUserRef().collection(COLLECTIONS.WORDS);
}

// Get user's settings document reference
function getUserSettingsRef() {
    return getCurrentUserRef().collection(COLLECTIONS.USER_SETTINGS).doc('preferences');
}

// Save a word to user's dictionary
async function saveWordToFirestore(word, translation, languageCode = 'UK') {
    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('User not authenticated');

        const wordData = {
            word: word.toLowerCase(),
            translation: translation,
            languageCode: languageCode,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            userId: user.uid
        };

        const docRef = await getUserWordsRef().add(wordData);
        console.log('Word saved with ID:', docRef.id);
        
        return { id: docRef.id, ...wordData };
    } catch (error) {
        console.error('Error saving word:', error);
        throw error;
    }
}

// Get all user's words
async function getAllWordsFromFirestore(languageCode = 'UK') {
    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('User not authenticated');

        const snapshot = await getUserWordsRef()
            .where('languageCode', '==', languageCode)
            .orderBy('createdAt', 'desc')
            .get();

        const words = [];
        snapshot.forEach(doc => {
            words.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return words;
    } catch (error) {
        console.error('Error fetching words:', error);
        throw error;
    }
}

// Delete a word from user's dictionary
async function deleteWordFromFirestore(wordId) {
    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('User not authenticated');

        await getUserWordsRef().doc(wordId).delete();
        console.log('Word deleted:', wordId);
        
        return true;
    } catch (error) {
        console.error('Error deleting word:', error);
        throw error;
    }
}

// Save user settings
async function saveUserSettings(settings) {
    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('User not authenticated');

        const settingsData = {
            ...settings,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await getUserSettingsRef().set(settingsData, { merge: true });
        console.log('Settings saved');
        
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        throw error;
    }
}

// Get user settings
async function getUserSettings() {
    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('User not authenticated');

        const doc = await getUserSettingsRef().get();
        
        if (doc.exists) {
            return doc.data();
        } else {
            // Return default settings
            const defaultSettings = {
                translateTo: 'UK',
                languageFull: 'Ukrainian',
                animationToggle: true,
                sentenceCounter: 1,
                excludedSites: []
            };
            
            await saveUserSettings(defaultSettings);
            return defaultSettings;
        }
    } catch (error) {
        console.error('Error getting settings:', error);
        throw error;
    }
}

// Listen to real-time changes in user's words
function listenToWordsChanges(callback, languageCode = 'UK') {
    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('User not authenticated');

        return getUserWordsRef()
            .where('languageCode', '==', languageCode)
            .orderBy('createdAt', 'desc')
            .onSnapshot(snapshot => {
                const words = [];
                snapshot.forEach(doc => {
                    words.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                
                callback(words);
            });
    } catch (error) {
        console.error('Error listening to words changes:', error);
        throw error;
    }
}

// Export functions to global scope
window.firebaseFirestore = {
    initializeFirestore,
    saveWordToFirestore,
    getAllWordsFromFirestore,
    deleteWordFromFirestore,
    saveUserSettings,
    getUserSettings,
    listenToWordsChanges,
    getCurrentUserRef,
    getUserWordsRef,
    getUserSettingsRef
};