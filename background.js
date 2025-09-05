// Firebase REST API integration for Chrome extension
// Using Firebase REST API to avoid CSP issues with external scripts

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBvOiSH5kKIIkLj2HFlbmGqm8TfAH8Pc7s",
    authDomain: "wordmemo-6c5b1.firebaseapp.com", 
    projectId: "wordmemo-6c5b1",
    storageBucket: "wordmemo-6c5b1.appspot.com",
    messagingSenderId: "93068966734",
    appId: "1:93068966734:web:2fa3e0d42b3e7dc6ddc99c"
};

// Firebase REST API endpoints
const FIREBASE_AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCredential?key=${FIREBASE_CONFIG.apiKey}`;
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// Current user state
let currentUser = null;
const TELEGRAM_BOT_URL = "https://web.telegram.org/k/#@WordMemoBot";

async function getCurrentUserInfo() {
    try {
        if (currentUser) {
            return currentUser;
        }
        
        // Try to get user from storage
        const result = await chrome.storage.local.get(['user_info']);
        if (result.user_info) {
            currentUser = result.user_info;
            return currentUser;
        }
        
        console.log('No authenticated user');
        return null;
    } catch (error) {
        console.error("Error getting user info:", error);
        return null;
    }
}

async function updateTelegram(telegramName, isTelegramIdExist) {
    let success;

    try {
        const token = await getToken();

        await fetch(`${API_URL}/telegram`, {
            method: "POST",
            body: JSON.stringify({ telegramName, chatId: null }),
            headers: {
                Authorization: "Bearer " + token,
                Accept: "application/json, application/xml, text/plain, text/html, */*",
                "Content-Type": "application/json",
            },
        });

        success = true;

        if (!isTelegramIdExist) {
            chrome.tabs.create({ url: TELEGRAM_BOT_URL });
        }
    } catch (error) {
        success = false;
        console.error("Error updating telegram:", error);
    }

    return success;
}

async function handleUpdateTelegram(telegramName) {
    const currentUser = await getCurrentUserInfo();
    const isTelegramIdExist = Boolean(currentUser.telegramId);

    const success = await updateTelegram(telegramName, isTelegramIdExist);

    return success;
}

// Legacy function kept for compatibility - now returns Firebase auth token
async function getToken() {
    try {
        const user = auth.currentUser;
        if (user) {
            return await user.getIdToken();
        }
    } catch (error) {
        console.error('Error getting Firebase token:', error);
    }
    
    // Fallback to legacy storage token
    const result = await chrome.storage.local.get(["token"]);
    return result.token;
}

// Check if extension enabled/disabled for current site

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);

    return tab;
}

async function notifyContentAboutChanges(actionName, content) {
    const currentTab = await getCurrentTab();

    chrome.tabs.sendMessage(currentTab.id, {
        action: actionName,
        newValue: content,
    });
}

function notifyPopupAboutChanges(actionName, content) {
    chrome.runtime.sendMessage({
        action: actionName,
        newValue: content,
    });
}

function isSiteEqualToCurrentSite(url, domain) {
    const urlObject = new URL(url);

    return urlObject.hostname.includes(domain);
}

async function checkIfExtensionEnabled() {
    const result = await chrome.storage.local.get({
        excludedSites: [],
    });
    const excludedSites = result.excludedSites;
    const currentTab = await getCurrentTab();

    const isEnabled = !excludedSites.some((site) => isSiteEqualToCurrentSite(currentTab.url, site));

    return isEnabled;
}

function getChangedSite(changes) {
    const newValue = changes.newValue;
    const oldValue = changes.oldValue;

    const [changedItem] =
        newValue.length > oldValue.length
            ? newValue.filter((item) => !oldValue.includes(item))
            : oldValue.filter((item) => !newValue.includes(item));

    return changedItem;
}

async function handleExcludedSitesChange(changes) {
    const changedSite = getChangedSite(changes);

    const currentTab = await getCurrentTab();
    const isCurrentChanged = isSiteEqualToCurrentSite(currentTab.url, changedSite);

    if (!isCurrentChanged) return;

    const enabled = await checkIfExtensionEnabled();
    await notifyContentAboutChanges("extensionStateChanged", enabled);
}

// Getting all words and manipulating them

async function getAllTranslations() {
    try {
        const userInfo = await getCurrentUserInfo();
        if (!userInfo) {
            console.log('User not authenticated');
            return [];
        }

        const { translateTo } = await chrome.storage.local.get(["translateTo"]);
        const languageCode = translateTo || 'uk';

        // Get words from Firestore using REST API
        const token = await getFirebaseIdToken();
        if (!token) {
            console.log('No valid token for Firestore access');
            return [];
        }

        const wordsUrl = `${FIRESTORE_URL}/users/${userInfo.uid}/words`;
        const response = await fetch(wordsUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            const words = [];
            
            if (data.documents) {
                data.documents.forEach(doc => {
                    const docData = parseFirestoreDocument(doc);
                    if (docData.languageCode === languageCode) {
                        words.push({
                            id: doc.name.split('/').pop(),
                            ...docData
                        });
                    }
                });
            }
            
            return words;
        } else {
            console.error('Failed to fetch words from Firestore:', response.status);
            return [];
        }
    } catch (error) {
        console.error("Error fetching translations from Firebase:", error);
        return [];
    }
}

function saveWordsToStorage() {
    getAllTranslations().then((words) => {
        chrome.storage.local.set({ words });
    });
}

async function deleteWordFromDictionary(wordId) {
    try {
        const userInfo = await getCurrentUserInfo();
        if (!userInfo) {
            console.log('User not authenticated');
            return;
        }

        // Delete word from Firestore using REST API
        const token = await getFirebaseIdToken();
        if (!token) {
            console.log('No valid token for Firestore access');
            return;
        }

        const wordUrl = `${FIRESTORE_URL}/users/${userInfo.uid}/words/${wordId}`;
        const response = await fetch(wordUrl, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            console.log(`Word with id ${wordId} was deleted from Firebase`);
        } else {
            console.error('Failed to delete word from Firestore:', response.status);
        }
    } catch (error) {
        console.error("Error deleting word from Firebase:", error);
    }
}

function getChangedWord(changes) {
    const newValueIds = changes.newValue.map((word) => word.id);
    const oldValueIds = changes.oldValue.map((word) => word.id);

    const [changedItemId] =
        newValueIds.length > oldValueIds.length
            ? newValueIds.filter((item) => !oldValueIds.includes(item))
            : oldValueIds.filter((item) => !newValueIds.includes(item));

    const [changedItem] =
        newValueIds.length > oldValueIds.length
            ? changes.newValue.filter((item) => item.id === changedItemId)
            : changes.oldValue.filter((item) => item.id === changedItemId);

    return changedItem;
}

async function handleWordsChange(changes) {
    console.log(changes);

    if (!changes.newValue) {
        await notifyContentAboutChanges("wordsChanged", []);
        return;
    }

    if (!changes.oldValue) {
        await notifyContentAboutChanges("wordsChanged", changes.newValue);
        notifyPopupAboutChanges("wordsChanged", { operation: "getAllWords" });
        return;
    }

    const operation = changes.newValue.length > changes.oldValue.length ? "addWord" : "deleteWord";

    const changedWord = getChangedWord(changes);

    await notifyContentAboutChanges("wordsChanged", changes.newValue);
    notifyPopupAboutChanges("wordsChanged", {
        operation,
        wordId: changedWord.id,
    });

    if (operation === "deleteWord") {
        await deleteWordFromDictionary(changedWord.id);
    } else {
        console.log(`word ${changedWord} was added`);
    }
}

// Event listeners and initialization

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        // This is a first install!
        chrome.tabs.create({ url: "popup.html" });
        chrome.storage.local.set({ token: "" });
    } else if (details.reason === "update") {
        // This is an update. You can also handle updates here if needed.
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "saveWordContextMenu",
        title: "Save '%s'",
        contexts: ["selection"],
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "saveWordContextMenu") {
        const selectedText = info.selectionText;
        chrome.tabs.sendMessage(tab.id, { action: "saveWordToDictionary", text: selectedText }, (response) =>
            console.log(response)
        );
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "checkExtensionState") {
        checkIfExtensionEnabled()
            .then((enabled) => {
                sendResponse({ enabled });
            })
            .catch((error) => {
                console.error("Error checking extension state:", error);
                sendResponse({ enabled: false });
            });

        return true;
    }

    if (request.action === "checkAuthState") {
        checkAuthenticationState()
            .then((isAuthenticated) => {
                sendResponse({ isAuthenticated });
            })
            .catch((error) => {
                console.error("Error checking auth state:", error);
                sendResponse({ isAuthenticated: false });
            });

        return true;
    }

    if (request.action === "signInWithGoogle") {
        handleFirebaseSignIn()
            .then((result) => {
                sendResponse({ success: true, user: result });
            })
            .catch((error) => {
                console.error("Error with Firebase sign in:", error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }

    if (request.action === "signOut") {
        handleFirebaseSignOut()
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                console.error("Error with Firebase sign out:", error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }

    if (request.action === "updateTelegram") {
        handleUpdateTelegram(request.telegramName)
            .then((success) => {
                sendResponse({ success });
            })
            .catch((error) => {
                console.error("Error updating telegram:", error);
                sendResponse({ success: false });
            });

        return true;
    }

    if (request.action === "saveWordsToStorage") {
        saveWordsToStorage();
    }

    if (request.action === "saveWordToFirebase") {
        saveWordToFirebase(request.word, request.settings)
            .then((result) => {
                sendResponse({ success: true, data: result });
            })
            .catch((error) => {
                console.error("Error saving word to Firebase:", error);
                sendResponse({ success: false, error: error.message });
            });

        return true;
    }

    if (request.action === "getUserInfo") {
        getCurrentUserInfo()
            .then((userInfo) => {
                sendResponse({ userInfo });
            })
            .catch((error) => {
                console.error("Error getting user info:", error);
                sendResponse({ userInfo: null });
            });

        return true;
    }
});

// Firebase REST API helper functions
function parseFirestoreDocument(doc) {
    const data = {};
    if (doc.fields) {
        for (const [key, value] of Object.entries(doc.fields)) {
            if (value.stringValue !== undefined) {
                data[key] = value.stringValue;
            } else if (value.timestampValue !== undefined) {
                data[key] = new Date(value.timestampValue);
            } else if (value.integerValue !== undefined) {
                data[key] = parseInt(value.integerValue);
            } else if (value.doubleValue !== undefined) {
                data[key] = parseFloat(value.doubleValue);
            } else if (value.booleanValue !== undefined) {
                data[key] = value.booleanValue;
            }
        }
    }
    return data;
}

function createFirestoreDocument(data) {
    const fields = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            fields[key] = { stringValue: value };
        } else if (typeof value === 'number') {
            fields[key] = Number.isInteger(value) ? { integerValue: value.toString() } : { doubleValue: value };
        } else if (typeof value === 'boolean') {
            fields[key] = { booleanValue: value };
        } else if (value instanceof Date) {
            fields[key] = { timestampValue: value.toISOString() };
        } else if (value === 'SERVER_TIMESTAMP') {
            fields[key] = { timestampValue: new Date().toISOString() };
        }
    }
    return { fields };
}

async function getFirebaseIdToken() {
    try {
        const result = await chrome.storage.local.get(['auth_token']);
        return result.auth_token;
    } catch (error) {
        console.error('Error getting Firebase token:', error);
        return null;
    }
}

// Authentication helper functions
async function checkAuthenticationState() {
    try {
        const result = await chrome.storage.local.get(['user_info', 'auth_token']);
        return !!(result.user_info && result.auth_token);
    } catch (error) {
        console.error('Error checking authentication:', error);
        return false;
    }
}

async function handleFirebaseSignIn() {
    try {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, async (token) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                
                if (token) {
                    try {
                        // Get user info from Google API
                        const userInfoResponse = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${token}`);
                        const googleUserInfo = await userInfoResponse.json();
                        
                        // Create user info object
                        const userInfo = {
                            uid: googleUserInfo.id,
                            email: googleUserInfo.email,
                            displayName: googleUserInfo.name,
                            photoURL: googleUserInfo.picture
                        };
                        
                        // Store user info and token
                        chrome.storage.local.set({ 
                            'auth_token': token,
                            'user_info': userInfo 
                        });
                        
                        currentUser = userInfo;
                        
                        // Create user document in Firestore if it doesn't exist
                        await createUserDocument(userInfo);
                        
                        // Load user's words
                        saveWordsToStorage();
                        
                        resolve(userInfo);
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

