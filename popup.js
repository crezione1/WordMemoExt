const loginPage = document.getElementById("loginPage");
const mainContent = document.getElementById("mainContent");
const settingsButton = document.getElementById("settingsBtn");
const logoutButton = document.getElementById("logoutBtn");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const wordCategoryList = document.getElementById("wordCategoryList");
const wordListContainer = document.getElementById("dictionaryContent");
const notificationContainer = document.getElementById("notification");
const messageContainer = document.getElementById("notificationMessage");
const closeNotificationBtn = document.getElementById("closeNotificationBtn");
const exclusionList = document.getElementById("exclusionList");
const enableExtensionCheckbox = document.getElementById("enableExtension");
const siteInput = document.getElementById("siteInput");
const addSiteButton = document.getElementById("addSiteBtn");
const changeTelegramBtn = document.getElementById("changeTelegramBtn");
const telegramContainer = document.getElementById("telegramContainer");
const openEnglishLevelBtn = document.getElementById("englishLevelBtn");
const englishLevelContainer = document.getElementById("englishLevelContainer");
const openLearningGoalsBtnBtn = document.getElementById("learningGoalsBtn");
const learningGoalsContainer = document.getElementById("learningGoalsContainer");
const telegramName = document.getElementById("telegramName");
const telegramButton = document.getElementById("telegramBtn");
const userEmailContainer = document.getElementById("userEmail");

let excludedSites;
let currentSite;
let isEnabled;

function showLoginPage() {
    loginPage.style.display = "block";
    mainContent.style.display = "none";
}

function showMainContent() {
    loginPage.style.display = "none";
    mainContent.style.display = "block";

    chrome.runtime.sendMessage({
        action: "saveWordsToStorage",
    });
}

function showTab(tabId) {
    const contents = document.querySelectorAll(".tab-content");
    const tabs = document.querySelectorAll(".tab-action");

    contents.forEach((content) => {
        content.style.display = "none";
    });

    tabs.forEach((tab) => {
        tab.classList.remove("active");
    });

    const tabContentId = tabId.replace("Tab", "Content");
    let activeTab = document.getElementById(tabId);
    let activeContentTab = document.getElementById(tabContentId);

    activeTab.classList.add("active");
    activeContentTab.style.display = "flex";
}

function isTokenValid(token) {
    if (!token) {
        return false;
    }
    // TODO should be validated on backend
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expirationDate = new Date(payload.exp * 1000); // Convert to milliseconds
    const currentDate = new Date();

    return currentDate < expirationDate;
}

async function getUserInfo() {
    try {
        // Get user info from background script
        const response = await chrome.runtime.sendMessage({ action: "getUserInfo" });
        if (response && response.userInfo && userEmailContainer) {
            console.log('Current user:', response.userInfo);
            userEmailContainer.textContent = response.userInfo.email || 'Authenticated User';
            return response.userInfo;
        } else {
            console.log('No user signed in');
            return null;
        }
    } catch (error) {
        console.error('Error getting user info:', error);
        return null;
    }
}

// Dictionary

