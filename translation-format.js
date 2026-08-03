// Shared display formatting for translations.
//
// Loaded by both the content script and the popup, because the same
// translation is rendered in both and they must not disagree about how it
// looks. The rule lives here rather than in either caller so there is exactly
// one place to change it.
//
// --- The problem this solves -------------------------------------------------
//
// Translation providers capitalise inconsistently. The same page ended up
// showing `[пограбування]`, `[банк]` and `[маска]` next to `[Підготуйтеся]`
// and `[Повільно]` -- lowercase and capitalised forms mixed line by line, with
// nothing about the words themselves to explain the difference. It reads as a
// rendering bug because it is one.
//
// The source word is already normalised: `saveWordToDictionary` lowercases it
// before anything else touches it. The translation was the only half left
// carrying whatever casing came back from the provider.
//
// --- The rule ----------------------------------------------------------------
//
// Lowercase the first character. Leave everything after it alone, so an
// internal capital in a multi-word translation survives.
//
// One exception: a token whose remainder is entirely uppercase is an acronym,
// not a capitalised word. `ЄС` must not become `єС`.
//
// --- Known cost --------------------------------------------------------------
//
// A proper noun loses its capital: `Україна` renders as `україна`. That is the
// price of a single unconditional rule, and it is the rule that was asked for.
// Distinguishing a proper noun from a sentence-initial capital is not something
// the provider's output supports -- both arrive as "first letter uppercase" and
// nothing separates them. If proper nouns turn out to matter more than
// consistency, this is the function to revisit, and it should be revisited
// here rather than patched at a call site.

function normalizeTranslationCase(text) {
    const value = String(text ?? "").trim();
    if (!value) {
        return "";
    }

    const first = value.slice(0, 1);
    const rest = value.slice(1);

    // `rest !== rest.toLocaleLowerCase()` is what distinguishes an acronym
    // from a word with no cased characters at all: "123" and "。" have no
    // lowercase form either, and must not be treated as acronyms.
    const restIsAllUpperCase =
        rest !== "" &&
        rest === rest.toLocaleUpperCase() &&
        rest !== rest.toLocaleLowerCase();

    if (restIsAllUpperCase) {
        return value;
    }

    return first.toLocaleLowerCase() + rest;
}

// Content scripts and the popup are plain scripts, not modules; both read this
// off the global. `globalThis` covers the service worker too, should it ever
// need the same rule.
globalThis.normalizeTranslationCase = normalizeTranslationCase;
