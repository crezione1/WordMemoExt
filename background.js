const ENV = 'prod';

const config = {
    dev: {
        API_URL: 'http://localhost:8080',
    },
    prod: {
        API_URL: 'https://sea-lion-app-ut382.ondigitalocean.app',
    },
};

const API_URL = config[ENV].API_URL;

function startOAuthFlow(telegramName) {
    let clientId = `893654526349-8vbu5ql30musnpecetk9ntigefjk81et.apps.googleusercontent.com`;
    let responseType = `code`;
    let scope = `openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`;
    //redirectUri for Anastasiia, should be changed to id of the chrome extension on the store after publishing
    let redirectUri = `https://dkecpnpaaifjhhehhdkpaohapiniagod.chromiumapp.org/`;

    chrome.identity.launchWebAuthFlow(
        {
            url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=${responseType}&scope=${scope}&redirect_uri=${redirectUri}`,
            interactive: true,
        },
        function (redirect_url) {
            console.log(redirect_url);
            let authCode = redirect_url.split('&')[0].split('code=')[1];
            // Send this authCode to your backend for further processing
            fetch(`${API_URL}/check/code/google`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Login: 'login',
                },
                body: JSON.stringify({
                    code: authCode.replace('%2F', '/'),
                    telegramName: telegramName,
                }),
            })
                .then((response) => response.text())
                .then((jwt) => {
                    console.log(jwt);
                    chrome.storage.local.set({ token: jwt }, function () {
                        console.log('Token is set to ' + jwt);
                    });
                    let telegramBotUrl =
                        'https://web.telegram.org/k/#@WordMemoBot';
                    chrome.tabs.create({ url: telegramBotUrl });
                });
        }
    );
}

async function getToken() {
    const result = await chrome.storage.local.get(['token']);
    return result.token;
}

// Check if extension enabled/disabled for current site

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);

    return tab;
}

async function notifyAboutChanges(actionName, content) {
    const currentTab = await getCurrentTab();

    chrome.tabs.sendMessage(currentTab.id, {
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

    const isEnabled = !excludedSites.some((site) =>
        isSiteEqualToCurrentSite(currentTab.url, site)
    );

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
    const isCurrentChanged = isSiteEqualToCurrentSite(
        currentTab.url,
        changedSite
    );

    if (!isCurrentChanged) return;

    checkIfExtensionEnabled().then((enabled) => {
        notifyAboutChanges('extensionStateChanged', enabled);
    });
}

// Getting all words and manipulating them

async function getAllTranslations() {
    const { translateTo } = await chrome.storage.local.get(['translateTo']);

    let translations = {};

    try {
        const token = await getToken();

        const response = await fetch(
            `${API_URL}/api/words?languageCode=${translateTo}`,
            {
                method: 'GET',
                headers: {
                    Authorization: 'Bearer ' + token,
                    Accept: 'application/json, application/xml, text/plain, text/html, */*',
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        translations = await response.json();
    } catch (error) {
        console.error('Error fetching translations:', error);
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
            method: 'DELETE',
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/json, application/xml, text/plain, text/html, */*',
                'Content-Type': 'application/json',
            },
        });

        console.log(`word with id ${wordId} was deleted`);
    } catch (error) {
        console.error('Error deleting word:', error);
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
    const operation =
        changes.newValue.length > changes.oldValue.length
            ? 'addWord'
            : 'deleteWord';

    const changedWord = getChangedWord(changes);

    await notifyAboutChanges('wordsChanged', changes.newValue);

    if (operation === 'deleteWord') {
        await deleteWordFromDictionary(changedWord.id);
    } else {
        console.log(`word ${changedWord} was added`);
    }
}

// Event listeners and initialization

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.message === 'login') {
        console.log(request);
        startOAuthFlow(request.arguments[0]);
    }
});

chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === 'install') {
        // This is a first install!
        chrome.tabs.create({ url: 'popup.html' });
    } else if (details.reason === 'update') {
        // This is an update. You can also handle updates here if needed.
    }
});

chrome.runtime.onInstalled.addListener(function () {
    chrome.contextMenus.create({
        id: 'saveWordContextMenu',
        title: "Save '%s'", // %s will be replaced by the selected text
        contexts: ['selection'], // Context type
    });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId === 'saveWordContextMenu') {
        const selectedText = info.selectionText;
        chrome.tabs.sendMessage(
            tab.id,
            { action: 'saveWordToDictionary', text: selectedText },
            function (response) {
                console.log(response);
            }
        );
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkExtensionState') {
        checkIfExtensionEnabled()
            .then((enabled) => {
                sendResponse({ enabled });
            })
            .catch((error) => {
                console.error('Error checking extension state:', error);
                sendResponse({ enabled: false });
            });

        return true;
    }
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && 'excludedSites' in changes) {
        await handleExcludedSitesChange(changes.excludedSites);
    }

    if (namespace === 'local' && 'words' in changes) {
        await handleWordsChange(changes.words);
    }
});

saveWordsToStorage();
