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
const learnedWordsCounter = document.getElementById("learnedWordsCounter");
const newWordsCounter = document.getElementById("newWordsCounter");
const allWordsCounter = document.getElementById("allWordsCounter");
const addWordInput = document.getElementById('addWordInput');
const addWordBtn = document.getElementById('addWordBtn');

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
        // Get current user from Chrome storage
        if (window.firebaseAuth && window.firebaseAuth.getCurrentUser) {
            const user = await window.firebaseAuth.getCurrentUser();
            if (user && userEmailContainer) {
                console.log('Current user:', user);
                userEmailContainer.textContent = user.email || 'Authenticated User';
                return user;
            }
        }
        console.log('No user signed in');
        return null;
    } catch (error) {
        console.error('Error getting user info:', error);
        return null;
    }
}

// Dictionary

function generateDictionaryListItem(word, translation, wordId, status = 'new') {
    const isLearned = status === 'learned';

    return `<li data-word-status="${status}" data-word-id="${wordId}">
                <span class="word-list-origin">${word}</span>
                <span class="word-list-translation">${translation}</span>
                <div class="word-list-actions">
                    <div>
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
                            <span class="custom-tooltip">Show more</span>
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
                            <span class="custom-tooltip">Pronunciation</span>
                        </button>
                        ${!isLearned ? `<button type="button" class="icon-btn icon-btn-small" data-word-id="${wordId}" data-btn-function="markAsLearned">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M11.6667 3.5L5.25 9.91667L2.33333 7" stroke="#FF9D7B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            <span class="custom-tooltip">Mark as learned</span>
                        </button>` : `<button type="button" class="icon-btn icon-btn-small" data-word-id="${wordId}" data-btn-function="markAsUnlearned">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M7 2.33333V7L10.5 10.5" stroke="#FF9D7B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            <span class="custom-tooltip">Mark as unlearned</span>
                        </button>`}
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
                            <span class="custom-tooltip">Delete</span>
                        </button>
                    </div>
                </div>
            </li>`;
}

let currentFilter = 'all';
let allWords = [];

function createWordsList(words, filter = 'all') {
    const wordList = document.getElementById("wordList");
    wordList.innerHTML = "";

    const filteredWords = filterWords(words, filter);

    filteredWords.forEach((item) => {
        const listItem = generateDictionaryListItem(
            item.word,
            item.translation,
            item.id,
            item.status || 'new'
        );
        wordList.insertAdjacentHTML("afterbegin", listItem);
    });

    // Update counters whenever word list is created
    updateWordCounters(words);
}

function filterWords(words, filter) {
    const today = new Date().toDateString();

    switch (filter) {
        case 'learned':
            return words.filter(word => word.status === 'learned');
        case 'today':
            return words.filter(word => {
                const ts = typeof word.dateAdded === 'string' || typeof word.dateAdded === 'number'
                  ? new Date(word.dateAdded)
                  : new Date();
                const wordDate = ts.toDateString();
                return wordDate === today && word.status !== 'learned';
            });
        case 'all':
        default:
            return words;
    }
}

