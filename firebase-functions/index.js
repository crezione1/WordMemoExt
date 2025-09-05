// Firebase Cloud Functions for WordMemo Extension
// This file shows the structure for serverless translation functions

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Translation function using Google Translate API
exports.translateWord = functions.https.onCall(async (data, context) => {
    // Ensure user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { word, targetLanguage = 'uk' } = data;

    if (!word) {
        throw new functions.https.HttpsError('invalid-argument', 'Word is required');
    }

    try {
        // Here you would integrate with Google Translate API or another translation service
        // For now, this is a placeholder that returns a mock translation
        
        // Example implementation would use Google Translate:
        // const {Translate} = require('@google-cloud/translate').v2;
        // const translate = new Translate();
        // const [translation] = await translate.translate(word, targetLanguage);
        
        // Mock translation for demonstration
        const mockTranslations = {
            'hello': 'привіт',
            'world': 'світ',
            'good': 'добрий',
            'morning': 'ранок',
            'evening': 'вечір',
            'thank': 'дякую',
            'please': 'будь ласка',
            'yes': 'так',
            'no': 'ні',
            'water': 'вода'
        };

        const translation = mockTranslations[word.toLowerCase()] || `переклад_${word}`;
        
        // Save the word to user's collection
        const userRef = admin.firestore().collection('users').doc(context.auth.uid);
        const wordRef = userRef.collection('words').doc();
        
        await wordRef.set({
            word: word.toLowerCase(),
            translation: translation,
            languageCode: targetLanguage,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            userId: context.auth.uid
        });

        return {
            success: true,
            word: word,
            translation: translation,
            id: wordRef.id
        };

    } catch (error) {
        console.error('Translation error:', error);
        throw new functions.https.HttpsError('internal', 'Translation failed');
    }
});

// Get user's words
exports.getUserWords = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { languageCode = 'uk' } = data;

    try {
        const userRef = admin.firestore().collection('users').doc(context.auth.uid);
        const wordsSnapshot = await userRef.collection('words')
            .where('languageCode', '==', languageCode)
            .orderBy('createdAt', 'desc')
            .get();

        const words = [];
        wordsSnapshot.forEach(doc => {
            words.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return { words };

    } catch (error) {
        console.error('Error fetching words:', error);
        throw new functions.https.HttpsError('internal', 'Failed to fetch words');
    }
});

// Delete user's word
exports.deleteUserWord = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { wordId } = data;

    if (!wordId) {
        throw new functions.https.HttpsError('invalid-argument', 'Word ID is required');
    }

    try {
        const userRef = admin.firestore().collection('users').doc(context.auth.uid);
        await userRef.collection('words').doc(wordId).delete();

        return { success: true, deletedId: wordId };

    } catch (error) {
        console.error('Error deleting word:', error);
        throw new functions.https.HttpsError('internal', 'Failed to delete word');
    }
});