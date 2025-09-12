/**
 * Chrome Extension API Mock for Web Development
 * This file provides mock implementations of Chrome extension APIs
 * when the extension is running in a web environment for development.
 */

// Only create mock if chrome APIs don't exist (i.e., not in extension context)
console.log('Chrome mock script loading...');
console.log('Current chrome object:', typeof chrome !== 'undefined' ? chrome : 'undefined');

// Create robust event object factory
const createEvent = () => {
    const listeners = [];
    return {
        addListener: function(fn) {
            console.log('Mock event addListener called');
            listeners.push(fn);
        },
        removeListener: function(fn) {
            const index = listeners.indexOf(fn);
            if (index > -1) listeners.splice(index, 1);
        },
        hasListener: function(fn) {
            return listeners.includes(fn);
        },
        _dispatch: function(...args) {
            listeners.slice().forEach(listener => listener(...args));
        }
    };
};

if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    console.log('Initializing Chrome API mocks for web development...');
    
    window.chrome = {
        storage: {
            local: {
                get: function(keys, callback) {
                    // Mock storage using localStorage
                    const result = {};
                    if (typeof keys === 'string') {
                        keys = [keys];
                    } else if (typeof keys === 'object' && !Array.isArray(keys)) {
                        // Handle object with default values
                        const keysWithDefaults = keys;
                        keys = Object.keys(keysWithDefaults);
                        for (let key of keys) {
                            const stored = localStorage.getItem(`chrome_storage_${key}`);
                            result[key] = stored ? JSON.parse(stored) : keysWithDefaults[key];
                        }
                        if (callback) callback(result);
                        return Promise.resolve(result);
                    }
                    
                    for (let key of keys) {
                        const stored = localStorage.getItem(`chrome_storage_${key}`);
                        if (stored) {
                            result[key] = JSON.parse(stored);
                        }
                    }
                    
                    if (callback) callback(result);
                    return Promise.resolve(result);
                },
                
                set: function(items, callback) {
                    for (let key in items) {
                        localStorage.setItem(`chrome_storage_${key}`, JSON.stringify(items[key]));
                    }
                    if (callback) callback();
                    return Promise.resolve();
                },
                
                remove: function(keys, callback) {
                    if (typeof keys === 'string') {
                        keys = [keys];
                    }
                    for (let key of keys) {
                        localStorage.removeItem(`chrome_storage_${key}`);
                    }
                    if (callback) callback();
                    return Promise.resolve();
                }
            },
            
            onChanged: createEvent()
        },
        
        runtime: {
            sendMessage: function(message, callback) {
                console.log('Mock chrome.runtime.sendMessage called with:', message);
                // Mock response for development
                if (callback) {
                    setTimeout(() => callback({ success: true }), 100);
                }
                return Promise.resolve({ success: true });
            },
            
            onMessage: createEvent(),
            onInstalled: createEvent(),
            onStartup: createEvent(),
            onConnect: createEvent(),
            
            openOptionsPage: function() {
                console.log('Mock chrome.runtime.openOptionsPage called');
                // In development, open options.html in new tab
                window.open('/options.html', '_blank');
            },
            
            getURL: function(path) {
                console.log('Mock chrome.runtime.getURL called with:', path);
                return window.location.origin + '/' + path.replace(/^\//, '');
            }
        },
        
        tabs: {
            query: function(queryInfo, callback) {
                console.log('Mock chrome.tabs.query called with:', queryInfo);
                // Mock current tab data
                const mockTab = {
                    id: 1,
                    url: window.location.href,
                    title: document.title,
                    active: true
                };
                
                if (callback) callback([mockTab]);
                return Promise.resolve([mockTab]);
            }
        },
        
        identity: {
            getAuthToken: function(details, callback) {
                console.log('Mock chrome.identity.getAuthToken called with:', details);
                // Mock auth token for development
                if (callback) {
                    setTimeout(() => callback(null), 100); // No token in development
                }
                return Promise.resolve(null);
            }
        },
        
        i18n: {
            getMessage: function(messageName, substitutions) {
                console.log('Mock chrome.i18n.getMessage called with:', messageName);
                // Return the key as fallback
                return messageName;
            }
        },
        
        contextMenus: {
            create: function(options, callback) {
                console.log('Mock chrome.contextMenus.create called with:', options);
                if (callback) callback();
            },
            remove: function(menuItemId, callback) {
                console.log('Mock chrome.contextMenus.remove called');
                if (callback) callback();
            },
            onClicked: createEvent()
        },
        
        scripting: {
            executeScript: function(details, callback) {
                console.log('Mock chrome.scripting.executeScript called with:', details);
                if (callback) callback([]);
                return Promise.resolve([]);
            }
        }
    };
    
    console.log('Chrome API mocks initialized successfully');
} else {
    console.log('Chrome APIs already exist, skipping mock initialization');
}