function updateActiveFilterTab(activeFilter) {
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-filter="${activeFilter}"]`).classList.add('active');
}

function updateWordCounters(words) {
    const allCount = words.length;
    const learnedCount = words.filter(word => word.status === 'learned').length;
    const todayStr = new Date().toDateString();
    const todayCount = words.filter(word => {
        const ts = typeof word.dateAdded === 'string' || typeof word.dateAdded === 'number'
          ? new Date(word.dateAdded)
          : new Date();
        return ts.toDateString() === todayStr && word.status !== 'learned';
    }).length;

    if (learnedWordsCounter) learnedWordsCounter.textContent = learnedCount;
    if (newWordsCounter) newWordsCounter.textContent = todayCount;
    if (allWordsCounter) allWordsCounter.textContent = allCount;

    // Update counter displays
    const allTab = document.querySelector('[data-filter="all"]');
    const learnedTab = document.querySelector('[data-filter="learned"]');
    const todayTab = document.querySelector('[data-filter="today"]');

    if (allTab) {
        const counter = allTab.querySelector('.filter-counter');
        if (counter) counter.textContent = allCount;
    }

    if (learnedTab) {
        const counter = learnedTab.querySelector('.filter-counter');
        if (counter) counter.textContent = learnedCount;
    }

    if (todayTab) {
        const counter = todayTab.querySelector('.filter-counter');
        if (counter) counter.textContent = todayCount;
    }
}

async function displayDictionary() {
    try {
        let { words } = await chrome.storage.local.get(["words"]);
        if (!Array.isArray(words)) {
            // Try to trigger background sync then re-read
            chrome.runtime.sendMessage({ action: "saveWordsToStorage" });
            const retry = await new Promise((resolve) => setTimeout(async () => {
                const data = await chrome.storage.local.get(["words"]);
                resolve(data.words || []);
            }, 250));
            words = retry;
        }
        allWords = Array.isArray(words) ? words : [];
        createWordsList(allWords, currentFilter);
        updateWordCounters(allWords);
    } catch (e) {
        console.error('displayDictionary failed:', e);
    }
}

async function markWordAsLearned(wordId) {
    const {words} = await chrome.storage.local.get(["words"]);
    const updatedWords = words.map(word =>
        word.id === Number(wordId)
            ? {...word, status: 'learned', learnedDate: new Date().toISOString()}
            : word
    );

    chrome.storage.local.set({words: updatedWords});
    allWords = updatedWords;
    createWordsList(updatedWords, currentFilter);
}

async function markWordAsUnlearned(wordId) {
    const {words} = await chrome.storage.local.get(["words"]);
    const updatedWords = words.map(word =>
        word.id === Number(wordId)
            ? {
                ...word,
                status: 'new',
                dateAdded: new Date().toISOString(), // Reset to today's date
                learnedDate: undefined
            }
            : word
    );

    chrome.storage.local.set({words: updatedWords});
    allWords = updatedWords;
    createWordsList(updatedWords, currentFilter);
}

function playWordPronunciation(wordId) {
    const word = allWords.find(w => w.id === Number(wordId));
    if (word) {
        const utterance = new SpeechSynthesisUtterance(word.word);
        // TODO create onbording screen + add this to options to select languages and use it here
        utterance.lang = 'en-US';
        speechSynthesis.speak(utterance);
    }
}

function deleteWordFromPopupDictionary(changedWordId) {
    const changedListItem = wordList.querySelector(`[data-word-id="${changedWordId}"]`).parentNode;

    changedListItem.remove();
}

async function deleteWordFromStorage(wordId) {
    const {words} = await chrome.storage.local.get(["words"]);
    const updatedWords = words.filter((word) => word.id !== Number(wordId));

    chrome.storage.local.set({words: updatedWords});
    allWords = updatedWords;
    createWordsList(updatedWords, currentFilter);
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

    await chrome.storage.local.set({excludedSites: updatedList});
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
        await chrome.storage.local.set({excludedSites: updatedList});

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
        await chrome.storage.local.set({excludedSites: updatedList});
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
        // Tab navigation
        const tabsContainer = document.getElementById("tabs");
        if (tabsContainer) {
            tabsContainer.addEventListener("click", (e) => {
                const tab = e.target.closest(".tab-action");
                if (!tab) return;
                showTab(tab.id);
                if (tab.id === 'dictionaryTab') {
                    displayDictionary().catch(console.error);
                }
            });
        }

        // Word category navigation
        if (wordCategoryList) {
            wordCategoryList.addEventListener("click", (e) => {
                const category = e.target.closest(".word-category-btn");
                if (!category) return;
                showTab("dictionaryTab");
            });
        }

        // Settings button
        if (settingsButton) {
            settingsButton.addEventListener("click", () => {
                chrome.runtime.openOptionsPage();
            });
        }

        // Google Sign In button
        if (googleSignInBtn) {
            googleSignInBtn.addEventListener("click", async () => {
                try {
                    googleSignInBtn.disabled = true;
                    googleSignInBtn.textContent = "Signing in...";

                    const result = await window.firebaseAuth.signInWithGoogle();
                    console.log('Sign in successful:', result);

                    // Manually trigger the UI change to main content
                    showMainContent();

                    // Update user info display
                    await getUserInfo();

                } catch (error) {
                    console.error('Sign in failed:', error);
                    showNotification('Sign in failed. Please try again.');

                    googleSignInBtn.disabled = false;
                    googleSignInBtn.textContent = "Sign in with Google";
                }
            });
        }
        // Logout button
        if (logoutButton) {
            logoutButton.addEventListener("click", async () => {
                try {
                    // Sign out from auth system
                    if (window.firebaseAuth && window.firebaseAuth.signOut) {
                        await window.firebaseAuth.signOut();
                    }

                    // Clear local storage
                    chrome.storage.local.remove(["token", "words", "auth_token"]);

                    showLoginPage();
                } catch (error) {
                    console.error('Logout error:', error);
                    // Fallback to clearing storage even if auth logout fails
                    chrome.storage.local.remove(["token", "words", "auth_token"]);
                    showLoginPage();
                }
            });
        }

    wordCategoryList.addEventListener("click", (e) => {
        const category = e.target.closest(".word-category-btn");

        if (!category) return;

        // Determine which filter to apply based on the clicked category
        let targetFilter = 'all';
        if (category.id === 'newWordsList') {
            targetFilter = 'all';
        } else if (category.id === 'savedWordsList') {
            targetFilter = 'today';
        } else if (category.id === 'learnedWordsList') {
            targetFilter = 'learned';
        }

        // Set the filter and update the UI
        currentFilter = targetFilter;
        updateActiveFilterTab(currentFilter);
        createWordsList(allWords, currentFilter);

        showTab("dictionaryTab");
    });

    settingsButton.addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
    });

    logoutButton.addEventListener("click", () => {
        chrome.storage.local.remove(["token", "words"]);

        showLoginPage();
    });

    document.addEventListener("click", async (e) => {
        const button = e.target.closest("button");

        if (!button) return;

        // Handle filter tabs
        if (button.classList.contains('filter-tab')) {
            currentFilter = button.dataset.filter;
            updateActiveFilterTab(currentFilter);
            createWordsList(allWords, currentFilter);
            return;
        }

        // Handle word actions
        const action = button.dataset.btnFunction;
        if (!action) return;

        if (action === "showSynonym") {
            try {
                const wordId = Number(button.dataset.wordId);
                renderWordDetailsById(wordId);
            } catch (e) {
                console.error('Open word details failed:', e);
            }
        } else if (action === "playPronunciation") {
            playWordPronunciation(button.dataset.wordId);
        } else if (action === "markAsLearned") {
            await markWordAsLearned(button.dataset.wordId);
        } else if (action === "markAsUnlearned") {
            await markWordAsUnlearned(button.dataset.wordId);
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

            const op = request.newValue.operation;
            if (op === "getAllWords") {
                displayDictionary().catch(console.error);
            } else if (op === "deleteWord") {
                deleteWordFromPopupDictionary(request.newValue.wordId);
                // refresh counters after delete
                displayDictionary().catch(console.error);
            } else if (op === "add" || op === "update" || op === "reload") {
                // simple refresh to keep list and counters in sync
                displayDictionary().catch(console.error);
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

    //token verification
    // chrome.storage.local.get(["token"], (result) => {
    //     console.log(result);
    //     if (isTokenValid(result.token)) {
    //         // Token exists, now validate it
    //         console.log("The token is valid");
    //         showMainContent();
    //     } else {
    //         console.log("The token is invalid");
    //         showLoginPage();
    //     }
    // });

    // Check if onboarding is completed with robust double-check
    const checkOnboardingCompletion = async () => {
        // First check
        const firstCheck = await new Promise(resolve => {
            chrome.storage.local.get({onboardingCompleted: false}, resolve);
        });
        
        console.log('First onboarding check:', firstCheck);
        
        if (firstCheck.onboardingCompleted) {
            console.log('Onboarding completed, continuing with popup...');
            return true;
        }
        
        // Wait a bit for storage to settle, then check again
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const secondCheck = await new Promise(resolve => {
            chrome.storage.local.get({onboardingCompleted: false}, resolve);
        });
        
        console.log('Second onboarding check:', secondCheck);
        
        if (!secondCheck.onboardingCompleted) {
            console.log('Onboarding not completed after double-check, requesting redirect...');
            // Ask background to handle onboarding redirect
            chrome.runtime.sendMessage({action: 'needOnboarding'});
            window.close();
            return false;
        }
        
        console.log('Onboarding completed on second check, continuing...');
        return true;
    };
    
    const onboardingCompleted = await checkOnboardingCompletion();
    if (!onboardingCompleted) return;
        
    // Continue with normal authentication flow
    const currentUser = await getUserInfo();
    if (currentUser) {
        showMainContent();
    } else {
        chrome.storage.local.get(["token"], (result) => {
            if (isTokenValid(result.token)) {
                showMainContent();
            } else {
                showLoginPage();
            }
        });
    }
    
    // Initialize extension state after authentication
    excludedSites = await getExcludedSites();
    currentSite = await getCurrentSite();
    isEnabled = checkIfCurrentSiteEnabled();
    enableExtensionCheckbox.checked = isEnabled;
    showTab("homeTab");
    displayExclusionList(excludedSites);
    await displayDictionary();
});

// Add New Word from Home
function toggleAddButton() {
    if (!addWordBtn || !addWordInput) return;
    const hasText = addWordInput.value.trim().length > 0;
    addWordBtn.disabled = !hasText;
}

async function addNewWordFromPopup() {
    try {
        if (!addWordInput) return;
        const raw = addWordInput.value.trim();
        if (!raw) return;
        const wordLower = raw.toLowerCase();

        // Get target language
        const { translateTo } = await chrome.storage.local.get(['translateTo']);
        const targetLanguage = (translateTo || 'uk');

        // Ask background to translate (also returns synonyms/examples)
        const resp = await chrome.runtime.sendMessage({
            action: 'translateWord',
            word: wordLower,
            targetLanguage
        });

        const tr = (resp && resp.success && resp.result) ? resp.result : { translation: wordLower, synonyms: [], examples: [] };
        const translation = tr.translation || wordLower;
        const synonyms = Array.isArray(tr.synonyms) ? tr.synonyms : [];
        const examples = Array.isArray(tr.examples) ? tr.examples : [];

        // Load current words and ensure unique id
        const { words = [] } = await chrome.storage.local.get(['words']);
        let newId = Date.now();
        const ids = new Set((words || []).map(w => Number(w.id)));
        while (ids.has(newId)) newId += 1;

        const newWord = {
            id: newId,
            word: wordLower,
            translation,
            dateAdded: Date.now(),
            status: 'new',
            learned: false,
            synonyms,
            examples
        };

        const updated = [...words, newWord];
        await chrome.storage.local.set({ words: updated });
        allWords = updated;
        createWordsList(updated, currentFilter);
        updateWordCounters(updated);

        addWordInput.value = '';
        toggleAddButton();
        showNotification('Word added');
    } catch (e) {
        console.error('Add new word failed:', e);
        showNotification('Failed to add word');
    }
}

if (addWordInput) {
    addWordInput.addEventListener('input', toggleAddButton);
    addWordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !addWordBtn.disabled) {
            addNewWordFromPopup();
        }
    });
}
if (addWordBtn) {
    addWordBtn.addEventListener('click', addNewWordFromPopup);
}

// ---- Word details SPA rendering ----
function showSection(sectionId) {
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(c => c.style.display = 'none');
    const target = document.getElementById(sectionId);
    if (target) target.style.display = 'flex';
}

async function renderWordDetailsById(wordId) {
    try {
        const { words = [] } = await chrome.storage.local.get(['words']);
        const found = words.find(w => Number(w.id) === Number(wordId));
        if (!found) return;

        const titleEl = document.getElementById('detailsTitle');
        const trEl = document.getElementById('detailsTranslation');
        const synList = document.getElementById('detailsSynonyms');
        const synEmpty = document.getElementById('detailsSynonymsEmpty');
        const exList = document.getElementById('detailsExamples');

        titleEl.textContent = found.word || 'Word';
        trEl.textContent = found.translation || '';

        // Synonyms
        synList.innerHTML = '';
        const synonyms = Array.isArray(found.synonyms) ? found.synonyms : [];
        if (synonyms.length === 0) {
            synEmpty.style.display = 'block';
        } else {
            synEmpty.style.display = 'none';
            synonyms.forEach(s => {
                const li = document.createElement('li');
                li.className = 'synonym-item';
                li.textContent = `${s?.source || ''} — ${s?.translation || ''}`;
                synList.appendChild(li);
            });
        }

        // Examples: prefer stored, else placeholders
        exList.innerHTML = '';
        const ex = Array.isArray(found.examples) && found.examples.length > 0
          ? found.examples
          : [
              `This is a sample sentence using "${found.word}" in context to demonstrate usage and meaning.`,
              `Another example for "${found.word}" that shows how it may appear in a paragraph.`,
              `A third placeholder sentence with "${found.word}" for future API-generated examples.`
            ];
        ex.forEach(t => {
            const li = document.createElement('li');
            li.textContent = t;
            exList.appendChild(li);
        });

        showSection('wordDetailsContent');

        const backBtn = document.getElementById('backToDictionaryBtn');
        if (backBtn && !backBtn._handlerAttached) {
            backBtn.addEventListener('click', () => showTab('dictionaryTab'));
            backBtn._handlerAttached = true;
        }
    } catch (e) {
        console.error('renderWordDetailsById failed:', e);
    }
}
