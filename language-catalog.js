(function initializeLazyLexLanguageCatalog(globalObject) {
    "use strict";

    const languageCatalog = [
        ["af", "Afrikaans", "Afrikaans", "ZA"],
        ["sq", "Albanian", "Shqip", "AL"],
        ["am", "Amharic", "አማርኛ", "ET"],
        ["ar", "Arabic", "العربية", "SA"],
        ["hy", "Armenian", "Հայերեն", "AM"],
        ["as", "Assamese", "অসমীয়া", "IN"],
        ["ay", "Aymara", "Aymar aru", "BO"],
        ["az", "Azerbaijani", "Azərbaycan dili", "AZ"],
        ["bm", "Bambara", "Bamanankan", "ML"],
        ["eu", "Basque", "Euskara", "ES"],
        ["be", "Belarusian", "Беларуская", "BY"],
        ["bn", "Bengali", "বাংলা", "BD"],
        ["bho", "Bhojpuri", "भोजपुरी", "IN"],
        ["bs", "Bosnian", "Bosanski", "BA"],
        ["bg", "Bulgarian", "Български", "BG"],
        ["ca", "Catalan", "Català", "ES"],
        ["ceb", "Cebuano", "Cebuano", "PH"],
        ["ny", "Chichewa", "Chichewa", "MW"],
        ["zh-CN", "Chinese (Simplified)", "简体中文", "CN"],
        ["zh-TW", "Chinese (Traditional)", "繁體中文", "TW"],
        ["co", "Corsican", "Corsu", "FR"],
        ["hr", "Croatian", "Hrvatski", "HR"],
        ["cs", "Czech", "Čeština", "CZ"],
        ["da", "Danish", "Dansk", "DK"],
        ["dv", "Dhivehi", "ދިވެހި", "MV"],
        ["doi", "Dogri", "डोगरी", "IN"],
        ["nl", "Dutch", "Nederlands", "NL"],
        ["en", "English", "English", "GB"],
        ["eo", "Esperanto", "Esperanto", "EU"],
        ["et", "Estonian", "Eesti", "EE"],
        ["ee", "Ewe", "Eʋegbe", "GH"],
        ["tl", "Filipino", "Filipino", "PH"],
        ["fi", "Finnish", "Suomi", "FI"],
        ["fr", "French", "Français", "FR"],
        ["fy", "Frisian", "Frysk", "NL"],
        ["gl", "Galician", "Galego", "ES"],
        ["ka", "Georgian", "ქართული", "GE"],
        ["de", "German", "Deutsch", "DE"],
        ["el", "Greek", "Ελληνικά", "GR"],
        ["gn", "Guarani", "Avañe'ẽ", "PY"],
        ["gu", "Gujarati", "ગુજરાતી", "IN"],
        ["ht", "Haitian Creole", "Kreyòl ayisyen", "HT"],
        ["ha", "Hausa", "Hausa", "NG"],
        ["haw", "Hawaiian", "ʻŌlelo Hawaiʻi", "US"],
        ["iw", "Hebrew", "עברית", "IL"],
        ["hi", "Hindi", "हिन्दी", "IN"],
        ["hmn", "Hmong", "Hmoob", "LA"],
        ["hu", "Hungarian", "Magyar", "HU"],
        ["is", "Icelandic", "Íslenska", "IS"],
        ["ig", "Igbo", "Igbo", "NG"],
        ["ilo", "Ilocano", "Ilokano", "PH"],
        ["id", "Indonesian", "Bahasa Indonesia", "ID"],
        ["ga", "Irish", "Gaeilge", "IE"],
        ["it", "Italian", "Italiano", "IT"],
        ["ja", "Japanese", "日本語", "JP"],
        ["jw", "Javanese", "Basa Jawa", "ID"],
        ["kn", "Kannada", "ಕನ್ನಡ", "IN"],
        ["kk", "Kazakh", "Қазақ тілі", "KZ"],
        ["km", "Khmer", "ខ្មែរ", "KH"],
        ["rw", "Kinyarwanda", "Ikinyarwanda", "RW"],
        ["gom", "Konkani", "कोंकणी", "IN"],
        ["ko", "Korean", "한국어", "KR"],
        ["kri", "Krio", "Krio", "SL"],
        ["ku", "Kurdish (Kurmanji)", "Kurdî", "TR"],
        ["ckb", "Kurdish (Sorani)", "کوردی", "IQ"],
        ["ky", "Kyrgyz", "Кыргызча", "KG"],
        ["lo", "Lao", "ລາວ", "LA"],
        ["la", "Latin", "Latina", "VA"],
        ["lv", "Latvian", "Latviešu", "LV"],
        ["ln", "Lingala", "Lingála", "CD"],
        ["lt", "Lithuanian", "Lietuvių", "LT"],
        ["lg", "Luganda", "Luganda", "UG"],
        ["lb", "Luxembourgish", "Lëtzebuergesch", "LU"],
        ["mk", "Macedonian", "Македонски", "MK"],
        ["mai", "Maithili", "मैथिली", "IN"],
        ["mg", "Malagasy", "Malagasy", "MG"],
        ["ms", "Malay", "Bahasa Melayu", "MY"],
        ["ml", "Malayalam", "മലയാളം", "IN"],
        ["mt", "Maltese", "Malti", "MT"],
        ["mi", "Maori", "Te reo Māori", "NZ"],
        ["mr", "Marathi", "मराठी", "IN"],
        ["mni-Mtei", "Meiteilon (Manipuri)", "ꯃꯤꯇꯩꯂꯣꯟ", "IN"],
        ["lus", "Mizo", "Mizo ṭawng", "IN"],
        ["mn", "Mongolian", "Монгол", "MN"],
        ["my", "Myanmar (Burmese)", "မြန်မာ", "MM"],
        ["ne", "Nepali", "नेपाली", "NP"],
        ["no", "Norwegian", "Norsk", "NO"],
        ["or", "Odia (Oriya)", "ଓଡ଼ିଆ", "IN"],
        ["om", "Oromo", "Afaan Oromoo", "ET"],
        ["ps", "Pashto", "پښتو", "AF"],
        ["fa", "Persian", "فارسی", "IR"],
        ["pl", "Polish", "Polski", "PL"],
        ["pt", "Portuguese", "Português", "PT"],
        ["pa", "Punjabi", "ਪੰਜਾਬੀ", "IN"],
        ["qu", "Quechua", "Runasimi", "PE"],
        ["ro", "Romanian", "Română", "RO"],
        ["ru", "Russian", "Русский", "RU"],
        ["sm", "Samoan", "Gagana Samoa", "WS"],
        ["sa", "Sanskrit", "संस्कृतम्", "IN"],
        ["gd", "Scots Gaelic", "Gàidhlig", "GB"],
        ["nso", "Sepedi", "Sesotho sa Leboa", "ZA"],
        ["sr", "Serbian", "Српски", "RS"],
        ["st", "Sesotho", "Sesotho", "LS"],
        ["sn", "Shona", "ChiShona", "ZW"],
        ["sd", "Sindhi", "سنڌي", "PK"],
        ["si", "Sinhala", "සිංහල", "LK"],
        ["sk", "Slovak", "Slovenčina", "SK"],
        ["sl", "Slovenian", "Slovenščina", "SI"],
        ["so", "Somali", "Soomaali", "SO"],
        ["es", "Spanish", "Español", "ES"],
        ["su", "Sundanese", "Basa Sunda", "ID"],
        ["sw", "Swahili", "Kiswahili", "TZ"],
        ["sv", "Swedish", "Svenska", "SE"],
        ["tg", "Tajik", "Тоҷикӣ", "TJ"],
        ["ta", "Tamil", "தமிழ்", "IN"],
        ["tt", "Tatar", "Татарча", "RU"],
        ["te", "Telugu", "తెలుగు", "IN"],
        ["th", "Thai", "ไทย", "TH"],
        ["ti", "Tigrinya", "ትግርኛ", "ER"],
        ["ts", "Tsonga", "Xitsonga", "ZA"],
        ["tr", "Turkish", "Türkçe", "TR"],
        ["tk", "Turkmen", "Türkmençe", "TM"],
        ["ak", "Twi", "Twi", "GH"],
        ["uk", "Ukrainian", "Українська", "UA"],
        ["ur", "Urdu", "اردو", "PK"],
        ["ug", "Uyghur", "ئۇيغۇرچە", "CN"],
        ["uz", "Uzbek", "Oʻzbekcha", "UZ"],
        ["vi", "Vietnamese", "Tiếng Việt", "VN"],
        ["cy", "Welsh", "Cymraeg", "GB"],
        ["xh", "Xhosa", "isiXhosa", "ZA"],
        ["yi", "Yiddish", "ייִדיש", "IL"],
        ["yo", "Yoruba", "Yorùbá", "NG"],
        ["zu", "Zulu", "isiZulu", "ZA"]
    ].map(([code, name, nativeName, countryCode]) => Object.freeze({
        code,
        name,
        nativeName,
        countryCode
    }));

    function normalizeSearchText(value) {
        return String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase();
    }

    function filterLanguages(query, catalog = languageCatalog) {
        const normalizedQuery = normalizeSearchText(query).trim();
        if (!normalizedQuery) {
            return [...catalog];
        }

        return catalog.filter((language) => [
            language.code,
            language.name,
            language.nativeName
        ].some((value) => normalizeSearchText(value).includes(normalizedQuery)));
    }

    function countryCodeToFlag(countryCode) {
        const normalizedCode = String(countryCode || "").trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(normalizedCode)) {
            return "🌐";
        }

        return String.fromCodePoint(
            ...[...normalizedCode].map((character) => 127397 + character.charCodeAt(0))
        );
    }

    globalObject.LazyLexLanguageCatalog = Object.freeze(languageCatalog);
    globalObject.LazyLexLanguageTools = Object.freeze({
        countryCodeToFlag,
        filterLanguages,
        normalizeSearchText
    });
})(globalThis);