async function handleFirebaseSignOut() {
    try {
        // Get current token and remove it from Chrome identity
        const token = await getCachedToken();
        if (token) {
            chrome.identity.removeCachedAuthToken({ token }, () => {
                console.log('Token removed from cache');
            });
        }
        
        // Clear current user state
        currentUser = null;
        
        // Clear local storage
        chrome.storage.local.remove(['auth_token', 'user_info', 'words'], () => {
            console.log('Signed out successfully');
        });
    } catch (error) {
        console.error('Sign out error:', error);
        throw error;
    }
}

async function getCachedToken() {
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            resolve(token);
        });
    });
}

async function createUserDocument(userInfo) {
    try {
        const token = await getFirebaseIdToken();
        if (!token) {
            console.log('No valid token for Firestore access');
            return;
        }
        
        // Check if user document exists
        const userUrl = `${FIRESTORE_URL}/users/${userInfo.uid}`;
        const checkResponse = await fetch(userUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (checkResponse.status === 404) {
            // User doesn't exist, create new user document
            const userData = createFirestoreDocument({
                uid: userInfo.uid,
                email: userInfo.email,
                displayName: userInfo.displayName,
                photoURL: userInfo.photoURL,
                createdAt: 'SERVER_TIMESTAMP',
                lastLoginAt: 'SERVER_TIMESTAMP'
            });
            
            await fetch(userUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(userData)
            });
            
            // Create default user settings
            const settingsUrl = `${FIRESTORE_URL}/users/${userInfo.uid}/userSettings/preferences`;
            const settingsData = createFirestoreDocument({
                translateTo: 'UK',
                languageFull: 'Ukrainian',
                animationToggle: true,
                sentenceCounter: 1,
                createdAt: 'SERVER_TIMESTAMP'
            });
            
            await fetch(settingsUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settingsData)
            });
            
            console.log('User document created');
        } else if (checkResponse.ok) {
            // User exists, update last login time
            const updateData = createFirestoreDocument({
                lastLoginAt: 'SERVER_TIMESTAMP'
            });
            
            await fetch(userUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });
        }
    } catch (error) {
        console.error('Error creating user document:', error);
    }
}

