// Firebase-based background script
// Import Firebase scripts for service worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-functions-compat.js');

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBvOiSH5kKIIkLj2HFlbmGqm8TfAH8Pc7s",
    authDomain: "wordmemo-6c5b1.firebaseapp.com", 
    projectId: "wordmemo-6c5b1",
    storageBucket: "wordmemo-6c5b1.appspot.com",
    messagingSenderId: "93068966734",
    appId: "1:93068966734:web:2fa3e0d42b3e7dc6ddc99c"
};

// Initialize Firebase in service worker
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();
const TELEGRAM_BOT_URL = "https://web.telegram.org/k/#@WordMemoBot";

async function getCurrentUserInfo() {
    try {
        const user = auth.currentUser;
        if (user) {
            return {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            };
        } else {
            console.log('No authenticated user');
            return null;
        }
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
        const user = auth.currentUser;
        if (!user) {
            console.log('User not authenticated');
            return [];
        }

        const { translateTo } = await chrome.storage.local.get(["translateTo"]);
        const languageCode = translateTo || 'uk';

        // Get words from Firebase Firestore
        const userRef = db.collection('users').doc(user.uid);
        const wordsSnapshot = await userRef.collection('words')
            .where('languageCode', '==', languageCode)
            .orderBy('createdAt', 'desc')
            .get();

        const words = [];
        wordsSnapshot.forEach(doc => {
            words.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return words;
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
        const user = auth.currentUser;
        if (!user) {
            console.log('User not authenticated');
            return;
        }

        // Delete word from Firebase Firestore
        const userRef = db.collection('users').doc(user.uid);
        await userRef.collection('words').doc(wordId).delete();

        console.log(`Word with id ${wordId} was deleted from Firebase`);
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

// Save word to Firebase Firestore
async function saveWordToFirebase(word, settings = {}) {
    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('User not authenticated');
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
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            userId: user.uid
        };

        // Save to Firestore
        const userRef = db.collection('users').doc(user.uid);
        const docRef = await userRef.collection('words').add(wordData);

        console.log('Word saved to Firebase with ID:', docRef.id);
        
        // Update local storage cache
        saveWordsToStorage();
        
        return { id: docRef.id, ...wordData };
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
