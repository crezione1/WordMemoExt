/**
 * Subscription Manager for LazyLex WordMemo Extension
 * Handles user subscription status, daily limits, and premium features
 */

class SubscriptionManager {
    constructor() {
        this.DAILY_FREE_LIMIT = 5;
        this.SUBSCRIPTION_TYPES = {
            FREE: 'free',
            PREMIUM: 'premium', 
            LIFETIME: 'lifetime'
        };
    }

    /**
     * Get current user's subscription status from storage or Firestore
     * @returns {Promise<Object>} Subscription data
     */
    async getUserSubscriptionStatus() {
        try {
            // First check local storage for cached data
            const { subscriptionData } = await chrome.storage.local.get(['subscriptionData']);
            
            if (subscriptionData && this.isSubscriptionDataFresh(subscriptionData)) {
                return subscriptionData;
            }

            // Fetch from Firestore if no fresh local data
            return await this.fetchSubscriptionFromFirestore();
        } catch (error) {
            console.error('Error getting subscription status:', error);
            return this.getDefaultSubscriptionData();
        }
    }

    /**
     * Check if cached subscription data is still fresh (less than 1 hour old)
     * @param {Object} subscriptionData - Cached subscription data
     * @returns {boolean} Whether data is fresh
     */
    isSubscriptionDataFresh(subscriptionData) {
        if (!subscriptionData.lastFetched) return false;
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        return subscriptionData.lastFetched > oneHourAgo;
    }

