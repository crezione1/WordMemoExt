// document.getElementById('saveButton').addEventListener('click', function() {
//     const word = document.getElementById('wordInput').value;
//     if (word) {
//         // Save the word to the backend or local storage.
//         // For this prototype, we'll just display a message.
//         document.getElementById('status').textContent = `Saved: ${word}`;
//     }
// });

document.addEventListener('DOMContentLoaded', function () {
    console.log('login started')
    const telegramName = document.getElementById('telegramName');
    const loginButton = document.getElementById('loginBtn');

    function toggleSubmitButton() {
        loginButton.disabled = telegramName.value.trim() === '';
        loginButton.style.pointerEvents = loginButton.disabled ? 'none' : 'auto'; // Disable/enable pointer events

    }

    toggleSubmitButton();

    loginButton.addEventListener('click', function() {
        chrome.runtime.sendMessage({message: 'login', arguments: [telegramName.value]});
        console.log(chrome.runtime);
        console.log(chrome.runtime.sendMessage);
        console.log('login finished');
    });

    telegramName.addEventListener('input', function () {
        toggleSubmitButton();
    });

    document.getElementById('settings').addEventListener('click', function() {
        chrome.runtime.openOptionsPage();
    });

    //logout
    document.getElementById('logoutBtn').addEventListener('click', function() {
        localStorage.removeItem('token');
        //show login
    });

    //tabs
    document.getElementById('homeTab').addEventListener('click', function() {
        showTab('homeContent');
    });

    document.getElementById('settingsTab').addEventListener('click', function() {
        showTab('settingsContent');
    });

    function showTab(tabId) {
        const contents = document.querySelectorAll('.tab-content');
        contents.forEach(content => {
            content.style.display = 'none';
        });
        let activeTab = document.getElementById(tabId);
        activeTab.style.display = 'block';
        this.classList.add('active-tab');
        // activeTab.style.background = 'gray';
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
    chrome.storage.local.get(['token'], function(result) {
        if (isTokenValid(result.token)) {
            // Token exists, now validate it
            // showLogout()
        } else {
            console.log('The token is invalid');
            // showLogin()
        }
    });

    function isTokenValid(token) {
        if (!token)
            {return false
        }
        // TODO should be validated on backend
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expirationDate = new Date(payload.exp * 1000); // Convert to milliseconds
        const currentDate = new Date();
        console.log('expirationDate', expirationDate)
        console.log('currentDate', currentDate)
        console.log('currentDate > expirationDate', currentDate > expirationDate)
        return currentDate > expirationDate;
    }

});




