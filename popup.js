const telegramName = document.getElementById('telegramName');
const loginButton = document.getElementById('loginBtn');
const logoutButton = document.getElementById('logoutBtn');
const telegramButton = document.getElementById('telegramBtn');
const dictionaryContainer = document.getElementById('dictionaryContent');
const exclusionList = document.getElementById('exclusionList');
const openSiteInputBtn = document.getElementById('openSiteInputBtn');
const openSiteInputBtnIcon = document.querySelector('#openSiteInputBtn i');
const siteInputContainer = document.getElementById('siteInputContainer');
const siteInput = document.getElementById('siteInput');
const addSiteButton = document.getElementById('addSiteBtn');
const enableExtensionCheckbox = document.getElementById('enableExtension');
const notificationContainer = document.getElementById('notification');
const messageContainer = document.getElementById('notificationMessage');
const closeNotificationBtn = document.getElementById('closeNotificationBtn');

let excludedSites;
let currentSite;
let isEnabled;

function showLogin() {
    logoutButton.style.display = 'none';
    loginButton.style.display = 'inline-block';

    toggleTelegramForm(false);
}

function showLogout() {
    loginButton.style.display = 'none';
    logoutButton.style.display = 'inline-block';

    toggleTelegramForm(true);
}

function showTab(tabId) {
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach((content) => {
        content.style.display = 'none';
    });
    let activeTab = document.getElementById(tabId);
    activeTab.style.display = 'flex';
    activeTab.classList.add('active-tab');
}

function isTokenValid(token) {
    if (!token) {
        return false;
    }
    // TODO should be validated on backend
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expirationDate = new Date(payload.exp * 1000); // Convert to milliseconds
    const currentDate = new Date();

    return currentDate < expirationDate;
}

// Dictionary

function generateDictionaryListItem(word, translation, wordId) {
    return `<li>
                <div>
                    <span class="dictionary-word">
                        ${word}
                    </span>
                    <span class="dictionary-translation">
                        ${translation}
                    </span>
                </div>
                <button type="button" data-word-id="${wordId}">-</button>
            </li>`;
}

function createWordsList(words) {
    const dictionaryList = document.createElement('ul');
    dictionaryList.id = 'dictionaryList';
    dictionaryList.className = 'dictionary-list';

    words.forEach((item) => {
        const listItem = generateDictionaryListItem(
            item.word,
            item.translation,
            item.id
        );

        dictionaryList.insertAdjacentHTML('afterbegin', listItem);
    });

    return dictionaryList;
}

async function displayDictionary() {
    const { words } = await chrome.storage.local.get(['words']);

    if (words === undefined) return;

    const wordsList = createWordsList(words);

    dictionaryContainer.appendChild(wordsList);
}

function deleteWordFromPopupDictionary(changedWordId) {
    const changedListItem = dictionaryContainer.querySelector(
        `[data-word-id="${changedWordId}"]`
    ).parentNode;

    changedListItem.remove();
}

async function deleteWordFromStorage(wordId) {
    const { words } = await chrome.storage.local.get(['words']);
    const updatedWords = words.filter((word) => word.id !== Number(wordId));

    chrome.storage.local.set({ words: updatedWords });
}

// Settings

async function getExcludedSites() {
    const result = await chrome.storage.local.get({
        excludedSites: [],
    });

    return result.excludedSites;
}

async function getCurrentSite() {
    const result = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });

    return result[0].url;
}

function getSiteHostname(site) {
    const urlObject = new URL(site);
    return urlObject.hostname;
}

function checkIfCurrentSiteEnabled() {
    return !excludedSites.some((site) => {
        const siteHostname = getSiteHostname(currentSite);
        return siteHostname.includes(site);
    });
}

function generateExclusionListItem(text) {
    return `<li>
                ${text}
                <button
                    type="button"
                    class="icon-btn icon-btn-small"
                >
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </li>`;
}

function displayExclusionList(list) {
    list.forEach((site) => {
        const listItem = generateExclusionListItem(site);
        openSiteInputBtn.insertAdjacentHTML('beforebegin', listItem);
    });
}

function openSiteInput() {
    if (siteInputContainer.style.display === 'none') {
        siteInputContainer.style.display = 'flex';
        openSiteInputBtnIcon.className = 'fa-solid fa-xmark';
    } else {
        siteInputContainer.style.display = 'none';
        openSiteInputBtnIcon.className = 'fa-solid fa-plus';
    }
}

async function toggleExtensionState() {
    const currentSiteHostname = getSiteHostname(currentSite);
    const result = await chrome.storage.local.get({
        excludedSites: [],
    });
    const excludedSites = result.excludedSites;

    let updatedList;

    if (enableExtensionCheckbox.checked) {
        updatedList = excludedSites.filter(
            (site) => site !== currentSiteHostname
        );

        let currentSiteItem;

        exclusionList.childNodes.forEach((node) => {
            if (!(node.textContent.trim() === currentSiteHostname)) return;
            currentSiteItem = node;
        });

        currentSiteItem.remove();
        isEnabled = true;
    } else {
        updatedList = [...excludedSites, currentSiteHostname];

        const listItem = generateExclusionListItem(currentSiteHostname);
        openSiteInputBtn.insertAdjacentHTML('beforebegin', listItem);
        isEnabled = false;
    }

    await chrome.storage.local.set({ excludedSites: updatedList });
}

