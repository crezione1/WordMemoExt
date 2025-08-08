const ENV = "prod";

const config = {
    dev: {
        API_URL: "http://localhost:8080",
    },
    prod: {
        API_URL: "https://sea-lion-app-ut382.ondigitalocean.app",
    },
};

const API_URL = config[ENV].API_URL;

async function getCurrentUserInfo() {
    // Simulate a user object from local storage
    const { userInfo } = await chrome.storage.local.get(["userInfo"]);
    return userInfo || { email: "offline@user", telegramId: null };
}

async function getToken() {
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
    const { words } = await chrome.storage.local.get(["words"]);
    // Return as a dictionary for compatibility
    if (!words) return {};
    return words.reduce((acc, word) => {
        acc[word.word.toLowerCase()] = word;
        return acc;
    }, {});
}

function saveWordsToStorage() {
    // Already handled by getAllTranslations and chrome.storage.local
}

async function deleteWordFromDictionary(wordId) {
    const { words } = await chrome.storage.local.get(["words"]);
    if (!words) return;
    const updatedWords = words.filter((word) => word.id !== Number(wordId));
    await chrome.storage.local.set({ words: updatedWords });
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

    if (operation === "addWord") {
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

    if (request.action === "saveWordsToStorage") {
        saveWordsToStorage();
    }

    if (request.action === "getUserInfo") {
        getCurrentUserInfo()
            .then(() => {
                sendResponse({ userInfo });
            })
            .catch((error) => {
                console.error("Error getting user info:", error);
            });

        return true;
    }
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === "local" && "excludedSites" in changes) {
        await handleExcludedSitesChange(changes.excludedSites);
    }

    if (namespace === "local" && "words" in changes) {
        await handleWordsChange(changes.words);
    }
});