    /**
     * Fetch subscription data from Firestore
     * @returns {Promise<Object>} Subscription data
     */
    async fetchSubscriptionFromFirestore() {
        try {
            const headers = await this.getFirestoreHeaders();
            if (!headers) return this.getDefaultSubscriptionData();

            const uid = await this.getAuthUid();
            if (!uid) return this.getDefaultSubscriptionData();

            const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/lazylex-9d161/databases/(default)/documents`;
            const url = `${FIRESTORE_BASE}/users/${uid}`;
            
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                if (response.status === 404) {
                    // User document doesn't exist, create it with default values
                    await this.createDefaultUserDocument(uid);
                }
                return this.getDefaultSubscriptionData();
            }

            const userData = await response.json();
            const subscriptionData = this.parseFirestoreSubscriptionData(userData);
            
            // Cache the data locally
            await chrome.storage.local.set({ 
                subscriptionData: { 
                    ...subscriptionData, 
                    lastFetched: Date.now() 
                } 
            });

            return subscriptionData;
        } catch (error) {
            console.error('Error fetching subscription from Firestore:', error);
            return this.getDefaultSubscriptionData();
        }
    }

    /**
     * Parse Firestore user document to extract subscription data
     * @param {Object} firestoreDoc - Firestore document
     * @returns {Object} Parsed subscription data
     */
    parseFirestoreSubscriptionData(firestoreDoc) {
        const fields = firestoreDoc.fields || {};
        const today = new Date().toISOString().split('T')[0];

        const subscriptionStatus = fields.subscriptionStatus?.stringValue || this.SUBSCRIPTION_TYPES.FREE;
        const dailyWordsResetDate = fields.dailyWordsResetDate?.stringValue || today;
        const dailyWordsAdded = fields.dailyWordsAdded?.integerValue || fields.dailyWordsAdded?.doubleValue || 0;
        
        // Reset daily count if it's a new day
        const resetDailyCount = dailyWordsResetDate !== today;
        const currentDailyCount = resetDailyCount ? 0 : Number(dailyWordsAdded);

        return {
            subscriptionStatus,
            subscriptionExpiresAt: fields.subscriptionExpiresAt?.timestampValue || null,
            subscriptionStartedAt: fields.subscriptionStartedAt?.timestampValue || null,
            dailyWordsAdded: currentDailyCount,
            dailyWordsResetDate: today,
            dailyWordLimit: this.getDailyWordLimit(subscriptionStatus),
            isPremium: this.isPremiumSubscription(subscriptionStatus),
            needsResetUpdate: resetDailyCount
        };
    }

    /**
     * Get default subscription data for new/free users
     * @returns {Object} Default subscription data
     */
    getDefaultSubscriptionData() {
        const today = new Date().toISOString().split('T')[0];
        return {
            subscriptionStatus: this.SUBSCRIPTION_TYPES.FREE,
            subscriptionExpiresAt: null,
            subscriptionStartedAt: null,
            dailyWordsAdded: 0,
            dailyWordsResetDate: today,
            dailyWordLimit: this.DAILY_FREE_LIMIT,
            isPremium: false,
            needsResetUpdate: false
        };
    }

    /**
     * Check if user can add more words today
     * @returns {Promise<Object>} Limit check result
     */
    async canAddWord() {
        const subscriptionData = await this.getUserSubscriptionStatus();
        
        if (subscriptionData.isPremium) {
            return {
                canAdd: true,
                reason: 'premium',
                wordsRemaining: 'unlimited',
                dailyWordsAdded: subscriptionData.dailyWordsAdded
            };
        }

        const wordsRemaining = Math.max(0, subscriptionData.dailyWordLimit - subscriptionData.dailyWordsAdded);
        const canAdd = wordsRemaining > 0;

        return {
            canAdd,
            reason: canAdd ? 'within_limit' : 'daily_limit_reached',
            wordsRemaining,
            dailyWordsAdded: subscriptionData.dailyWordsAdded,
            dailyWordLimit: subscriptionData.dailyWordLimit
        };
    }

    /**
     * Increment daily word count after successfully adding a word
     * @returns {Promise<Object>} Updated subscription data
     */
    async incrementDailyWordCount() {
        try {
            const subscriptionData = await this.getUserSubscriptionStatus();
            
            if (subscriptionData.isPremium) {
                // Premium users don't have limits, but we still track usage
                const newCount = subscriptionData.dailyWordsAdded + 1;
                await this.updateDailyWordCount(newCount, subscriptionData.dailyWordsResetDate);
                return { ...subscriptionData, dailyWordsAdded: newCount };
            }

            // For free users, increment if under limit
            if (subscriptionData.dailyWordsAdded < subscriptionData.dailyWordLimit) {
                const newCount = subscriptionData.dailyWordsAdded + 1;
                await this.updateDailyWordCount(newCount, subscriptionData.dailyWordsResetDate);
                
                return {
                    ...subscriptionData,
                    dailyWordsAdded: newCount
                };
            }

            throw new Error('Daily word limit reached');
        } catch (error) {
            console.error('Error incrementing daily word count:', error);
            throw error;
        }
    }

    /**
     * Update daily word count in both local storage and Firestore
     * @param {number} newCount - New daily word count
     * @param {string} resetDate - Current reset date
     */
    async updateDailyWordCount(newCount, resetDate) {
        const today = new Date().toISOString().split('T')[0];
        const actualResetDate = resetDate || today;
        
        try {
            // Update local cache
            const { subscriptionData } = await chrome.storage.local.get(['subscriptionData']);
            if (subscriptionData) {
                subscriptionData.dailyWordsAdded = newCount;
                subscriptionData.dailyWordsResetDate = actualResetDate;
                subscriptionData.lastFetched = Date.now();
                await chrome.storage.local.set({ subscriptionData });
            }

            // Update Firestore
            await this.updateFirestoreWordCount(newCount, actualResetDate);
        } catch (error) {
            console.error('Error updating daily word count:', error);
        }
    }

    /**
     * Update daily word count in Firestore
     * @param {number} newCount - New daily word count
     * @param {string} resetDate - Current reset date
     */
    async updateFirestoreWordCount(newCount, resetDate) {
        try {
            const headers = await this.getFirestoreHeaders();
            if (!headers) return;

            const uid = await this.getAuthUid();
            if (!uid) return;

            const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/lazylex-9d161/databases/(default)/documents`;
            const url = `${FIRESTORE_BASE}/users/${uid}`;

            const updateData = {
                fields: {
                    dailyWordsAdded: { integerValue: String(newCount) },
                    dailyWordsResetDate: { stringValue: resetDate }
                }
            };

            await fetch(url, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(updateData)
            });
        } catch (error) {
            console.error('Error updating Firestore word count:', error);
        }
    }

    /**
     * Create default user document in Firestore for new users
     * @param {string} uid - User ID
     */
    async createDefaultUserDocument(uid) {
        try {
            const headers = await this.getFirestoreHeaders();
            if (!headers) return;

            const { userInfo } = await chrome.storage.local.get(['userInfo']);
            const today = new Date().toISOString().split('T')[0];
            const now = new Date().toISOString();

            const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/lazylex-9d161/databases/(default)/documents`;
            const url = `${FIRESTORE_BASE}/users/${uid}`;

            const userData = {
                fields: {
                    uid: { stringValue: uid },
                    email: { stringValue: userInfo?.email || '' },
                    displayName: { stringValue: userInfo?.name || userInfo?.displayName || '' },
                    photoURL: { stringValue: userInfo?.picture || userInfo?.photoURL || '' },
                    subscriptionStatus: { stringValue: this.SUBSCRIPTION_TYPES.FREE },
                    dailyWordsAdded: { integerValue: '0' },
                    dailyWordsResetDate: { stringValue: today },
                    dailyWordLimit: { integerValue: String(this.DAILY_FREE_LIMIT) },
                    createdAt: { timestampValue: now },
                    lastLoginAt: { timestampValue: now }
                }
            };

            await fetch(url, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(userData)
            });
        } catch (error) {
            console.error('Error creating default user document:', error);
        }
    }

    /**
     * Get daily word limit based on subscription status
     * @param {string} subscriptionStatus - User's subscription status
     * @returns {number} Daily word limit
     */
    getDailyWordLimit(subscriptionStatus) {
        switch (subscriptionStatus) {
            case this.SUBSCRIPTION_TYPES.PREMIUM:
            case this.SUBSCRIPTION_TYPES.LIFETIME:
                return Number.MAX_SAFE_INTEGER; // Unlimited
            case this.SUBSCRIPTION_TYPES.FREE:
            default:
                return this.DAILY_FREE_LIMIT;
        }
    }

    /**
     * Check if subscription status is premium
     * @param {string} subscriptionStatus - User's subscription status
     * @returns {boolean} Whether user has premium access
     */
    isPremiumSubscription(subscriptionStatus) {
        return subscriptionStatus === this.SUBSCRIPTION_TYPES.PREMIUM || 
               subscriptionStatus === this.SUBSCRIPTION_TYPES.LIFETIME;
    }

    /**
     * Get Firestore headers with authentication
     * @returns {Promise<Object|null>} Headers object or null if no auth
     */
    async getFirestoreHeaders() {
        try {
            // Get Firebase ID token from background script
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getFirebaseIdToken' }, (response) => {
                    if (response?.token) {
                        resolve({
                            'Authorization': `Bearer ${response.token}`,
                            'Content-Type': 'application/json'
                        });
                    } else {
                        resolve(null);
                    }
                });
            });
        } catch (error) {
            console.error('Error getting Firestore headers:', error);
            return null;
        }
    }

    /**
     * Get current user's auth UID
     * @returns {Promise<string|null>} User ID or null
     */
    async getAuthUid() {
        try {
            const { userInfo } = await chrome.storage.local.get(['userInfo']);
            return userInfo?.uid || userInfo?.id || null;
        } catch (error) {
            console.error('Error getting auth UID:', error);
            return null;
        }
    }

    /**
     * Reset subscription data cache (force refresh from Firestore)
     */
    async resetSubscriptionCache() {
        await chrome.storage.local.remove(['subscriptionData']);
    }

    /**
     * Get user's subscription info for UI display
     * @returns {Promise<Object>} Subscription info for display
     */
    async getSubscriptionDisplayInfo() {
        const subscriptionData = await this.getUserSubscriptionStatus();
        const limitCheck = await this.canAddWord();

        return {
            subscriptionStatus: subscriptionData.subscriptionStatus,
            isPremium: subscriptionData.isPremium,
            dailyWordsAdded: subscriptionData.dailyWordsAdded,
            dailyWordLimit: subscriptionData.dailyWordLimit,
            wordsRemaining: limitCheck.wordsRemaining,
            canAddWords: limitCheck.canAdd,
            subscriptionExpiresAt: subscriptionData.subscriptionExpiresAt,
            isExpired: subscriptionData.subscriptionExpiresAt ? 
                new Date(subscriptionData.subscriptionExpiresAt) < new Date() : false
        };
    }
}

// Create global instance
window.subscriptionManager = new SubscriptionManager();
