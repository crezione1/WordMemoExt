// document.getElementById('saveButton').addEventListener('click', function() {
//     const word = document.getElementById('wordInput').value;
//     if (word) {
//         // Save the word to the backend or local storage.
//         // For this prototype, we'll just display a message.
//         document.getElementById('status').textContent = `Saved: ${word}`;
//     }
// });

document.addEventListener('DOMContentLoaded', async function () {
    console.log('login started');
    const telegramName = document.getElementById('telegramName');
    const loginButton = document.getElementById('loginBtn');

    function toggleSubmitButton() {
        loginButton.disabled = telegramName.value.trim() === '';
        loginButton.style.pointerEvents = loginButton.disabled
            ? 'none'
            : 'auto'; // Disable/enable pointer events
    }

    toggleSubmitButton();

    loginButton.addEventListener('click', function () {
        chrome.runtime.sendMessage({
            message: 'login',
            arguments: [telegramName.value],
        });
        console.log(chrome.runtime);
        console.log(chrome.runtime.sendMessage);
        console.log('login finished');
    });

    telegramName.addEventListener('input', function () {
        toggleSubmitButton();
    });

    document.getElementById('settings').addEventListener('click', function () {
        chrome.runtime.openOptionsPage();
    });

    //logout
    document.getElementById('logoutBtn').addEventListener('click', function () {
        localStorage.removeItem('token');
        //show login
    });

    //tabs
    document.getElementById('homeTab').addEventListener('click', function () {
        showTab('homeContent');
    });

    document
        .getElementById('settingsTab')
        .addEventListener('click', function () {
            showTab('settingsContent');
        });

    function showTab(tabId) {
        const contents = document.querySelectorAll('.tab-content');
        contents.forEach((content) => {
            content.style.display = 'none';
        });
        let activeTab = document.getElementById(tabId);
        activeTab.style.display = 'block';
        // this.classList.add('active-tab');
        activeTab.classList.add('active-tab');
    }
    // document.querySelectorAll('.tab').forEach(tab => {
    //     tab.addEventListener('click', function() {
    //         // Remove active-tab class from all tabs
    //         document.querySelectorAll('.tab').forEach(innerTab => {
    //             innerTab.classList.remove('active-tab');
    //         });
    //
    //         // Add active-tab class to the clicked tab
    //         this.classList.add('active-tab');
    //     });
    // });

    // Show home tab by default
    showTab('homeContent');

    //token verification
    chrome.storage.local.get(['token'], function (result) {
        if (isTokenValid(result.token)) {
            // Token exists, now validate it
            // showLogout()
        } else {
            console.log('The token is invalid');
            // showLogin()
        }
    });

    function isTokenValid(token) {
        if (!token) {
            return false;
        }
        // TODO should be validated on backend
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expirationDate = new Date(payload.exp * 1000); // Convert to milliseconds
        const currentDate = new Date();
        console.log('expirationDate', expirationDate);
        console.log('currentDate', currentDate);
        console.log(
            'currentDate < expirationDate',
            currentDate < expirationDate
        );
        return currentDate < expirationDate;
    }

    // Settings

    const exclusionList = document.getElementById('exclusionList');
    const openSiteInputBtn = document.getElementById('openSiteInputBtn');
    const openSiteInputBtnIcon = document.querySelector('#openSiteInputBtn i');
    const siteInputContainer = document.getElementById('siteInputContainer');
    const siteInput = document.getElementById('siteInput');
    const addSiteButton = document.getElementById('addSiteBtn');
    const enableExtensionCheckbox = document.getElementById('enableExtension');

    const excludedSitesResult = await chrome.storage.local.get({
        excludedSites: [],
    });
    const excludedSites = excludedSitesResult.excludedSites;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentSite = tabs[0].url;

    function getSiteHostname(site) {
        const urlObject = new URL(site);
        return urlObject.hostname;
    }

    // The extension state for the current site
    let isEnabled = !excludedSites.some((site) => {
        const siteHostname = getSiteHostname(currentSite);
        return siteHostname.includes(site);
    });

    enableExtensionCheckbox.checked = isEnabled;

    // Toggle the extension state when clicking the checkbox
    enableExtensionCheckbox.addEventListener('change', async () => {
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
    });

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

    // Display the exclusion list
    function displayExclusionList(list) {
        list.forEach((site) => {
            const listItem = generateExclusionListItem(site);
            openSiteInputBtn.insertAdjacentHTML('beforebegin', listItem);
        });
    }

    displayExclusionList(excludedSites);

    // Open an add site input
    openSiteInputBtn.addEventListener('click', () => {
        if (siteInputContainer.style.display === 'none') {
            siteInputContainer.style.display = 'flex';
            openSiteInputBtnIcon.className = 'fa-solid fa-xmark';
        } else {
            siteInputContainer.style.display = 'none';
            openSiteInputBtnIcon.className = 'fa-solid fa-plus';
        }
    });

    // Add a site to the exclusion list
    addSiteButton.addEventListener('click', async () => {
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
    });

    // Remove a site from the exclusion list when clicking on remove btn
    exclusionList.addEventListener('click', async (e) => {
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
    });
});