function generateDictionaryListItem(word, translation, wordId) {
    return `<li>
                <span class="word-list-origin">${word}</span>
                <span class="word-list-translation">${translation}</span>
                <div class="word-list-actions">
                    <button type="button" class="icon-btn icon-btn-small" data-word-id="${wordId}" data-btn-function="showSynonym">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                        >
                            <path
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="M3.16699 6.00033C3.16699 5.54009 3.54009 5.16699 4.00033 5.16699H12.0003C12.4606 5.16699 12.8337 5.54009 12.8337 6.00033C12.8337 6.46057 12.4606 6.83366 12.0003 6.83366H4.00033C3.54009 6.83366 3.16699 6.46057 3.16699 6.00033Z"
                                fill="#FF9D7B"
                            />
                            <path
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="M3.16699 10.0003C3.16699 9.54006 3.54009 9.16699 4.00033 9.16699H12.0003C12.4606 9.16699 12.8337 9.54006 12.8337 10.0003C12.8337 10.4606 12.4606 10.8337 12.0003 10.8337H4.00033C3.54009 10.8337 3.16699 10.4606 3.16699 10.0003Z"
                                fill="#FF9D7B"
                            />
                        </svg>
                    </button>
                    <button type="button" class="icon-btn icon-btn-small" data-word-id="${wordId}" data-btn-function="playPronunciation">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                        >
                            <path
                                d="M8.81304 2.03626C8.95642 1.74776 9.30654 1.63011 9.59499 1.77348C11.5143 2.72731 12.8354 4.70892 12.8354 7.00014C12.8354 9.29136 11.5143 11.273 9.59499 12.2268C9.30654 12.3702 8.95642 12.2525 8.81304 11.964C8.66965 11.6755 8.78731 11.3254 9.07583 11.1821C10.6138 10.4177 11.6687 8.83158 11.6687 7.00014C11.6687 5.1687 10.6138 3.58257 9.07583 2.81825C8.78731 2.67487 8.66965 2.32477 8.81304 2.03626Z"
                                fill="#FF9D7B"
                            />
                            <path
                                d="M3.5013 4.66632H2.33464C1.6903 4.66632 1.16797 5.18865 1.16797 5.83298V8.16632C1.16797 8.81067 1.6903 9.33298 2.33464 9.33298H3.5013L6.04452 11.4524C6.42444 11.769 7.0013 11.4988 7.0013 11.0042V2.9951C7.0013 2.50052 6.42444 2.23035 6.04452 2.54696L3.5013 4.66632Z"
                                fill="#FF9D7B"
                            />
                            <path
                                d="M9.80172 4.89954C9.60823 4.64194 9.24259 4.58997 8.98499 4.78346C8.72739 4.97694 8.67542 5.34261 8.86891 5.60021C9.1618 5.99012 9.33511 6.47393 9.33511 6.99987C9.33511 7.5258 9.1618 8.00962 8.86891 8.39952C8.67542 8.65712 8.72739 9.02281 8.98499 9.2163C9.24259 9.40979 9.60823 9.35782 9.80172 9.10022C10.2411 8.51519 10.5018 7.78713 10.5018 6.99987C10.5018 6.2126 10.2411 5.48455 9.80172 4.89954Z"
                                fill="#FF9D7B"
                            />
                        </svg>
                    </button>
                    <button type="button" class="icon-btn icon-btn-small" data-word-id="${wordId}" data-btn-function="deleteWord">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                        >
                            <path
                                d="M7.81667 7L12.075 2.74167C12.3083 2.50833 12.3083 2.15833 12.075 1.925C11.8417 1.69167 11.4917 1.69167 11.2583 1.925L7 6.18333L2.74167 1.925C2.50833 1.69167 2.15833 1.69167 1.925 1.925C1.69167 2.15833 1.69167 2.50833 1.925 2.74167L6.18333 7L1.925 11.2583C1.69167 11.4917 1.69167 11.8417 1.925 12.075C2.04167 12.1917 2.15833 12.25 2.33333 12.25C2.50833 12.25 2.625 12.1917 2.74167 12.075L7 7.81667L11.2583 12.075C11.375 12.1917 11.55 12.25 11.6667 12.25C11.7833 12.25 11.9583 12.1917 12.075 12.075C12.3083 11.8417 12.3083 11.4917 12.075 11.2583L7.81667 7Z"
                                fill="#FF9D7B"
                            />
                        </svg>
                    </button>
                </div>
            </li>`;
}

function createWordsList(words) {
    const dictionaryList = document.createElement("ul");
    dictionaryList.id = "wordList";
    dictionaryList.className = "word-list list";

    words.forEach((item) => {
        const listItem = generateDictionaryListItem(item.word, item.translation, item.id);

        dictionaryList.insertAdjacentHTML("afterbegin", listItem);
    });

    return dictionaryList;
}

async function displayDictionary() {
    try {
        // Get words from local storage (background script syncs with Firebase)
        const { words } = await chrome.storage.local.get(["words"]);
        if (words && words.length > 0) {
            const wordsList = createWordsList(words);
            wordListContainer.appendChild(wordsList);
        }
    } catch (error) {
        console.error('Error displaying dictionary:', error);
    }
}