// Save word to Firebase Firestore
async function saveWordToFirebase(word, settings = {}) {
    try {
        const userInfo = await getCurrentUserInfo();
        if (!userInfo) {
            throw new Error('User not authenticated');
        }

        const token = await getFirebaseIdToken();
        if (!token) {
            throw new Error('No valid token for Firestore access');
        }

        const languageCode = settings.languageCode || 'uk';
        
        // For now, we'll use a simple mock translation
        // In production, this would call a translation service
        const mockTranslations = {
            'hello': 'привіт',
            'world': 'світ',
            'good': 'добрий',
            'morning': 'ранок',
            'evening': 'вечір',
            'thank': 'дякую',
            'please': 'будь ласка',
            'yes': 'так',
            'no': 'ні',
            'water': 'вода'
        };

        const translation = mockTranslations[word.toLowerCase()] || `переклад_${word}`;

        const wordData = {
            word: word.toLowerCase(),
            translation: translation,
            languageCode: languageCode,
            createdAt: 'SERVER_TIMESTAMP',
            userId: userInfo.uid
        };

        // Save to Firestore using REST API
        const wordsUrl = `${FIRESTORE_URL}/users/${userInfo.uid}/words`;
        const firestoreData = createFirestoreDocument(wordData);
        
        const response = await fetch(wordsUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(firestoreData)
        });

        if (response.ok) {
            const result = await response.json();
            const docId = result.name.split('/').pop();
            
            console.log('Word saved to Firebase with ID:', docId);
            
            // Update local storage cache
            saveWordsToStorage();
            
            return { id: docId, ...wordData };
        } else {
            throw new Error(`Failed to save word: ${response.status}`);
        }
    } catch (error) {
        console.error('Error saving word to Firebase:', error);
        throw error;
    }
}

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === "local" && "excludedSites" in changes) {
        await handleExcludedSitesChange(changes.excludedSites);
    }

    if (namespace === "local" && "words" in changes) {
        await handleWordsChange(changes.words);
    }
});
