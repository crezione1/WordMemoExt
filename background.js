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
const TELEGRAM_BOT_URL = "https://web.telegram.org/k/#@WordMemoBot";

async function getCurrentUserInfo() {
    let userInfo;

    try {
        const token = await getToken();

        const response = await fetch(`${API_URL}/api/users/current`, {
            method: "GET",
            headers: {
                Authorization: "Bearer " + token,
                Accept: "application/json, application/xml, text/plain, text/html, */*",
                "Content-Type": "application/json",
            },
        });

        userInfo = await response.json();
    } catch (error) {
        console.error("Error getting user info:", error);
    }

    return userInfo;
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
    const { translateTo } = await chrome.storage.local.get(["translateTo"]);

    let translations = {};

    try {
        const token = await getToken();

        const response = await fetch(`${API_URL}/api/words?languageCodeIso=${translateTo}`, {
            method: "GET",
            headers: {
                Authorization: "Bearer " + token,
                Accept: "application/json, application/xml, text/plain, text/html, */*",
                "Content-Type": "application/json",
            },
        });

        console.log(response);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        translations = await response.json();
    } catch (error) {
        console.error("Error fetching translations:", error);
    }

    return translations;
}

function saveWordsToStorage() {
    getAllTranslations().then((words) => {
        chrome.storage.local.set({ words });
    });
}

async function deleteWordFromDictionary(wordId) {
    try {
        const token = await getToken();

        await fetch(`${API_URL}/api/words/${wordId}`, {
            method: "DELETE",
            headers: {
                Authorization: "Bearer " + token,
                Accept: "application/json, application/xml, text/plain, text/html, */*",
                "Content-Type": "application/json",
            },
        });

        console.log(`word with id ${wordId} was deleted`);
    } catch (error) {
        console.error("Error deleting word:", error);
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