function deleteWordFromPopupDictionary(changedWordId) {
    const changedListItem = wordList.querySelector(`[data-word-id="${changedWordId}"]`).parentNode;

    changedListItem.remove();
}

async function deleteWordFromStorage(wordId) {
    try {
        // Update local storage (background script will sync with Firebase)
        const { words } = await chrome.storage.local.get(["words"]);
        if (words) {
            const updatedWords = words.filter((word) => word.id !== wordId && word.id !== Number(wordId));
            chrome.storage.local.set({ words: updatedWords });
        }
    } catch (error) {
        console.error('Error deleting word:', error);
    }
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
                <span>${text}</span>
                <button type="button" class="icon-btn icon-btn-small">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                    >
                        <path
                            d="M7.81667 7L12.075 2.74167C12.3083 2.50833 12.3083 2.15833 12.075 1.925C11.8417 1.69167 11.4917 1.69167 11.2583 1.925L7 6.18333L2.74167 1.925C2.50833 1.69167 2.15833 1.69167 1.925 1.925C1.69167 2.15833 1.69167 2.50833 1.925 2.74167L6.18333 7L1.925 11.2583C1.69167 11.4917 1.69167 11.8417 1.925 12.075C2.04167 12.1917 2.15833 12.25 2.33333 12.25C2.50833 12.25 2.625 12.1917 2.74167 12.075L7 7.81667L11.2583 12.075C11.375 12.1917 11.55 12.25 11.6667 12.25C11.7833 12.25 11.9583 12.1917 12.075 12.075C12.3083 11.8417 12.3083 11.4917 12.075 11.2583L7.81667 7Z"
                            fill="#FF9D7B"
                        />
                    </svg>
                </button>
            </li>`;
}

function displayExclusionList(list) {
    list.forEach((site) => {
        const listItem = generateExclusionListItem(site);
        exclusionList.insertAdjacentHTML("afterbegin", listItem);
    });
}

async function toggleExtensionState() {
    const currentSiteHostname = getSiteHostname(currentSite);
    const result = await chrome.storage.local.get({
        excludedSites: [],
    });
    const excludedSites = result.excludedSites;

    let updatedList;

    if (enableExtensionCheckbox.checked) {
        updatedList = excludedSites.filter((site) => site !== currentSiteHostname);

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
        exclusionList.insertAdjacentHTML("afterbegin", listItem);
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
        exclusionList.insertAdjacentHTML("afterbegin", listItem);
        siteInput.value = "";

        const currentSiteHostname = getSiteHostname(currentSite);

        isEnabled = isEnabled ? site !== currentSiteHostname : false;
        enableExtensionCheckbox.checked = isEnabled;
    }
}

async function removeSiteFromExclusion(e) {
    const button = e.target.closest("button");

    console.log(button);

    if (button && button.parentElement.tagName === "LI") {
        const siteToRemove = button.parentElement.textContent.trim();

        const result = await chrome.storage.local.get({
            excludedSites: [],
        });

        const updatedList = result.excludedSites.filter((site) => site !== siteToRemove);
        await chrome.storage.local.set({ excludedSites: updatedList });
        button.parentElement.remove();

        const currentSiteHostname = getSiteHostname(currentSite);

        isEnabled = siteToRemove === currentSiteHostname || isEnabled;
        enableExtensionCheckbox.checked = isEnabled;
    }
}

function showNotification(message) {
    messageContainer.innerText = message;
    notificationContainer.classList.add("notification-shown");

    setTimeout(closeNotification, 5000);
}

function closeNotification() {
    if (!notificationContainer.classList.contains("notification-shown")) return;

    notificationContainer.classList.remove("notification-shown");
}

function toggleButton(button, input) {
    button.disabled = input.value.trim() === "";
    button.style.pointerEvents = button.disabled ? "none" : "auto";
}

function updateTelegram() {
    chrome.runtime.sendMessage(
        {
            action: "updateTelegram",
            telegramName: telegramName.value.trim(),
        },
        (response) => {
            if (response.success) {
                const message = "Telegram name has been successfully updated.";
                showNotification(message);
            } else {
                const message = "There was an error updating a telegram name. Please try again later.";
                showNotification(message);
            }
        }
    );

    telegramName.value = "";
}

function toggleVisibility(element) {
    element.style.display = element.style.display === "none" ? "block" : "none";
}

// Event listeners and initialization

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("tabs").addEventListener("click", (e) => {
        const tab = e.target.closest(".tab-action");

        if (!tab) return;

        showTab(tab.id);
    });

    wordCategoryList.addEventListener("click", (e) => {
        const category = e.target.closest(".word-category-btn");

        if (!category) return;

        showTab("dictionaryTab");
    });

    settingsButton.addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
    });

    // Google Sign In button
    googleSignInBtn.addEventListener("click", async () => {
        try {
            googleSignInBtn.disabled = true;
            googleSignInBtn.textContent = "Signing in...";
            
            // Send sign-in request to background script
            const response = await chrome.runtime.sendMessage({ action: "signInWithGoogle" });
            
            if (response && response.success) {
                console.log('Sign in successful:', response.user);
                showMainContent();
            } else {
                throw new Error(response?.error || 'Sign in failed');
            }
        } catch (error) {
            console.error('Sign in failed:', error);
            showNotification('Sign in failed. Please try again.');
            
            googleSignInBtn.disabled = false;
            googleSignInBtn.textContent = "Sign in with Google";
        }
    });

    logoutButton.addEventListener("click", async () => {
        try {
            // Send sign-out request to background script
            const response = await chrome.runtime.sendMessage({ action: "signOut" });
            
            // Clear local storage
            chrome.storage.local.remove(["token", "words", "auth_token", "user_info"]);
            
            showLoginPage();
        } catch (error) {
            console.error('Logout error:', error);
            // Fallback to clearing storage
            chrome.storage.local.remove(["token", "words", "auth_token", "user_info"]);
            showLoginPage();
        }
    });

    wordList.addEventListener("click", async (e) => {
        const button = e.target.closest("button");

        if (!button) return;

        const action = button.dataset.btnFunction;

        if (action === "showSynonym") {
            console.log("Synonyms");
        } else if (action === "playPronunciation") {
            console.log("Pronunciation");
        } else if (action === "deleteWord") {
            await deleteWordFromStorage(button.dataset.wordId);
        }
    });

    enableExtensionCheckbox.addEventListener("change", toggleExtensionState);

    siteInput.addEventListener("input", () => toggleButton(addSiteButton, siteInput));
    addSiteButton.addEventListener("click", addSiteToExclusion);

    exclusionList.addEventListener("click", async (e) => removeSiteFromExclusion(e));

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "wordsChanged") {
            console.log("words were changed: ", request.newValue);

            if (request.newValue.operation === "getAllWords") {
                displayDictionary().catch(console.error);
            } else if (request.newValue.operation === "deleteWord") {
                deleteWordFromPopupDictionary(request.newValue.wordId);
            }
        }
    });

    closeNotificationBtn.addEventListener("click", closeNotification);

    changeTelegramBtn.addEventListener("click", () => toggleVisibility(telegramContainer));
    openEnglishLevelBtn.addEventListener("click", () => toggleVisibility(englishLevelContainer));
    openLearningGoalsBtnBtn.addEventListener("click", () => toggleVisibility(learningGoalsContainer));

    telegramName.addEventListener("input", () => toggleButton(telegramButton, telegramName));
    telegramButton.addEventListener("click", () => {
        updateTelegram();
    });

    // Check authentication state via background script
    chrome.runtime.sendMessage({ action: "checkAuthState" }, (response) => {
        if (response && response.isAuthenticated) {
            console.log('User is authenticated');
            showMainContent();
            displayDictionary().catch(console.error);
        } else {
            console.log('User is not authenticated');
            showLoginPage();
        }
    });

    excludedSites = await getExcludedSites();
    currentSite = await getCurrentSite();
    isEnabled = checkIfCurrentSiteEnabled();
    enableExtensionCheckbox.checked = isEnabled;
    showTab("homeTab");
    displayExclusionList(excludedSites);
    getUserInfo();
    await displayDictionary();
});
