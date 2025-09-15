// Firebase Callable Functions (EU region) with Google Translation API
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Translate } = require('@google-cloud/translate').v2;
const { getFirestore } = require('firebase-admin/firestore');

admin.initializeApp();

// Set EU region for all functions
const REGION = 'europe-central2'; // Warsaw

// Select Firestore database: default to '(default)'.
// You can override via functions config: `firebase functions:config:set firestore.db="(default)"` or a named DB id,
// or via env var FIRESTORE_DB_ID.
const FIRESTORE_DATABASE_ID = (functions.config()?.firestore?.db)
  || process.env.FIRESTORE_DB_ID
  || '(default)';
const db = getFirestore(undefined, FIRESTORE_DATABASE_ID);
functions.logger.info('Using Firestore DB', { databaseId: FIRESTORE_DATABASE_ID });

// Google Translate client
const translateClient = new Translate();
// Lazy OpenAI client (ESM) to avoid CJS/ESM issues in Gen1
let openaiClient = null;
async function getOpenAI() {
  const key = (functions.config()?.openai?.key)
    || process.env.OPENAI_API_KEY
    || process.env.OPENAI_API_TOKEN
    || '';
  if (!key) {
    functions.logger.warn('OpenAI key not configured; skipping GPT examples');
  }
  if (!key) return null;
  if (openaiClient) return openaiClient;
  const mod = await import('openai');
  openaiClient = new mod.default({ apiKey: key });
  return openaiClient;
}

