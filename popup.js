// Prevent popup.js from running on non-popup pages (like onboarding)
(function() {
    // Use DOM-based detection - popup page has #mainContent, onboarding doesn't
    const isPopupContext = !!document.getElementById('mainContent');
    if (!isPopupContext) {
        return; // Exit immediately - not the popup page
    }

    // Run popup.js on popup page only

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
const userTelegramContainer = document.getElementById("userTelegram");
const learnedWordsCounter = document.getElementById("learnedWordsCounter");
const newWordsCounter = document.getElementById("newWordsCounter");
const allWordsCounter = document.getElementById("allWordsCounter");
const addWordInput = document.getElementById('addWordInput');
const addWordBtn = document.getElementById('addWordBtn');
const subscriptionStatus = document.getElementById('subscriptionStatus');
const subscriptionPlan = document.getElementById('subscriptionPlan');
const subscriptionLimit = document.getElementById('subscriptionLimit');
const usageText = document.getElementById('usageText');
const usageProgress = document.getElementById('usageProgress');
const upgradeBtn = document.getElementById('upgradeBtn');

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
    try {
        const parts = String(token).split(".");
        if (parts.length !== 3) {
            return false;
        }
        const normalizedPayload = parts[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
        const payload = JSON.parse(atob(normalizedPayload));
        return Number.isFinite(Number(payload.exp)) && Date.now() < Number(payload.exp) * 1000;
    } catch {
        return false;
    }
}

async function getUserInfo() {
    try {
        // Get current user from Chrome storage
        if (window.firebaseAuth && window.firebaseAuth.getCurrentUser) {
            const user = await window.firebaseAuth.getCurrentUser();
            if (user && userEmailContainer) {
                console.log('Current user:', user);
                userEmailContainer.textContent = user.email || 'Authenticated User';
                if (userTelegramContainer) {
                    userTelegramContainer.textContent = user.telegramName
                        ? `@${String(user.telegramName).replace(/^@+/, "")}`
                        : "Not connected";
                }
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

function createWordActionButton(action, wordId, label, glyph) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn icon-btn-small";
    button.dataset.wordId = String(wordId);
    button.dataset.btnFunction = action;
    button.setAttribute("aria-label", label);
    button.title = label;

    const glyphNode = document.createElement("span");
    glyphNode.className = "word-action-glyph";
    glyphNode.setAttribute("aria-hidden", "true");
    glyphNode.textContent = glyph;
    button.appendChild(glyphNode);
    return button;
}

function createDictionaryListItem(item) {
    const safeWordId = Number(item?.id);
    if (!Number.isSafeInteger(safeWordId)) {
        return null;
    }

    const status = item?.status === "learned" || item?.learned === true
        ? "learned"
        : "new";
    const listItem = document.createElement("li");
    listItem.dataset.wordStatus = status;
    listItem.dataset.wordId = String(safeWordId);

    const word = document.createElement("span");
    word.className = "word-list-origin";
    word.textContent = String(item?.word || "");

    const translation = document.createElement("span");
    translation.className = "word-list-translation";
    translation.textContent = String(item?.translation || "");

    const actions = document.createElement("div");
    actions.className = "word-list-actions";
    const actionRow = document.createElement("div");
    actionRow.append(
        createWordActionButton("showSynonym", safeWordId, "Show details", "…"),
        createWordActionButton("playPronunciation", safeWordId, "Play pronunciation", "▶"),
        status === "learned"
            ? createWordActionButton("markAsUnlearned", safeWordId, "Mark as learning", "↺")
            : createWordActionButton("markAsLearned", safeWordId, "Mark as learned", "✓"),
        createWordActionButton("deleteWord", safeWordId, "Delete word", "×")
    );
    actions.appendChild(actionRow);
    listItem.append(word, translation, actions);
    return listItem;
}

function getWordTimestamp(word) {
    const candidate = word?.dateAdded || word?.createdAt || word?.importedAt || 0;
    const timestamp = typeof candidate === "number"
        ? candidate
        : new Date(candidate).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

let currentFilter = 'all';
let allWords = [];

function createWordsList(words, filter = 'all') {
    const wordList = document.getElementById("wordList");
    wordList.replaceChildren();

    const filteredWords = filterWords(Array.isArray(words) ? words : [], filter)
        .slice()
        .sort((left, right) => {
            const timestampDelta = getWordTimestamp(right) - getWordTimestamp(left);
            if (timestampDelta !== 0) {
                return timestampDelta;
            }
            // Stable tie-breaker: words sharing an identical timestamp still
            // need a deterministic newest-first order, so fall back to id
            // (ids are monotonically increasing, so this also reads newest-first).
            return (Number(right?.id) || 0) - (Number(left?.id) || 0);
        });

    filteredWords.forEach((item) => {
        const listItem = createDictionaryListItem(item);
        if (listItem) {
            wordList.appendChild(listItem);
        }
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

async function updateSubscriptionDisplay() {
    try {
        if (!window.subscriptionManager) {
            console.warn('Subscription manager not available');
            return;
        }

        const displayInfo = await window.subscriptionManager.getSubscriptionDisplayInfo();
        
        if (!subscriptionStatus) return;

        // Show subscription status
        subscriptionStatus.style.display = 'block';

        // Update plan display
        const planText = displayInfo.isPremium ? 
            (displayInfo.subscriptionStatus === 'lifetime' ? 'Lifetime Plan' : 'Premium Plan') : 
            'Free Plan';
        if (subscriptionPlan) subscriptionPlan.textContent = planText;

        // Update limit display
        const limitText = displayInfo.isPremium ? 'Unlimited words per day' : `${displayInfo.dailyWordLimit} words per day`;
        if (subscriptionLimit) subscriptionLimit.textContent = limitText;

        // Update usage display
        if (displayInfo.isPremium) {
            if (usageText) usageText.textContent = `${displayInfo.dailyWordsAdded} words added today`;
            if (usageProgress) usageProgress.style.width = '100%';
        } else {
            if (usageText) usageText.textContent = `${displayInfo.dailyWordsAdded} of ${displayInfo.dailyWordLimit} words used today`;
            const percentage = Math.min(100, (displayInfo.dailyWordsAdded / displayInfo.dailyWordLimit) * 100);
            if (usageProgress) usageProgress.style.width = `${percentage}%`;
        }

        // Update CSS classes
        subscriptionStatus.classList.remove('premium', 'limit-reached');
        if (displayInfo.isPremium) {
            subscriptionStatus.classList.add('premium');
        } else if (!displayInfo.canAddWords) {
            subscriptionStatus.classList.add('limit-reached');
        }

        // Show/hide upgrade button
        if (upgradeBtn) {
            upgradeBtn.style.display = displayInfo.isPremium ? 'none' : 'block';
        }

        // Update add word button state
        if (addWordBtn && !displayInfo.canAddWords && !displayInfo.isPremium) {
            addWordBtn.disabled = true;
            addWordBtn.textContent = 'Daily Limit Reached';
        } else if (addWordBtn) {
            addWordBtn.textContent = 'Add';
            // Re-enable if input has text and limit allows
            if (addWordInput && addWordInput.value.trim()) {
                addWordBtn.disabled = false;
            }
        }

    } catch (error) {
        console.error('Error updating subscription display:', error);
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
        await updateSubscriptionDisplay();
    } catch (e) {
        console.error('displayDictionary failed:', e);
    }
}

// Saved sentences (issue #28)
//
// Intentionally a separate render path/list from the word dictionary
// above: sentence records are private per account and are never merged
// into allWords/wordList.

function createSentenceListItem(item) {
    const safeSentenceId = Number(item?.id);
    if (!Number.isSafeInteger(safeSentenceId)) {
        return null;
    }

    const listItem = document.createElement("li");
    listItem.dataset.sentenceId = String(safeSentenceId);

    const text = document.createElement("span");
    text.className = "word-list-origin";
    text.textContent = String(item?.text || "");

    const translation = document.createElement("span");
    translation.className = "word-list-translation";
    translation.textContent = String(item?.translation || "");

    const actions = document.createElement("div");
    actions.className = "word-list-actions";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "icon-btn icon-btn-small";
    deleteButton.dataset.sentenceAction = "deleteSentence";
    deleteButton.dataset.sentenceId = String(safeSentenceId);
    deleteButton.setAttribute("aria-label", "Delete sentence");
    deleteButton.textContent = "×";
    actions.appendChild(deleteButton);

    listItem.append(text, translation, actions);
    return listItem;
}

function renderSentences(sentences) {
    const list = document.getElementById("sentenceList");
    const emptyState = document.getElementById("sentenceListEmpty");
    if (!list) return;

    list.replaceChildren();
    const items = Array.isArray(sentences) ? sentences : [];
    items
        .slice()
        .sort((left, right) => Number(right?.dateAdded || 0) - Number(left?.dateAdded || 0))
        .forEach((item) => {
            const listItem = createSentenceListItem(item);
            if (listItem) {
                list.appendChild(listItem);
            }
        });

    if (emptyState) {
        emptyState.style.display = items.length ? "none" : "block";
    }
}

async function displaySentences() {
    try {
        const { sentences } = await chrome.storage.local.get({ sentences: [] });
        renderSentences(sentences);
    } catch (error) {
        console.error('displaySentences failed:', error);
    }
}

async function deleteSentence(sentenceId) {
    try {
        const response = await chrome.runtime.sendMessage({ action: "deleteSentence", sentenceId });
        if (!response?.success) {
            throw new Error(response?.error?.message || "Unable to delete the sentence.");
        }
        await displaySentences();
    } catch (error) {
        console.error('deleteSentence failed:', error);
    }
}

async function markWordAsLearned(wordId) {
    const {words = []} = await chrome.storage.local.get({ words: [] });
    const word = words.find((item) => Number(item.id) === Number(wordId));
    if (!word) return;
    await persistWord({
        ...word,
        status: 'learned',
        learned: true,
        learnedDate: new Date().toISOString(),
        lastUpdated: Date.now()
    });
}

async function markWordAsUnlearned(wordId) {
    const {words = []} = await chrome.storage.local.get({ words: [] });
    const word = words.find((item) => Number(item.id) === Number(wordId));
    if (!word) return;
    await persistWord({
        ...word,
        status: 'new',
        learned: false,
        learnedDate: null,
        lastUpdated: Date.now()
    });
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
    const safeWordId = Number(changedWordId);
    if (!Number.isSafeInteger(safeWordId)) {
        return;
    }
    const changedListItem = document.querySelector(
        `#wordList > li[data-word-id="${safeWordId}"]`
    );
    changedListItem?.remove();
}

async function deleteWordFromStorage(wordId) {
    const response = await chrome.runtime.sendMessage({
        action: "deleteWord",
        wordId: Number(wordId)
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to delete the word.");
    }
    await displayDictionary();
}

async function persistWord(word) {
    const response = await chrome.runtime.sendMessage({
        action: "persistWord",
        word
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to update the word.");
    }
    await displayDictionary();
    return response.word;
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
    try {
        return new URL(site).hostname.toLocaleLowerCase();
    } catch {
        return "";
    }
}

function hostnameMatches(hostname, excludedHostname) {
    const normalizedHostname = String(hostname || "").trim().toLocaleLowerCase();
    const normalizedExcluded = String(excludedHostname || "")
        .trim()
        .replace(/^\.+|\.+$/g, "")
        .toLocaleLowerCase();
    return Boolean(normalizedHostname && normalizedExcluded)
        && (
            normalizedHostname === normalizedExcluded
            || normalizedHostname.endsWith(`.${normalizedExcluded}`)
        );
}

function checkIfCurrentSiteEnabled() {
    const siteHostname = getSiteHostname(currentSite);
    return !excludedSites.some((site) => {
        return hostnameMatches(siteHostname, site);
    });
}

function generateExclusionListItem(text) {
    const listItem = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = String(text || "");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn icon-btn-small";
    button.setAttribute("aria-label", `Remove ${label.textContent} from exclusions`);
    button.textContent = "×";
    listItem.append(label, button);
    return listItem;
}

function displayExclusionList(list) {
    exclusionList.replaceChildren();
    list.forEach((site) => {
        const listItem = generateExclusionListItem(site);
        exclusionList.appendChild(listItem);
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
        exclusionList.prepend(listItem);
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
        exclusionList.prepend(listItem);
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

async function updateTelegram() {
    const value = telegramName.value.trim();
    telegramButton.disabled = true;
    try {
        const response = await chrome.runtime.sendMessage({
            action: "updateTelegram",
            telegramName: value
        });
        if (!response?.success) {
            throw new Error(
                response?.error?.message
                || "There was an error updating your Telegram username."
            );
        }

        telegramName.value = "";
        if (userTelegramContainer) {
            userTelegramContainer.textContent = `@${response.telegramName}`;
        }
        showNotification("Telegram username updated.");
    } catch (error) {
        showNotification(error?.message || "Unable to update Telegram.");
    } finally {
        toggleButton(telegramButton, telegramName);
    }
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
                } else if (tab.id === 'sentencesTab') {
                    displaySentences().catch(console.error);
                }
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

                    // After login, if onboarding not completed, open it immediately (once)
                    const state = await new Promise(resolve => {
                        chrome.storage.local.get({ onboardingCompleted: false, onboardingShownAfterLogin: false }, resolve);
                    });
                    if (!state.onboardingCompleted && !state.onboardingShownAfterLogin) {
                        await chrome.storage.local.set({ onboardingShownAfterLogin: true });
                        chrome.runtime.sendMessage({ action: 'needOnboarding' });
                        window.close();
                        return;
                    }

                    // Otherwise, show main content
                    showMainContent();

                    // Update user info display
                    await getUserInfo();

                } catch (error) {
                    console.error('Sign in failed:', error);
                    const readableMessage = window.firebaseAuth?.getReadableAuthError
                        ? window.firebaseAuth.getReadableAuthError(error)
                        : 'Google sign-in failed. Please try again.';
                    showNotification(readableMessage);

                    googleSignInBtn.disabled = false;
                    googleSignInBtn.textContent = "Sign in with Google";
                }
            });
        }
        // Logout button
        if (logoutButton) {
            logoutButton.addEventListener("click", async () => {
                const localAuthKeys = [
                    "token",
                    "words",
                    "auth_token",
                    "firebase_id_token",
                    "firebase_refresh_token",
                    "firebase_token_exp",
                    "user_info",
                    "userInfo",
                    // Sentences are private per account (issue #28) and must
                    // not survive into the next session on this device.
                    "sentences",
                    "sentencesOwnerUid"
                ];
                try {
                    // Sign out from auth system
                    if (window.firebaseAuth && window.firebaseAuth.signOut) {
                        await window.firebaseAuth.signOut();
                    }

                    // Keep this idempotent in case an auth implementation leaves
                    // one of the local credential aliases behind.
                    await chrome.storage.local.remove(localAuthKeys);

                    showLoginPage();
                } catch (error) {
                    console.error('Logout error:', error);
                    // A failed provider logout must not leave reusable Firebase
                    // credentials or identity data in extension storage.
                    await chrome.storage.local.remove(localAuthKeys);
                    showLoginPage();
                }
            });
        }

    if (wordCategoryList) {
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
    }

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

        // Handle sentence actions (kept separate from word actions above --
        // sentences are a distinct model, see issue #28)
        if (button.dataset.sentenceAction === "deleteSentence") {
            await deleteSentence(button.dataset.sentenceId);
            return;
        }

        // Handle word actions
        const action = button.dataset.btnFunction;
        if (!action) return;

        try {
            if (action === "showSynonym") {
                const wordId = Number(button.dataset.wordId);
                renderWordDetailsById(wordId);
            } else if (action === "playPronunciation") {
                playWordPronunciation(button.dataset.wordId);
            } else if (action === "markAsLearned") {
                await markWordAsLearned(button.dataset.wordId);
            } else if (action === "markAsUnlearned") {
                await markWordAsUnlearned(button.dataset.wordId);
            } else if (action === "deleteWord") {
                await deleteWordFromStorage(button.dataset.wordId);
            }
        } catch (error) {
            console.error(`Word action ${action} failed:`, error);
            showNotification(error?.message || "The word action failed.");
        }
    });

    enableExtensionCheckbox.addEventListener("change", toggleExtensionState);

    siteInput.addEventListener("input", () => toggleButton(addSiteButton, siteInput));
    addSiteButton.addEventListener("click", addSiteToExclusion);

    exclusionList.addEventListener("click", async (e) => removeSiteFromExclusion(e));

    // Add defensive check for Chrome API availability
    if (chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
        chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "wordsChanged") {
            console.log("words were changed: ", request.newValue);

            const op = request.newValue.operation;
            if (op === "getAllWords") {
                displayDictionary().catch(console.error);
            } else if (op === "delete" || op === "deleteWord") {
                deleteWordFromPopupDictionary(request.newValue.wordId);
                // refresh counters after delete
                displayDictionary().catch(console.error);
            } else if (op === "add" || op === "update" || op === "reload") {
                // simple refresh to keep list and counters in sync
                displayDictionary().catch(console.error);
            }
        }

        if (request.action === "sentencesChanged") {
            renderSentences(Array.isArray(request.newValue?.sentences) ? request.newValue.sentences : []);
        }
        });
    }

    closeNotificationBtn.addEventListener("click", closeNotification);

    changeTelegramBtn.addEventListener("click", () => toggleVisibility(telegramContainer));
    openEnglishLevelBtn.addEventListener("click", () => toggleVisibility(englishLevelContainer));
    openLearningGoalsBtnBtn.addEventListener("click", () => toggleVisibility(learningGoalsContainer));

    telegramName.addEventListener("input", () => toggleButton(telegramButton, telegramName));
    telegramButton.addEventListener("click", () => {
        updateTelegram().catch(console.error);
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

    // Authenticate first, then gate onboarding for authenticated users
    const ensureAuthenticated = async () => {
        const currentUser = await getUserInfo();
        if (currentUser) return true;
        return new Promise((resolve) => {
            chrome.storage.local.get(["token"], (result) => {
                if (isTokenValid(result.token)) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    };

    const isAuthed = await ensureAuthenticated();
    if (!isAuthed) {
        // Not logged in: show login page, do NOT open onboarding yet
        showLoginPage();
        return;
    }

    // Logged in: check if onboarding is completed; if not, only show once after login
    const checkOnboardingCompletion = async () => {
        const state = await new Promise(resolve => {
            chrome.storage.local.get({
                onboardingCompleted: false,
                onboardingShownAfterLogin: false
            }, resolve);
        });

        if (state.onboardingCompleted) return true;

        // Show onboarding only once after login; don't nag next time
        if (!state.onboardingShownAfterLogin) {
            await chrome.storage.local.set({ onboardingShownAfterLogin: true });
            chrome.runtime.sendMessage({ action: 'needOnboarding' });
            window.close();
            return false;
        }

        // Already shown once; skip redirect and continue to main content
        return true;
    };

    const onboardingCompleted = await checkOnboardingCompletion();
    if (!onboardingCompleted) return;

    // Authenticated and onboarding completed: show main content
    showMainContent();
    
    // Initialize extension state after authentication
    excludedSites = await getExcludedSites();
    currentSite = await getCurrentSite();
    isEnabled = checkIfCurrentSiteEnabled();
    enableExtensionCheckbox.checked = isEnabled;
    showTab("homeTab");
    displayExclusionList(excludedSites);
    await displayDictionary();
    
    // Initialize subscription display
    await updateSubscriptionDisplay();
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

        // Check subscription limits before adding
        if (window.subscriptionManager) {
            const limitCheck = await window.subscriptionManager.canAddWord();
            if (!limitCheck.canAdd) {
                if (limitCheck.reason === 'daily_limit_reached') {
                    showNotification('Daily word limit reached. Upgrade to Premium for unlimited words.');
                    return;
                }
            }
        }

        // Get target language
        const { translateTo } = await chrome.storage.local.get(['translateTo']);
        const targetLanguage = (translateTo || 'uk');

        // Ask background to translate (also returns synonyms/examples)
        const resp = await chrome.runtime.sendMessage({
            action: 'translateWord',
            word: wordLower,
            targetLanguage
        });

        if (!resp?.success || !resp?.result?.translation) {
            throw new Error(resp?.error?.message || "Translation failed. Please try again.");
        }
        const tr = resp.result;
        const translation = String(tr.translation).trim();
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
            encounterCount: 0,
            synonyms,
            examples
        };

        await persistWord(newWord);
        await updateSubscriptionDisplay(); // Update subscription display after adding word

        addWordInput.value = '';
        toggleAddButton();
        showNotification('Word added successfully');
    } catch (e) {
        console.error('Add new word failed:', e);
        showNotification(e?.message || 'Failed to add word');
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

// Upgrade button event listener
if (upgradeBtn) {
    upgradeBtn.addEventListener('click', () => {
        // Open pricing page
        chrome.tabs.create({ url: 'https://lazylex.com/#/pricing' });
    });
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
        synList.replaceChildren();
        const synonyms = Array.isArray(found.synonyms) ? found.synonyms : [];
        if (synonyms.length === 0) {
            synEmpty.style.display = 'block';
        } else {
            synEmpty.style.display = 'none';
            synonyms.forEach(s => {
                const li = document.createElement('li');
                li.className = 'synonym-item';
                li.textContent = `${s?.source || ''} – ${s?.translation || ''}`;
                synList.appendChild(li);
            });
        }

        // Examples: prefer stored; if empty, fetch from backend once and persist
        exList.replaceChildren();
        let examples = Array.isArray(found.examples) && found.examples.length > 0 ? found.examples : [];

        if (examples.length === 0) {
            try {
                const { translateTo } = await chrome.storage.local.get(['translateTo']);
                const targetLanguage = (translateTo || 'uk');
                const resp = await chrome.runtime.sendMessage({
                    action: 'translateWord',
                    word: found.word,
                    targetLanguage
                });
                if (resp && resp.success && resp.result) {
                    const tr = resp.result;
                    const newExamples = Array.isArray(tr.examples) ? tr.examples.slice(0, 5) : [];
                    const newSynonyms = Array.isArray(tr.synonyms) ? tr.synonyms.slice(0, 8) : [];
                    if (newExamples.length > 0 || newSynonyms.length > 0) {
                        // Persist back to storage for this word
                        const updated = (words || []).map(w => {
                            if (Number(w.id) === Number(wordId)) {
                                return {
                                    ...w,
                                    examples: newExamples.length > 0 ? newExamples : w.examples,
                                    synonyms: newSynonyms.length > 0 ? newSynonyms : w.synonyms,
                                };
                            }
                            return w;
                        });
                        await chrome.storage.local.set({ words: updated });
                        examples = newExamples.length > 0 ? newExamples : examples;

                        // If synonyms were empty before, render them now
                        if (synonyms.length === 0 && newSynonyms.length > 0) {
                            synEmpty.style.display = 'none';
                            newSynonyms.forEach(s => {
                                const li = document.createElement('li');
                                li.className = 'synonym-item';
                                li.textContent = `${s?.source || ''} – ${s?.translation || ''}`;
                                synList.appendChild(li);
                            });
                        }
                    }
                }
            } catch (e) {
                console.warn('On-demand examples fetch failed:', e?.message || e);
            }
        }

        // Final render for examples (fallback to local placeholders if still empty)
        const toRender = examples.length > 0
            ? examples
            : [
                `This is a sample sentence using "${found.word}" in context to demonstrate usage and meaning.`,
                `Another example for "${found.word}" that shows how it may appear in a paragraph.`,
                `A third placeholder sentence with "${found.word}" for future API-generated examples.`
              ];
        toRender.forEach(t => {
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

// End of popup.js main code
})(); // End of IIFE wrapper
