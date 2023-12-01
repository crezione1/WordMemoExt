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

(function () {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.message === 'login') {
            console.log(request);
            startOAuthFlow(request.arguments[0]);
        }
    });
})();

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

// Check if extension enabled/disabled for current site

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    let [tab] = await chrome.tabs.query(queryOptions);

    return tab;
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

function getChangedSite(changes) {
    const newValue = changes.excludedSites.newValue;
    const oldValue = changes.excludedSites.oldValue;

    const [changedSite] =
        newValue.length > oldValue.length
            ? newValue.filter((site) => !oldValue.includes(site))
            : oldValue.filter((site) => !newValue.includes(site));

    return changedSite;
}

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && 'excludedSites' in changes) {
        const changedSite = getChangedSite(changes);

        const currentTab = await getCurrentTab();
        const isCurrentChanged = isSiteEqualToCurrentSite(
            currentTab.url,
            changedSite
        );

        if (!isCurrentChanged) return;

        checkIfExtensionEnabled().then((enabled) => {
            notifyExtensionStateChanged(enabled);
        });
    }
});

async function notifyExtensionStateChanged(enabled) {
    const currentTab = await getCurrentTab();

    chrome.tabs.sendMessage(currentTab.id, {
        action: 'extensionStateChanged',
        enabled,
    });
}

// function startOAuthFlow() {
//     debugger
//     const clientId = 'YOUR_OAUTH_CLIENT_ID';
//     const redirectUri = chrome.identity.getRedirectURL('oauth2');
//     const authUrl = `https://localhost:8080/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token`;
//
//     chrome.identity.launchWebAuthFlow({
//         url: authUrl,
//         interactive: true
//     }, function(redirectUrl) {
//         const token = extractTokenFromUrl(redirectUrl);
//         if (token) {
//             chrome.storage.local.set({token: token});
//         } else {
//             console.error('Failed to authenticate');
//         }
//     });
// }
//
// function extractTokenFromUrl(url) {
//     // Extract the token from the redirect URL
//     const regex = /access_token=([^&]*)/;
//     const match = regex.exec(url);
//     return match && match[1];
// }