// Translate a word using Google Translation API (returns translation only)
exports.translateWord = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { word, targetLanguage = 'uk' } = data || {};
    if (!word || typeof word !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'word is required');
    }
    try {
      functions.logger.info('translateWord request', {
        uid: context.auth.uid,
        word,
        targetLanguage
      });
      const target = String(targetLanguage).toLowerCase();

      // Cache lookup in Firestore (shared translations collection)
      const normalized = String(word).trim().toLowerCase();
      const cacheId = `${normalized.replace(/[\/#?%]/g, '_')}__${target}`;
      const cacheRef = db.collection('translations').doc(cacheId);
      try {
        const cachedSnap = await cacheRef.get();
        if (cachedSnap.exists) {
          const cached = cachedSnap.data() || {};
          functions.logger.info('translateWord cache hit', { cacheId, word: normalized, target, databaseId: FIRESTORE_DATABASE_ID });
          return {
            success: true,
            word, // return original input
            translation: cached.translation || cached.translated || '',
            synonyms: Array.isArray(cached.synonyms) ? cached.synonyms : [],
            examples: Array.isArray(cached.examples) ? cached.examples : []
          };
        }
      } catch (ce) {
        functions.logger.warn('translateWord cache lookup failed', { message: ce?.message, databaseId: FIRESTORE_DATABASE_ID });
      }

      // Not in cache: translate base word first
      const [translated] = await translateClient.translate(word, target);

      let synonyms = [];
      let examples = [];
      // Prefer GPT for synonyms + examples if key exists
      const openai = await getOpenAI();
      if (openai) {
        try {
          functions.logger.info('OpenAI available; generating synonyms/examples with GPT', { model: 'gpt-4o-mini' });
          const prompt = `Return ONLY valid JSON for the given English source word, target language code, and its translation. 
The JSON schema:
{
  "synonyms": [{"source": "<english synonym>", "translation": "<synonym translated to target language>"}],
  "examples": ["<5 natural sentences in target language using the translated word in correct form>"]
}
Rules:
- synonyms.source: MUST be English synonyms of the source word.
- synonyms.translation: MUST be in the target language (${target}).
- examples: MUST be fully written in the target language (${target}), natural and varied, each using the translated word "${translated}" in an appropriate grammatical form (declension/conjugation as needed). Do NOT include explanations, transliterations, or the language name.
- Output ONLY raw JSON without markdown or commentary.
Input:
- source: "${word}"
- targetLang: "${target}"
- translated: "${translated}"`;

          const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Return only valid JSON object with fields: synonyms (array) and examples (array).' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.4
          });
          let txt = resp.choices?.[0]?.message?.content?.trim() || '';
          if (txt.startsWith('```')) {
            txt = txt.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
          }
          try {
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed.synonyms)) synonyms = parsed.synonyms.slice(0, 8);
            if (Array.isArray(parsed.examples)) examples = parsed.examples.slice(0, 5);
          } catch (je) {
            functions.logger.warn('OpenAI JSON parse failed; fallback', { message: je?.message, txtSample: txt.slice(0, 200) });
          }
        } catch (oe) {
          const details = {
            name: oe?.name,
            status: oe?.status,
            code: oe?.code,
            message: oe?.message,
          };
          try {
            // Some SDK errors include a response payload
            if (oe?.response) {
              details.responseStatus = oe.response.status;
              details.responseBody = typeof oe.response.text === 'function' ? await oe.response.text() : (oe.response.data || undefined);
            }
          } catch (_) { /* ignore body read errors */ }
          functions.logger.warn('OpenAI call failed; fallback to Datamuse', details);
        }
      }

      // Fallback to Datamuse if no OpenAI or parsing failed
      if (synonyms.length === 0) {
        try {
          const resp = await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=8`);
          if (resp.ok) {
            const json = await resp.json();
            const srcSyns = (json || []).map((x) => x.word).filter(Boolean);
            if (srcSyns.length > 0) {
              const [synTranslations] = await translateClient.translate(srcSyns, target);
              const trList = Array.isArray(synTranslations) ? synTranslations : [synTranslations];
              synonyms = srcSyns.map((s, i) => ({ source: s, translation: trList[i] || s }));
            }
          }
        } catch (_) { /* ignore */ }
      }

      // Fallback examples if GPT not available: build English templates and translate them to the target language
      if (examples.length === 0) {
        try {
          const templatesEn = [
            `Here is a simple sentence using the word "${word}" in context.`,
            `The meaning of "${word}" becomes clearer when you read this line.`,
            `We can also include "${word}" naturally within a longer phrase.`,
            `Sometimes writers prefer to put "${word}" at the beginning of a sentence.`,
            `Finally, this sentence demonstrates another common use of "${word}".`
          ];
          const [translatedExamples] = await translateClient.translate(templatesEn, target);
          const trList = Array.isArray(translatedExamples) ? translatedExamples : [translatedExamples];
          examples = trList.slice(0, 5);
        } catch (exErr) {
          functions.logger.warn('Examples fallback translate failed; returning empty examples', { message: exErr?.message });
          examples = [];
        }
      }

      // Persist to cache for future requests
      try {
        await cacheRef.set({
          source: normalized,
          targetLanguage: target,
          translation: translated,
          synonyms: Array.isArray(synonyms) ? synonyms : [],
          examples: Array.isArray(examples) ? examples : [],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        functions.logger.info('translateWord cache save', { cacheId, target, word: normalized, databaseId: FIRESTORE_DATABASE_ID });
      } catch (se) {
        functions.logger.warn('translateWord cache save failed', { message: se?.message, databaseId: FIRESTORE_DATABASE_ID });
      }

      functions.logger.info('translateWord result', {
        uid: context.auth.uid,
        word,
        targetLanguage: target,
        translation: translated,
        synonymsCount: synonyms.length,
        examplesCount: examples.length
      });
      return { success: true, word, translation: translated, synonyms, examples };
    } catch (err) {
      functions.logger.error('Translate API error', {
        message: err?.message,
        code: err?.code,
        word,
        targetLanguage
      });
      throw new functions.https.HttpsError('internal', 'Translation failed');
    }
  });

// Get user's words (filtered by languageCode) from Firestore
exports.getUserWords = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { languageCode = 'uk' } = data || {};
    try {
      const userRef = db.collection('users').doc(context.auth.uid);
      const snap = await userRef
        .collection('words')
        .where('languageCode', '==', languageCode)
        .orderBy('createdAt', 'desc')
        .get();
      const words = [];
      snap.forEach(doc => words.push({ id: doc.id, ...doc.data() }));
      return { words };
    } catch (err) {
      console.error('Error fetching words:', err);
      throw new functions.https.HttpsError('internal', 'Failed to fetch words');
    }
  });

// Delete a user's word by id
exports.deleteUserWord = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { wordId } = data || {};
    if (!wordId) {
      throw new functions.https.HttpsError('invalid-argument', 'wordId is required');
    }
    try {
      const userRef = db.collection('users').doc(context.auth.uid);
      await userRef.collection('words').doc(String(wordId)).delete();
      return { success: true, deletedId: String(wordId) };
    } catch (err) {
      console.error('Error deleting word:', err);
      throw new functions.https.HttpsError('internal', 'Failed to delete word');
    }
  });
