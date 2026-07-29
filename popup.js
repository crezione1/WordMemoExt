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
        createWordActionButton("showSynonym", safeWordId, "Show details", "â€¦"),
        createWordActionButton("playPronunciation", safeWordId, "Play pronunciation", "â–¶"),
        status === "learned"
            ? createWordActionButton("markAsUnlearned", safeWordId, "Mark as learning", "â†º")
            : createWordActionButton("markAsLearned", safeWordId, "Mark as learned", "âœ“"),
        createWordActionButton("deleteWord", safeWordId, "Delete word", "Ã—")
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
        .sort((left, right) => getWordTimestamp(right) - getWordTimestamp(left));

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
        const utterancßÎü¶‰žËkºwµçUÝ]½É‘Í1¥ÍÐœ¤ì(€€€€€€€€€€€€€€€Ñ…É•Ñ¥±Ñ•È€ô€…±°œì(€€€€€€€€€€€ô•±Í”¥˜€¡…Ñ•½Éä¹¥€ôôô€Í…Ù•‘]½É‘Í1¥ÍÐœ¤ì(€€€€€€€€€€€€€€€Ñ…É•Ñ¥±Ñ•È€ô€Ñ½‘…äœì(€€€€€€€€€€€ô•±Í”¥˜€¡…Ñ•½Éä¹¥€ôôô€±•…É¹•‘]½É‘Í1¥ÍÐœ¤ì(€€€€€€€€€€€€€€€Ñ…É•Ñ¥±Ñ•È€ô€±•…É¹•œì(€€€€€€€€€€€ô((€€€€€€€€€€€€¼¼M•ÐÑ¡”™¥±Ñ•È…¹ÕÁ‘…Ñ”Ñ¡”U$(€€€€€€€€€€€ÕÉÉ•¹Ñ¥±Ñ•È€ôÑ…É•Ñ¥±Ñ•Èì(€€€€€€€€€€€ÕÁ‘…Ñ•Ñ¥Ù•¥±Ñ•ÉQ…ˆ¡ÕÉÉ•¹Ñ¥±Ñ•È¤ì(€€€€€€€€€€€É•…Ñ•]½É‘Í1¥ÍÐ¡…±±]½É‘Ì°ÕÉÉ•¹Ñ¥±Ñ•È¤ì((€€€€€€€€€€€Í¡½ÝQ…ˆ ‰‘¥Ñ¥½¹…ÉåQ…ˆˆ¤ì(€€€€€€€ô¤ì(€€€ô(4(€€€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€¡”¤€ôøì4(€€€€€€€½¹ÍÐ‰ÕÑÑ½¸€ô”¹Ñ…É•Ð¹±½Í•ÍÐ ‰‰ÕÑÑ½¸ˆ¤ì4(4(€€€€€€€¥˜€ …‰ÕÑÑ½¸¤É•ÑÕÉ¸ì4(4(€€€€€€€€¼¼!…¹‘±”™¥±Ñ•ÈÑ…‰Ì4(€€€€€€€¥˜€¡‰ÕÑÑ½¸¹±…ÍÍ1¥ÍÐ¹½¹Ñ…¥¹Ì ™¥±Ñ•ÈµÑ…ˆœ¤¤ì4(€€€€€€€€€€€ÕÉÉ•¹Ñ¥±Ñ•È€ô‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹™¥±Ñ•Èì4(€€€€€€€€€€€ÕÁ‘…Ñ•Ñ¥Ù•¥±Ñ•ÉQ…ˆ¡ÕÉÉ•¹Ñ¥±Ñ•È¤ì4(€€€€€€€€€€€É•…Ñ•]½É‘Í1¥ÍÐ¡…±±]½É‘Ì°ÕÉÉ•¹Ñ¥±Ñ•È¤ì4(€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€ô4(4(€€€€€€€€¼¼!…¹‘±”Ý½É…Ñ¥½¹Ì4(€€€€€€€½¹ÍÐ…Ñ¥½¸€ô‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹‰Ñ¹Õ¹Ñ¥½¸ì4(€€€€€€€¥˜€ ……Ñ¥½¸¤É•ÑÕÉ¸ì4(4(€€€€€€€ÑÉäì(€€€€€€€€€€€¥˜€¡…Ñ¥½¸€ôôô€‰Í¡½ÝMå¹½¹å´ˆ¤ì(€€€€€€€€€€€€€€€½¹ÍÐÝ½É‘%€ô9Õµ‰•È¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹Ý½É‘%¤ì(€€€€€€€€€€€€€€€É•¹‘•É]½É‘•Ñ…¥±Í	å%¡Ý½É‘%¤ì(€€€€€€€€€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰Á±…åAÉ½¹Õ¹¥…Ñ¥½¸ˆ¤ì(€€€€€€€€€€€€€€€Á±…å]½É‘AÉ½¹Õ¹¥…Ñ¥½¸¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹Ý½É‘%¤ì(€€€€€€€€€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰µ…É­Í1•…É¹•ˆ¤ì(€€€€€€€€€€€€€€€…Ý…¥Ðµ…É­]½É‘Í1•…É¹•¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹Ý½É‘%¤ì(€€€€€€€€€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰µ…É­ÍU¹±•…É¹•ˆ¤ì(€€€€€€€€€€€€€€€…Ý…¥Ðµ…É­]½É‘ÍU¹±•…É¹•¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹Ý½É‘%¤ì(€€€€€€€€€€€ô•±Í”¥˜€¡…Ñ¥½¸€ôôô€‰‘•±•Ñ•]½Éˆ¤ì(€€€€€€€€€€€€€€€…Ý…¥Ð‘•±•Ñ•]½É‘É½µMÑ½É…”¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹Ý½É‘%¤ì(€€€€€€€€€€€ô(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€½¹Í½±”¹•ÉÉ½È¡]½É…Ñ¥½¸€‘í…Ñ¥½¹ô™…¥±•é€°•ÉÉ½È¤ì(€€€€€€€€€€€Í¡½Ý9½Ñ¥™¥…Ñ¥½¸¡•ÉÉ½Èü¹µ•ÍÍ…”ñð€‰Q¡”Ý½É…Ñ¥½¸™…¥±•¸ˆ¤ì(€€€€€€€ô(€€€ô¤ì4(4(€€€•¹…‰±•áÑ•¹Í¥½¹¡•­‰½à¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¡…¹”ˆ°Ñ½±•áÑ•¹Í¥½¹MÑ…Ñ”¤ì4(4(€€€Í¥Ñ•%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕÐˆ°€ ¤€ôøÑ½±•	ÕÑÑ½¸¡…‘‘M¥Ñ•	ÕÑÑ½¸°Í¥Ñ•%¹ÁÕÐ¤¤ì4(€€€…‘‘M¥Ñ•	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…‘‘M¥Ñ•Q½á±ÕÍ¥½¸¤ì4(4(€€€•á±ÕÍ¥½¹1¥ÍÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€¡”¤€ôøÉ•µ½Ù•M¥Ñ•É½µá±ÕÍ¥½¸¡”¤¤ì4(4(€€€€¼¼‘‘•™•¹Í¥Ù”¡•¬™½È¡É½µ”A$…Ù…¥±…‰¥±¥Ñä4(€€€¥˜€¡¡É½µ”¹ÉÕ¹Ñ¥µ”€˜˜¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”€˜˜¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È¤ì4(€€€€€€€¡É½µ”¹ÉÕ¹Ñ¥µ”¹½¹5•ÍÍ…”¹…‘‘1¥ÍÑ•¹•È ¡É•ÅÕ•ÍÐ¤€ôøì4(€€€€€€€¥˜€¡É•ÅÕ•ÍÐ¹…Ñ¥½¸€ôôô€‰Ý½É‘Í¡…¹•ˆ¤ì4(€€€€€€€€€€€½¹Í½±”¹±½œ ‰Ý½É‘ÌÝ•É”¡…¹•è€ˆ°É•ÅÕ•ÍÐ¹¹•ÝY…±Õ”¤ì4(4(€€€€€€€€€€€½¹ÍÐ½À€ôÉ•ÅÕ•ÍÐ¹¹•ÝY…±Õ”¹½Á•É…Ñ¥½¸ì4(€€€€€€€€€€€¥˜€¡½À€ôôô€‰•Ñ±±]½É‘Ìˆ¤ì4(€€€€€€€€€€€€€€€‘¥ÍÁ±…å¥Ñ¥½¹…Éä ¤¹…Ñ ¡½¹Í½±”¹•ÉÉ½È¤ì4(€€€€€€€€€€€ô•±Í”¥˜€¡½À€ôôô€‰‘•±•Ñ”ˆñð½À€ôôô€‰‘•±•Ñ•]½Éˆ¤ì(€€€€€€€€€€€€€€€‘•±•Ñ•]½É‘É½µA½ÁÕÁ¥Ñ¥½¹…Éä¡É•ÅÕ•ÍÐ¹¹•ÝY…±Õ”¹Ý½É‘%¤ì4(€€€€€€€€€€€€€€€€¼¼É•™É•Í ½Õ¹Ñ•ÉÌ…™Ñ•È‘•±•Ñ”4(€€€€€€€€€€€€€€€‘¥ÍÁ±…å¥Ñ¥½¹…Éä ¤¹…Ñ ¡½¹Í½±”¹•ÉÉ½È¤ì4(€€€€€€€€€€€ô•±Í”¥˜€¡½À€ôôô€‰…‘ˆñð½À€ôôô€‰ÕÁ‘…Ñ”ˆñð½À€ôôô€‰É•±½…ˆ¤ì4(€€€€€€€€€€€€€€€€¼¼Í¥µÁ±”É•™É•Í Ñ¼­••À±¥ÍÐ…¹½Õ¹Ñ•ÉÌ¥¸Íå¹Œ4(€€€€€€€€€€€€€€€‘¥ÍÁ±…å¥Ñ¥½¹…Éä ¤¹…Ñ ¡½¹Í½±”¹•ÉÉ½È¤ì4(€€€€€€€€€€€ô4(€€€€€€€ô4(€€€€€€€ô¤ì4(€€€ô4(4(€€€±½Í•9½Ñ¥™¥…Ñ¥½¹	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°±½Í•9½Ñ¥™¥…Ñ¥½¸¤ì4(4(€€€¡…¹•Q•±•É…µ	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÑ½±•Y¥Í¥‰¥±¥Ñä¡Ñ•±•É…µ½¹Ñ…¥¹•È¤¤ì4(€€€½Á•¹¹±¥Í¡1•Ù•±	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÑ½±•Y¥Í¥‰¥±¥Ñä¡•¹±¥Í¡1•Ù•±½¹Ñ…¥¹•È¤¤ì4(€€€½Á•¹1•…É¹¥¹½…±Í	Ñ¹	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøÑ½±•Y¥Í¥‰¥±¥Ñä¡±•…É¹¥¹½…±Í½¹Ñ…¥¹•È¤¤ì4(4(€€€Ñ•±•É…µ9…µ”¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕÐˆ°€ ¤€ôøÑ½±•	ÕÑÑ½¸¡Ñ•±•É…µ	ÕÑÑ½¸°Ñ•±•É…µ9…µ”¤¤ì4(€€€Ñ•±•É…µ	ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°€ ¤€ôøì(€€€€€€€ÕÁ‘…Ñ•Q•±•É…´ ¤¹…Ñ ¡½¹Í½±”¹•ÉÉ½È¤ì(€€€ô¤ì(4(€€€€¼½Ñ½­•¸Ù•É¥™¥…Ñ¥½¸4(€€€€¼¼¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡l‰Ñ½­•¸‰t°€¡É•ÍÕ±Ð¤€ôøì4(€€€€¼¼€€€€½¹Í½±”¹±½œ¡É•ÍÕ±Ð¤ì4(€€€€¼¼€€€€¥˜€¡¥ÍQ½­•¹Y…±¥¡É•ÍÕ±Ð¹Ñ½­•¸¤¤ì4(€€€€¼¼€€€€€€€€€¼¼Q½­•¸•á¥ÍÑÌ°¹½ÜÙ…±¥‘…Ñ”¥Ð4(€€€€¼¼€€€€€€€€½¹Í½±”¹±½œ ‰Q¡”Ñ½­•¸¥ÌÙ…±¥ˆ¤ì4(€€€€¼¼€€€€€€€€Í¡½Ý5…¥¹½¹Ñ•¹Ð ¤ì4(€€€€¼¼€€€€ô•±Í”ì4(€€€€¼¼€€€€€€€€½¹Í½±”¹±½œ ‰Q¡”Ñ½­•¸¥Ì¥¹Ù…±¥ˆ¤ì4(€€€€¼¼€€€€€€€€Í¡½Ý1½¥¹A…” ¤ì4(€€€€¼¼€€€€ô4(€€€€¼¼ô¤ì4(4(€€€€¼¼ÕÑ¡•¹Ñ¥…Ñ”™¥ÉÍÐ°Ñ¡•¸…Ñ”½¹‰½…É‘¥¹œ™½È…ÕÑ¡•¹Ñ¥…Ñ•ÕÍ•ÉÌ4(€€€½¹ÍÐ•¹ÍÕÉ•ÕÑ¡•¹Ñ¥…Ñ•€ô…Íå¹Œ€ ¤€ôøì4(€€€€€€€½¹ÍÐÕÉÉ•¹ÑUÍ•È€ô…Ý…¥Ð•ÑUÍ•É%¹™¼ ¤ì4(€€€€€€€¥˜€¡ÕÉÉ•¹ÑUÍ•È¤É•ÑÕÉ¸ÑÉÕ”ì4(€€€€€€€É•ÑÕÉ¸¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøì4(€€€€€€€€€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡l‰Ñ½­•¸‰t°€¡É•ÍÕ±Ð¤€ôøì4(€€€€€€€€€€€€€€€¥˜€¡¥ÍQ½­•¹Y…±¥¡É•ÍÕ±Ð¹Ñ½­•¸¤¤ì4(€€€€€€€€€€€€€€€€€€€É•Í½±Ù”¡ÑÉÕ”¤ì4(€€€€€€€€€€€€€€€ô•±Í”ì4(€€€€€€€€€€€€€€€€€€€É•Í½±Ù”¡™…±Í”¤ì4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€ô¤ì4(€€€€€€€ô¤ì4(€€€ôì4(4(€€€½¹ÍÐ¥ÍÕÑ¡•€ô…Ý…¥Ð•¹ÍÕÉ•ÕÑ¡•¹Ñ¥…Ñ• ¤ì4(€€€¥˜€ …¥ÍÕÑ¡•¤ì4(€€€€€€€€¼¼9½Ð±½•¥¸èÍ¡½Ü±½¥¸Á…”°‘¼9=P½Á•¸½¹‰½…É‘¥¹œå•Ð4(€€€€€€€Í¡½Ý1½¥¹A…” ¤ì4(€€€€€€€É•ÑÕÉ¸ì4(€€€ô4(4(€€€€¼¼1½•¥¸è¡•¬¥˜½¹‰½…É‘¥¹œ¥Ì½µÁ±•Ñ•ì¥˜¹½Ð°½¹±äÍ¡½Ü½¹”…™Ñ•È±½¥¸4(€€€½¹ÍÐ¡•­=¹‰½…É‘¥¹½µÁ±•Ñ¥½¸€ô…Íå¹Œ€ ¤€ôøì4(€€€€€€€½¹ÍÐÍÑ…Ñ”€ô…Ý…¥Ð¹•ÜAÉ½µ¥Í”¡É•Í½±Ù”€ôøì4(€€€€€€€€€€€¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡ì4(€€€€€€€€€€€€€€€½¹‰½…É‘¥¹½µÁ±•Ñ•è™…±Í”°4(€€€€€€€€€€€€€€€½¹‰½…É‘¥¹M¡½Ý¹™Ñ•É1½¥¸è™…±Í”4(€€€€€€€€€€€ô°É•Í½±Ù”¤ì4(€€€€€€€ô¤ì4(4(€€€€€€€¥˜€¡ÍÑ…Ñ”¹½¹‰½…É‘¥¹½µÁ±•Ñ•¤É•ÑÕÉ¸ÑÉÕ”ì4(4(€€€€€€€€¼¼M¡½Ü½¹‰½…É‘¥¹œ½¹±ä½¹”…™Ñ•È±½¥¸ì‘½¸Ð¹…œ¹•áÐÑ¥µ”4(€€€€€€€¥˜€ …ÍÑ…Ñ”¹½¹‰½…É‘¥¹M¡½Ý¹™Ñ•É1½¥¸¤ì4(€€€€€€€€€€€…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹Í•Ð¡ì½¹‰½…É‘¥¹M¡½Ý¹™Ñ•É1½¥¸èÑÉÕ”ô¤ì4(€€€€€€€€€€€¡É½µ”¹ÉÕ¹Ñ¥µ”¹Í•¹‘5•ÍÍ…”¡ì…Ñ¥½¸è€¹••‘=¹‰½…É‘¥¹œœô¤ì4(€€€€€€€€€€€Ý¥¹‘½Ü¹±½Í” ¤ì4(€€€€€€€€€€€É•ÑÕÉ¸™…±Í”ì4(€€€€€€€ô4(4(€€€€€€€€¼¼±É•…‘äÍ¡½Ý¸½¹”ìÍ­¥ÀÉ•‘¥É•Ð…¹½¹Ñ¥¹Õ”Ñ¼µ…¥¸½¹Ñ•¹Ð4(€€€€€€€É•ÑÕÉ¸ÑÉÕ”ì4(€€€ôì4(4(€€€½¹ÍÐ½¹‰½…É‘¥¹½µÁ±•Ñ•€ô…Ý…¥Ð¡•­=¹‰½…É‘¥¹½µÁ±•Ñ¥½¸ ¤ì4(€€€¥˜€ …½¹‰½…É‘¥¹½µÁ±•Ñ•¤É•ÑÕÉ¸ì4(4(€€€€¼¼ÕÑ¡•¹Ñ¥…Ñ•…¹½¹‰½…É‘¥¹œ½µÁ±•Ñ•èÍ¡½Üµ…¥¸½¹Ñ•¹Ð4(€€€Í¡½Ý5…¥¹½¹Ñ•¹Ð ¤ì4(€€€€4(€€€€¼¼%¹¥Ñ¥…±¥é”•áÑ•¹Í¥½¸ÍÑ…Ñ”…™Ñ•È…ÕÑ¡•¹Ñ¥…Ñ¥½¸4(€€€•á±Õ‘•‘M¥Ñ•Ì€ô…Ý…¥Ð•Ñá±Õ‘•‘M¥Ñ•Ì ¤ì4(€€€ÕÉÉ•¹ÑM¥Ñ”€ô…Ý…¥Ð•ÑÕÉÉ•¹ÑM¥Ñ” ¤ì4(€€€¥Í¹…‰±•€ô¡•­%™ÕÉÉ•¹ÑM¥Ñ•¹…‰±• ¤ì4(€€€•¹…‰±•áÑ•¹Í¥½¹¡•­‰½à¹¡•­•€ô¥Í¹…‰±•ì4(€€€Í¡½ÝQ…ˆ ‰¡½µ•Q…ˆˆ¤ì4(€€€‘¥ÍÁ±…åá±ÕÍ¥½¹1¥ÍÐ¡•á±Õ‘•‘M¥Ñ•Ì¤ì4(€€€…Ý…¥Ð‘¥ÍÁ±…å¥Ñ¥½¹…Éä ¤ì4(€€€€4(€€€€¼¼%¹¥Ñ¥…±¥é”ÍÕ‰ÍÉ¥ÁÑ¥½¸‘¥ÍÁ±…ä4(€€€…Ý…¥ÐÕÁ‘…Ñ•MÕ‰ÍÉ¥ÁÑ¥½¹¥ÍÁ±…ä ¤ì4)ô¤ì4(4(¼¼‘9•Ü]½É™É½´!½µ”4)™Õ¹Ñ¥½¸Ñ½±•‘‘	ÕÑÑ½¸ ¤ì4(€€€¥˜€ ……‘‘]½É‘	Ñ¸ñð€……‘‘]½É‘%¹ÁÕÐ¤É•ÑÕÉ¸ì4(€€€½¹ÍÐ¡…ÍQ•áÐ€ô…‘‘]½É‘%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤¹±•¹Ñ €ø€Àì4(€€€…‘‘]½É‘	Ñ¸¹‘¥Í…‰±•€ô€…¡…ÍQ•áÐì4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸…‘‘9•Ý]½É‘É½µA½ÁÕÀ ¤ì4(€€€ÑÉäì4(€€€€€€€¥˜€ ……‘‘]½É‘%¹ÁÕÐ¤É•ÑÕÉ¸ì4(€€€€€€€½¹ÍÐÉ…Ü€ô…‘‘]½É‘%¹ÁÕÐ¹Ù…±Õ”¹ÑÉ¥´ ¤ì4(€€€€€€€¥˜€ …É…Ü¤É•ÑÕÉ¸ì4(€€€€€€€½¹ÍÐÝ½É‘1½Ý•È€ôÉ…Ü¹Ñ½1½Ý•É…Í” ¤ì4(4(€€€€€€€€¼¼¡•¬ÍÕ‰ÍÉ¥ÁÑ¥½¸±¥µ¥ÑÌ‰•™½É”…‘‘¥¹œ4(€€€€€€€¥˜€¡Ý¥¹‘½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹5…¹…•È¤ì4(€€€€€€€€€€€½¹ÍÐ±¥µ¥Ñ¡•¬€ô…Ý…¥ÐÝ¥¹‘½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹5…¹…•È¹…¹‘‘]½É ¤ì4(€€€€€€€€€€€¥˜€ …±¥µ¥Ñ¡•¬¹…¹‘¤ì4(€€€€€€€€€€€€€€€¥˜€¡±¥µ¥Ñ¡•¬¹É•…Í½¸€ôôô€‘…¥±å}±¥µ¥Ñ}É•…¡•œ¤ì4(€€€€€€€€€€€€€€€€€€€Í¡½Ý9½Ñ¥™¥…Ñ¥½¸ …¥±äÝ½É±¥µ¥ÐÉ•…¡•¸UÁÉ…‘”Ñ¼AÉ•µ¥Õ´™½ÈÕ¹±¥µ¥Ñ•Ý½É‘Ì¸œ¤ì4(€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€ô4(€€€€€€€ô4(4(€€€€€€€€¼¼•ÐÑ…É•Ð±…¹Õ…”4(€€€€€€€½¹ÍÐìÑÉ…¹Í±…Ñ•Q¼ô€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÑÉ…¹Í±…Ñ•Q¼t¤ì4(€€€€€€€½¹ÍÐÑ…É•Ñ1…¹Õ…”€ô€¡ÑÉ…¹Í±…Ñ•Q¼ñð€Õ¬œ¤ì4(4(€€€€€€€€¼¼Í¬‰…­É½Õ¹Ñ¼ÑÉ…¹Í±…Ñ”€¡…±Í¼É•ÑÕÉ¹ÌÍå¹½¹åµÌ½•á…µÁ±•Ì¤4(€€€€€€€½¹ÍÐÉ•ÍÀ€ô…Ý…¥Ð¡É½µ”¹ÉÕ¹Ñ¥µ”¹Í•¹‘5•ÍÍ…”¡ì4(€€€€€€€€€€€…Ñ¥½¸è€ÑÉ…¹Í±…Ñ•]½Éœ°4(€€€€€€€€€€€Ý½ÉèÝ½É‘1½Ý•È°4(€€€€€€€€€€€Ñ…É•Ñ1…¹Õ…”4(€€€€€€€ô¤ì4(4(€€€€€€€¥˜€ …É•ÍÀü¹ÍÕ•ÍÌñð€…É•ÍÀü¹É•ÍÕ±Ðü¹ÑÉ…¹Í±…Ñ¥½¸¤ì(€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÀü¹•ÉÉ½Èü¹µ•ÍÍ…”ñð€‰QÉ…¹Í±…Ñ¥½¸™…¥±•¸A±•…Í”ÑÉä……¥¸¸ˆ¤ì(€€€€€€€ô(€€€€€€€½¹ÍÐÑÈ€ôÉ•ÍÀ¹É•ÍÕ±Ðì(€€€€€€€½¹ÍÐÑÉ…¹Í±…Ñ¥½¸€ôMÑÉ¥¹œ¡ÑÈ¹ÑÉ…¹Í±…Ñ¥½¸¤¹ÑÉ¥´ ¤ì(€€€€€€€½¹ÍÐÍå¹½¹åµÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡ÑÈ¹Íå¹½¹åµÌ¤€üÑÈ¹Íå¹½¹åµÌ€èmtì4(€€€€€€€½¹ÍÐ•á…µÁ±•Ì€ôÉÉ…ä¹¥ÍÉÉ…ä¡ÑÈ¹•á…µÁ±•Ì¤€üÑÈ¹•á…µÁ±•Ì€èmtì4(4(€€€€€€€€¼¼1½…ÕÉÉ•¹ÐÝ½É‘Ì…¹•¹ÍÕÉ”Õ¹¥ÅÕ”¥4(€€€€€€€½¹ÍÐìÝ½É‘Ì€ômtô€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÝ½É‘Ìt¤ì4(€€€€€€€±•Ð¹•Ý%€ô…Ñ”¹¹½Ü ¤ì4(€€€€€€€½¹ÍÐ¥‘Ì€ô¹•ÜM•Ð ¡Ý½É‘Ìñðmt¤¹µ…À¡Ü€ôø9Õµ‰•È¡Ü¹¥¤¤¤ì4(€€€€€€€Ý¡¥±”€¡¥‘Ì¹¡…Ì¡¹•Ý%¤¤¹•Ý%€¬ô€Äì4(4(€€€€€€€½¹ÍÐ¹•Ý]½É€ôì4(€€€€€€€€€€€¥è¹•Ý%°4(€€€€€€€€€€€Ý½ÉèÝ½É‘1½Ý•È°4(€€€€€€€€€€€ÑÉ…¹Í±…Ñ¥½¸°4(€€€€€€€€€€€‘…Ñ•‘‘•è…Ñ”¹¹½Ü ¤°4(€€€€€€€€€€€ÍÑ…ÑÕÌè€¹•Üœ°(€€€€€€€€€€€±•…É¹•è™…±Í”°(€€€€€€€€€€€•¹½Õ¹Ñ•É½Õ¹Ðè€À°(€€€€€€€€€€€Íå¹½¹åµÌ°(€€€€€€€€€€€•á…µÁ±•Ì(€€€€€€€ôì((€€€€€€€…Ý…¥ÐÁ•ÉÍ¥ÍÑ]½É¡¹•Ý]½É¤ì(€€€€€€€…Ý…¥ÐÕÁ‘…Ñ•MÕ‰ÍÉ¥ÁÑ¥½¹¥ÍÁ±…ä ¤ì€¼¼UÁ‘…Ñ”ÍÕ‰ÍÉ¥ÁÑ¥½¸‘¥ÍÁ±…ä…™Ñ•È…‘‘¥¹œÝ½É(4(€€€€€€€…‘‘]½É‘%¹ÁÕÐ¹Ù…±Õ”€ô€œœì4(€€€€€€€Ñ½±•‘‘	ÕÑÑ½¸ ¤ì4(€€€€€€€Í¡½Ý9½Ñ¥™¥…Ñ¥½¸ ]½É…‘‘•ÍÕ•ÍÍ™Õ±±äœ¤ì4(€€€ô…Ñ €¡”¤ì(€€€€€€€½¹Í½±”¹•ÉÉ½È ‘¹•ÜÝ½É™…¥±•èœ°”¤ì(€€€€€€€Í¡½Ý9½Ñ¥™¥…Ñ¥½¸¡”ü¹µ•ÍÍ…”ñð€…¥±•Ñ¼…‘Ý½Éœ¤ì(€€€ô4)ô4(4)¥˜€¡…‘‘]½É‘%¹ÁÕÐ¤ì4(€€€…‘‘]½É‘%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°Ñ½±•‘‘	ÕÑÑ½¸¤ì4(€€€…‘‘]½É‘%¹ÁÕÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°€¡”¤€ôøì4(€€€€€€€¥˜€¡”¹­•ä€ôôô€¹Ñ•Èœ€˜˜€……‘‘]½É‘	Ñ¸¹‘¥Í…‰±•¤ì4(€€€€€€€€€€€…‘‘9•Ý]½É‘É½µA½ÁÕÀ ¤ì4(€€€€€€€ô4(€€€ô¤ì4)ô4)¥˜€¡…‘‘]½É‘	Ñ¸¤ì4(€€€…‘‘]½É‘	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°…‘‘9•Ý]½É‘É½µA½ÁÕÀ¤ì4)ô4(4(¼¼UÁÉ…‘”‰ÕÑÑ½¸•Ù•¹Ð±¥ÍÑ•¹•È4)¥˜€¡ÕÁÉ…‘•	Ñ¸¤ì4(€€€ÕÁÉ…‘•	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøì4(€€€€€€€€¼¼=Á•¸ÁÉ¥¥¹œÁ…”4(€€€€€€€¡É½µ”¹Ñ…‰Ì¹É•…Ñ”¡ìÕÉ°è€¡ÑÑÁÌè¼½±…éå±•à¹½´¼Œ½ÁÉ¥¥¹œœô¤ì4(€€€ô¤ì4)ô4(4(¼¼€´´´´]½É‘•Ñ…¥±ÌMAÉ•¹‘•É¥¹œ€´´´´4)™Õ¹Ñ¥½¸Í¡½ÝM•Ñ¥½¸¡Í•Ñ¥½¹%¤ì4(€€€½¹ÍÐ½¹Ñ•¹ÑÌ€ô‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° œ¹Ñ…ˆµ½¹Ñ•¹Ðœ¤ì4(€€€½¹Ñ•¹ÑÌ¹™½É… ¡Œ€ôøŒ¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€¹½¹”œ¤ì4(€€€½¹ÍÐÑ…É•Ð€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å%¡Í•Ñ¥½¹%¤ì4(€€€¥˜€¡Ñ…É•Ð¤Ñ…É•Ð¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€™±•àœì4)ô4(4)…Íå¹Œ™Õ¹Ñ¥½¸É•¹‘•É]½É‘•Ñ…¥±Í	å%¡Ý½É‘%¤ì4(€€€ÑÉäì4(€€€€€€€½¹ÍÐìÝ½É‘Ì€ômtô€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÝ½É‘Ìt¤ì4(€€€€€€€½¹ÍÐ™½Õ¹€ôÝ½É‘Ì¹™¥¹¡Ü€ôø9Õµ‰•È¡Ü¹¥¤€ôôô9Õµ‰•È¡Ý½É‘%¤¤ì4(€€€€€€€¥˜€ …™½Õ¹¤É•ÑÕÉ¸ì4(4(€€€€€€€½¹ÍÐÑ¥Ñ±•°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘•Ñ…¥±ÍQ¥Ñ±”œ¤ì4(€€€€€€€½¹ÍÐÑÉ°€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘•Ñ…¥±ÍQÉ…¹Í±…Ñ¥½¸œ¤ì4(€€€€€€€½¹ÍÐÍå¹1¥ÍÐ€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘•Ñ…¥±ÍMå¹½¹åµÌœ¤ì4(€€€€€€€½¹ÍÐÍå¹µÁÑä€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘•Ñ…¥±ÍMå¹½¹åµÍµÁÑäœ¤ì4(€€€€€€€½¹ÍÐ•á1¥ÍÐ€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‘•Ñ…¥±Íá…µÁ±•Ìœ¤ì4(4(€€€€€€€Ñ¥Ñ±•°¹Ñ•áÑ½¹Ñ•¹Ð€ô™½Õ¹¹Ý½Éñð€]½Éœì4(€€€€€€€ÑÉ°¹Ñ•áÑ½¹Ñ•¹Ð€ô™½Õ¹¹ÑÉ…¹Í±…Ñ¥½¸ñð€œœì4(4(€€€€€€€€¼¼Må¹½¹åµÌ4(€€€€€€€Íå¹1¥ÍÐ¹É•Á±…•¡¥±‘É•¸ ¤ì(€€€€€€€½¹ÍÐÍå¹½¹åµÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡™½Õ¹¹Íå¹½¹åµÌ¤€ü™½Õ¹¹Íå¹½¹åµÌ€èmtì4(€€€€€€€¥˜€¡Íå¹½¹åµÌ¹±•¹Ñ €ôôô€À¤ì4(€€€€€€€€€€€Íå¹µÁÑä¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€‰±½¬œì4(€€€€€€€ô•±Í”ì4(€€€€€€€€€€€Íå¹µÁÑä¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€¹½¹”œì4(€€€€€€€€€€€Íå¹½¹åµÌ¹™½É… ¡Ì€ôøì4(€€€€€€€€€€€€€€€½¹ÍÐ±¤€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±¤œ¤ì4(€€€€€€€€€€€€€€€±¤¹±…ÍÍ9…µ”€ô€Íå¹½¹å´µ¥Ñ•´œì4(€€€€€€€€€€€€€€€±¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘íÌü¹Í½ÕÉ”ñð€œôƒŠL€‘íÌü¹ÑÉ…¹Í±…Ñ¥½¸ñð€œõ€ì4(€€€€€€€€€€€€€€€Íå¹1¥ÍÐ¹…ÁÁ•¹‘¡¥±¡±¤¤ì4(€€€€€€€€€€€ô¤ì4(€€€€€€€ô4(4(€€€€€€€€¼¼á…µÁ±•ÌèÁÉ•™•ÈÍÑ½É•ì¥˜•µÁÑä°™•Ñ ™É½´‰…­•¹½¹”…¹Á•ÉÍ¥ÍÐ4(€€€€€€€•á1¥ÍÐ¹É•Á±…•¡¥±‘É•¸ ¤ì(€€€€€€€±•Ð•á…µÁ±•Ì€ôÉÉ…ä¹¥ÍÉÉ…ä¡™½Õ¹¹•á…µÁ±•Ì¤€˜˜™½Õ¹¹•á…µÁ±•Ì¹±•¹Ñ €ø€À€ü™½Õ¹¹•á…µÁ±•Ì€èmtì4(4(€€€€€€€¥˜€¡•á…µÁ±•Ì¹±•¹Ñ €ôôô€À¤ì4(€€€€€€€€€€€ÑÉäì4(€€€€€€€€€€€€€€€½¹ÍÐìÑÉ…¹Í±…Ñ•Q¼ô€ô…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹•Ð¡lÑÉ…¹Í±…Ñ•Q¼t¤ì4(€€€€€€€€€€€€€€€½¹ÍÐÑ…É•Ñ1…¹Õ…”€ô€¡ÑÉ…¹Í±…Ñ•Q¼ñð€Õ¬œ¤ì4(€€€€€€€€€€€€€€€½¹ÍÐÉ•ÍÀ€ô…Ý…¥Ð¡É½µ”¹ÉÕ¹Ñ¥µ”¹Í•¹‘5•ÍÍ…”¡ì4(€€€€€€€€€€€€€€€€€€€…Ñ¥½¸è€ÑÉ…¹Í±…Ñ•]½Éœ°4(€€€€€€€€€€€€€€€€€€€Ý½Éè™½Õ¹¹Ý½É°4(€€€€€€€€€€€€€€€€€€€Ñ…É•Ñ1…¹Õ…”4(€€€€€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€€€€€¥˜€¡É•ÍÀ€˜˜É•ÍÀ¹ÍÕ•ÍÌ€˜˜É•ÍÀ¹É•ÍÕ±Ð¤ì4(€€€€€€€€€€€€€€€€€€€½¹ÍÐÑÈ€ôÉ•ÍÀ¹É•ÍÕ±Ðì4(€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•Ýá…µÁ±•Ì€ôÉÉ…ä¹¥ÍÉÉ…ä¡ÑÈ¹•á…µÁ±•Ì¤€üÑÈ¹•á…µÁ±•Ì¹Í±¥” À°€Ô¤€èmtì4(€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•ÝMå¹½¹åµÌ€ôÉÉ…ä¹¥ÍÉÉ…ä¡ÑÈ¹Íå¹½¹åµÌ¤€üÑÈ¹Íå¹½¹åµÌ¹Í±¥” À°€à¤€èmtì4(€€€€€€€€€€€€€€€€€€€¥˜€¡¹•Ýá…µÁ±•Ì¹±•¹Ñ €ø€Àñð¹•ÝMå¹½¹åµÌ¹±•¹Ñ €ø€À¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€¼¼A•ÉÍ¥ÍÐ‰…¬Ñ¼ÍÑ½É…”™½ÈÑ¡¥ÌÝ½É4(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÕÁ‘…Ñ•€ô€¡Ý½É‘Ìñðmt¤¹µ…À¡Ü€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡9Õµ‰•È¡Ü¹¥¤€ôôô9Õµ‰•È¡Ý½É‘%¤¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¸¸¹Ü°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€•á…µÁ±•Ìè¹•Ýá…µÁ±•Ì¹±•¹Ñ €ø€À€ü¹•Ýá…µÁ±•Ì€èÜ¹•á…µÁ±•Ì°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Íå¹½¹åµÌè¹•ÝMå¹½¹åµÌ¹±•¹Ñ €ø€À€ü¹•ÝMå¹½¹åµÌ€èÜ¹Íå¹½¹åµÌ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ôì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸Üì4(€€€€€€€€€€€€€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€€€€€€€€€€€€€…Ý…¥Ð¡É½µ”¹ÍÑ½É…”¹±½…°¹Í•Ð¡ìÝ½É‘ÌèÕÁ‘…Ñ•ô¤ì4(€€€€€€€€€€€€€€€€€€€€€€€•á…µÁ±•Ì€ô¹•Ýá…µÁ±•Ì¹±•¹Ñ €ø€À€ü¹•Ýá…µÁ±•Ì€è•á…µÁ±•Ìì4(4(€€€€€€€€€€€€€€€€€€€€€€€€¼¼%˜Íå¹½¹åµÌÝ•É”•µÁÑä‰•™½É”°É•¹‘•ÈÑ¡•´¹½Ü4(€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡Íå¹½¹åµÌ¹±•¹Ñ €ôôô€À€˜˜¹•ÝMå¹½¹åµÌ¹±•¹Ñ €ø€À¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€Íå¹µÁÑä¹ÍÑå±”¹‘¥ÍÁ±…ä€ô€¹½¹”œì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¹•ÝMå¹½¹åµÌ¹™½É… ¡Ì€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ±¤€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±¤œ¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±¤¹±…ÍÍ9…µ”€ô€Íå¹½¹å´µ¥Ñ•´œì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±¤¹Ñ•áÑ½¹Ñ•¹Ð€ô€‘íÌü¹Í½ÕÉ”ñð€œôƒŠL€‘íÌü¹ÑÉ…¹Í±…Ñ¥½¸ñð€œõ€ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Íå¹1¥ÍÐ¹…ÁÁ•¹‘¡¥±¡±¤¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ì4(€€€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€ô…Ñ €¡”¤ì4(€€€€€€€€€€€€€€€½¹Í½±”¹Ý…É¸ =¸µ‘•µ…¹•á…µÁ±•Ì™•Ñ ™…¥±•èœ°”ü¹µ•ÍÍ…”ñð”¤ì4(€€€€€€€€€€€ô4(€€€€€€€ô4(4(€€€€€€€€¼¼¥¹…°É•¹‘•È™½È•á…µÁ±•Ì€¡™…±±‰…¬Ñ¼±½…°Á±…•¡½±‘•ÉÌ¥˜ÍÑ¥±°•µÁÑä¤4(€€€€€€€½¹ÍÐÑ½I•¹‘•È€ô•á…µÁ±•Ì¹±•¹Ñ €ø€À4(€€€€€€€€€€€€ü•á…µÁ±•Ì4(€€€€€€€€€€€€èl4(€€€€€€€€€€€€€€€Q¡¥Ì¥Ì„Í…µÁ±”Í•¹Ñ•¹”ÕÍ¥¹œ€ˆ‘í™½Õ¹¹Ý½É‘ôˆ¥¸½¹Ñ•áÐÑ¼‘•µ½¹ÍÑÉ…Ñ”ÕÍ…”…¹µ•…¹¥¹œ¹€°4(€€€€€€€€€€€€€€€¹½Ñ¡•È•á…µÁ±”™½È€ˆ‘í™½Õ¹¹Ý½É‘ôˆÑ¡…ÐÍ¡½ÝÌ¡½Ü¥Ðµ…ä…ÁÁ•…È¥¸„Á…É…É…Á ¹€°4(€€€€€€€€€€€€€€€Ñ¡¥ÉÁ±…•¡½±‘•ÈÍ•¹Ñ•¹”Ý¥Ñ €ˆ‘í™½Õ¹¹Ý½É‘ôˆ™½È™ÕÑÕÉ”A$µ•¹•É…Ñ••á…µÁ±•Ì¹€4(€€€€€€€€€€€€€tì4(€€€€€€€Ñ½I•¹‘•È¹™½É… ¡Ð€ôøì4(€€€€€€€€€€€½¹ÍÐ±¤€ô‘½Õµ•¹Ð¹É•…Ñ•±•µ•¹Ð ±¤œ¤ì4(€€€€€€€€€€€±¤¹Ñ•áÑ½¹Ñ•¹Ð€ôÐì4(€€€€€€€€€€€•á1¥ÍÐ¹…ÁÁ•¹‘¡¥±¡±¤¤ì4(€€€€€€€ô¤ì4(4(€€€€€€€Í¡½ÝM•Ñ¥½¸ Ý½É‘•Ñ…¥±Í½¹Ñ•¹Ðœ¤ì4(4(€€€€€€€½¹ÍÐ‰…­	Ñ¸€ô‘½Õµ•¹Ð¹•Ñ±•µ•¹Ñ	å% ‰…­Q½¥Ñ¥½¹…Éå	Ñ¸œ¤ì4(€€€€€€€¥˜€¡‰…­	Ñ¸€˜˜€…‰…­	Ñ¸¹}¡…¹‘±•ÉÑÑ…¡•¤ì4(€€€€€€€€€€€‰…­	Ñ¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€ ¤€ôøÍ¡½ÝQ…ˆ ‘¥Ñ¥½¹…ÉåQ…ˆœ¤¤ì4(€€€€€€€€€€€‰…­	Ñ¸¹}¡…¹‘±•ÉÑÑ…¡•€ôÑÉÕ”ì4(€€€€€€€ô4(€€€ô…Ñ €¡”¤ì4(€€€€€€€½¹Í½±”¹•ÉÉ½È É•¹‘•É]½É‘•Ñ…¥±Í	å%™…¥±•èœ°”¤ì4(€€€ô4)ô4(4(¼¼¹½˜Á½ÁÕÀ¹©Ìµ…¥¸½‘”4)ô¤ ¤ì€¼¼¹½˜%%ÝÉ…ÁÁ•È4