async function addSiteToExclusion() {
    const siteInputValue = siteInput.value.trim();
    let site;

    try {
        const urlObject = new URL(siteInputValue);
        site = urlObject.hostname;
    } catch (e) {
        if (e instanceof TypeError) {
            site = siteInputValue;
        }
    }

    if (site) {
        const result = await chrome.storage.local.get({
            excludedSites: [],
        });

        const updatedList = [...result.excludedSites, site];
        await chrome.storage.local.set({ excludedSites: updatedList });

        const listItem = generateExclusionListItem(site);
        openSiteInputBtn.insertAdjacentHTML('beforebegin', listItem);
        siteInput.value = '';

        const currentSiteHostname = getSiteHostname(currentSite);

        isEnabled = isEnabled ? site !== currentSiteHostname : false;
        enableExtensionCheckbox.checked = isEnabled;
    }
}

async function removeSiteFromExclusion(e) {
    const button = e.target.closest('button');

    if (button && button.parentElement.tagName === 'LI') {
        const siteToRemove = button.parentElement.textContent.trim();

        const result = await chrome.storage.local.get({
            excludedSites: [],
        });

        const updatedList = result.excludedSites.filter(
            (site) => site !== siteToRemove
        );
        await chrome.storage.local.set({ excludedSites: updatedList });
        button.parentElement.remove();

        const currentSiteHostname = getSiteHostname(currentSite);

        isEnabled = siteToRemove === currentSiteHostname || isEnabled;
        enableExtensionCheckbox.checked = isEnabled;
    }
}

function toggleTelegramForm(visible) {
    const telegramContainer = document.getElementById('telegramContainer');

    telegramContainer.style.display = visible ? 'block' : 'none';
}

function toggleTelegramButton() {
    telegramButton.disabled = telegramName.value.trim() === '';
    telegramButton.style.pointerEvents = telegramButton.disabled
        ? 'none'
        : 'auto';
}

function showNotification(message) {
    messageContainer.innerText = message;
    notificationContainer.classList.add('notification-shown');

    setTimeout(closeNotification, 5000);
}

function closeNotification() {
    if (!notificationContainer.classList.contains('notification-shown')) return;

    notificationContainer.classList.remove('notification-shown');
}

function updateTelegram() {
    chrome.runtime.sendMessage(
        {
            action: 'updateTelegram',
            telegramName: telegramName.value.trim(),
        },
        (response) => {
            if (response.success) {
                const message = 'Telegram name has been successfully updated.';
                showNotification(message);
            } else {
                const message =
                    'There was an error updating a telegram name. Please try again later.';
                showNotification(message);
            }
        }
    );

    telegramName.value = '';
}

// Event listeners and initialization

document.addEventListener('DOMContentLoaded', async () => {
    loginButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({
            message: 'login',
        });

        showLogout();
    });

    telegramName.addEventListener('input', toggleTelegramButton);

    document.getElementById('settings').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    logoutButton.addEventListener('click', function () {
        chrome.storage.local.remove(['token', 'words']);

        showLogin();
    });

    telegramButton.addEventListener('click', () => {
        updateTelegram();
    });

    document.getElementById('tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.tab-action');

        if (!tab) return;

        const tabContent = tab.id.replace('Tab', 'Content');
        showTab(tabContent);
    });

    dictionaryContainer.addEventListener('click', async (e) => {
        const button = e.target.closest('button');

        if (!button) return;

        await deleteWordFromStorage(button.dataset.wordId);
    });

    enableExtensionCheckbox.addEventListener('change', toggleExtensionState);

    openSiteInputBtn.addEventListener('click', openSiteInput);

    addSiteButton.addEventListener('click', addSiteToExclusion);

    exclusionList.addEventListener('click', async (e) =>
        removeSiteFromExclusion(e)
    );

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'wordsChanged') {
            console.log('words were changed: ', request.newValue);

            if (request.newValue.operation === 'getAllWords') {
                displayDictionary().catch(console.error);
            } else if (request.newValue.operation === 'deleteWord') {
                deleteWordFromPopupDictionary(request.newValue.wordId);
            }
        }
    });

    closeNotificationBtn.addEventListener('click', closeNotification);

    //token verification
    chrome.storage.local.get(['token'], (result) => {
        if (isTokenValid(result.token)) {
            // Token exists, now validate it
            console.log('The token is valid');
            showLogout();
        } else {
            console.log('The token is invalid');
            showLogin();
        }
    });

    excludedSites = await getExcludedSites();
    currentSite = await getCurrentSite();
    isEnabled = checkIfCurrentSiteEnabled();
    enableExtensionCheckbox.checked = isEnabled;
    toggleTelegramButton();
    showTab('homeContent');
    await displayDictionary();
    displayExclusionList(excludedSites);
});
