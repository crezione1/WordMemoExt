/**
 * Subscription Manager for LazyLex WordMemo Extension
 *
 * Reads and caches subscription state for display. It does NOT decide access:
 * since issue #49 the product is a 7-day full-access trial, whose clock lives
 * in `users/{uid}/private/entitlement` -- a document firestore.rules hides
 * from every client. Access is granted or refused inside the callables.
 *
 * `DAILY_FREE_LIMIT` (5 words/day) was deleted along with the freemium tier.
 */

class SubscriptionManager {
    constructor() {
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

        // `dailyWordsAdded` / `dailyWordsResetDate` are no longer read (issue
        // #49). They may still be present on documents written before the
        // freemium tier was removed; nothing consumes them.

        return {
            subscriptionStatus,
            subscriptionExpiresAt: fields.subscriptionExpiresAt?.timestampValue || null,
            subscriptionStartedAt: fields.subscriptionStartedAt?.timestampValue || null,
            isPremium: this.isPremiumSubscription(subscriptionStatus)
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
            isPremium: false
        };
    }

    /**
     * Check if user can add more words today
     * @returns {Promise<Object>} Limit check result
     */
    async canAddWord() {
        // Always yes (issue #49).
        //
        // This used to subtract a locally-read `dailyWordsAdded` from a
        // hardcoded free limit of 5. Both halves are gone: the product has no
        // free tier to meter, and the fields it read live on a document the
        // user can write, so the answer was never trustworthy.
        //
        // The extension no longer decides access at all. The callable does,
        // against `users/{uid}/private/entitlement` -- a document firestore
        // rules hide from every client -- and refuses with
        // `reason: 'trial-expired'`. This method survives only so the popup
        // keeps a single call site while its UI is reworked; it must not grow
        // a client-side verdict again.
        return {
            canAdd: true,
            reason: 'server-authoritative',
            wordsRemaining: 'unlimited'
        };
    }

    // `incrementDailyWordCount`, `updateDailyWordCount` and
    // `updateFirestoreWordCount` were deleted here (issue #49).
    //
    // Together they maintained `dailyWordsAdded` / `dailyWordsResetDate` on the
    // user document so the popup could meter the freemium 5-words-a-day limit.
    // That limit no longer exists in the product, and the server keeps its own
    // counters in `users/{uid}/private/usage`, which no client can read or
    // write. Keeping a client-side mirror of a server-side counter only
    // creates a second number to disagree with the first.
    //
    // Nothing outside this class called them.

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

    // `getDailyWordLimit` was deleted here (issue #49). It mapped a
    // subscription status to a words-per-day number, which only meant
    // something while a free tier existed to be capped.

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
        const entitlement = await this.getEntitlementState();

        return {
            subscriptionStatus: subscriptionData.subscriptionStatus,
            isPremium: subscriptionData.isPremium,
            // The trial block, straight from the server, or null when it has
            // not spoken yet. Null means UNKNOWN, never expired -- before the
            // trial-aware functions are deployed every user is in that state,
            // and rendering them as expired would lock out the whole userbase
            // on a deploy that had not happened.
            entitlement,
            canAddWords: true,
            subscriptionExpiresAt: subscriptionData.subscriptionExpiresAt,
            isExpired: subscriptionData.subscriptionExpiresAt ?
                new Date(subscriptionData.subscriptionExpiresAt) < new Date() : false
        };
    }

    /**
     * Last entitlement block the background script saw on a callable response.
     * @returns {Promise<Object|null>} `{ state, trialEndsAt, daysRemaining, enforced }` or null
     */
    async getEntitlementState() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getEntitlementState' });
            return response?.entitlement || null;
        } catch (error) {
            console.warn('Could not read entitlement state:', error?.message || error);
            return null;
        }
    }
}

// Create global instance
window.subscriptionManager = new SubscriptionManager();
