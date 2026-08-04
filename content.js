let settings = {};
const countedWordIdsOnPage = new Set();

// Exclusion-list gating (#48)
//
// Whether LazyLex is allowed to render on this page. The background service
// worker owns the exclusion list; the content script only ever mirrors the
// answer here. Two things keep this flag honest:
//
//   1. `checkInitialExtensionState()` resolves it from the background worker
//      at bootstrap, and the first highlight pass is chained onto that
//      promise rather than racing it. Before this existed the check was
//      defined but never called, so an excluded site still highlighted.
//   2. The "extensionStateChanged" broadcast updates it live, so toggling a
//      site removes (or restores) the translations on an already-open page
//      with no reload.
//
// It defaults to `true` so that a page is never left permanently blank if
// the service worker is slow or unreachable; the broadcast corrects it.
let extensionEnabledForSite = true;

function setExtensionEnabledForSite(enabled) {
    // Anything other than an explicit `false` (including an undefined
    // response from a torn-down service worker) means "render".
    extensionEnabledForSite = enabled !== false;
    return extensionEnabledForSite;
}

// Style isolation: every control lives in a shadow root (#52)
//
// The controls used to be plain elements appended to `document.body`, so they
// inherited the host page's typography and were matched by its `button {}` /
// `input {}` rules. styles.css fought that with a partial `!important` list,
// which is an arms race we lose on every new site: it cannot pin the
// *inherited* properties (font-family, line-height, letter-spacing,
// text-transform, ...) at all, because those arrive through inheritance rather
// than through a rule we can outrank.
//
// A shadow root ends the arms race. Host-page selectors cannot match anything
// inside one, so the control stylesheet below needs no `!important` whatsoever
// and the controls render identically on every site.
//
// Two things a shadow root does NOT give us for free, both handled here:
//
//   1. *Inheritance still crosses the boundary.* Inheritable properties flow
//      from the light-DOM host element into the shadow tree. `all: initial` on
//      the host cuts that off, so the shadow tree starts from initial values
//      instead of the page's.
//   2. *The host element itself is still light DOM* and can be targeted by the
//      page (`div {}`, `* {}`, an aggressive reset). It is styled with inline
//      `!important` declarations, which outrank any author `!important` rule a
//      page can write, so nothing the page ships can move, hide, resize or
//      re-stack the container.
//
// The highlight (`.highlight-wrapper` and friends) deliberately stays in light
// DOM: it is inline inside the page's own text and has to keep flowing with
// it, so it keeps its defensive rules in styles.css.
//
// `mode: "open"` rather than `"closed"`: style isolation is identical either
// way (CSS never crosses a shadow boundary, open or closed), and an open root
// stays inspectable from the devtools console, which is what makes the
// computed-style verification in tests/fixtures possible. Nothing about our
// security posture depends on the page being unable to reach the root -- a
// page that wants to interfere with a content script has far easier options.
const CONTROL_HOST_ID = "lazylex-controls";

// Applied to the host element as inline `!important` declarations, in this
// order: `all` first (it expands to every longhand, so anything after it wins),
// then the geometry that makes the host a zero-sized anchor pinned at the
// viewport origin.
//
// Zero-sized and `pointer-events: none` means the host never intercepts a
// click meant for the page. Because it is `position: fixed`, it is also the
// containing block for its absolutely positioned shadow children -- which is
// what lets every control be placed in plain viewport coordinates.
const CONTROL_HOST_STYLE = [
    ["all", "initial"],
    ["position", "fixed"],
    ["top", "0"],
    ["left", "0"],
    ["width", "0"],
    ["height", "0"],
    ["margin", "0"],
    ["padding", "0"],
    ["border", "0"],
    ["overflow", "visible"],
    ["display", "block"],
    ["pointer-events", "none"],
    ["visibility", "visible"],
    ["opacity", "1"],
    ["transform", "none"],
    ["filter", "none"],
    ["clip-path", "none"],
    ["contain", "none"],
    ["color-scheme", "light"],
    ["z-index", "2147483647"]
];

// The control stylesheet. It lives here rather than in styles.css because
// styles.css is injected into the *page*, and a shadow root does not see it.
// No declaration in here needs `!important`: nothing on the host page can
// match these selectors.
//
// #11's delete-button visibility guarantees are reproduced verbatim (dark red
// fill, white border, drop shadow). They were originally pinned with
// `!important` because a Google results page could strip them; inside a shadow
// root they cannot be stripped at all, so the guarantee is now structural
// rather than a specificity bet.
const CONTROL_STYLESHEET = `
/*
 * Reset first. The host already blocks inherited values from the page, but
 * declaring them explicitly is what makes "identical on every site" a property
 * of this file rather than of whatever the browser's initial values happen to
 * be (#52, criterion 4).
 */
:host {
    all: initial;
}

*,
*::before,
*::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 400;
    font-style: normal;
    font-stretch: normal;
    font-variant: normal;
    line-height: 1;
    letter-spacing: normal;
    word-spacing: normal;
    text-transform: none;
    text-indent: 0;
    text-decoration: none;
    text-shadow: none;
    white-space: nowrap;
    direction: ltr;
    float: none;
    min-width: 0;
    min-height: 0;
    max-width: none;
    max-height: none;
    transform: none;
    transition: none;
    animation: none;
}

/* Every element mounted directly into the layer is placed in viewport
 * coordinates and is the only thing that accepts pointer input. */
.lazylex-control {
    position: absolute;
    pointer-events: auto;
}

.action-button {
    width: 24px;
    height: 24px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    color: #ffffff;
    background-color: #ff6b35;
    background-image: none;
    border: none;
    border-radius: 50%;
    box-shadow: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    opacity: 1;
    visibility: visible;
    text-align: center;
    font-size: 14px;
    line-height: 1;
    user-select: none;
}

.action-button:disabled {
    cursor: default;
    opacity: 0.6;
}

/*
 * The delete button now matches the add button exactly -- same 24px circle,
 * same #ff6b35, no border, no shadow. Only the glyph differs.
 *
 * It used to be 32px, dark red, white-bordered and drop-shadowed. That was
 * #11: at the time every control was plain DOM in the host page, so a dense
 * high-contrast results page could wash it out, and the extra weight was what
 * kept it findable. #52 moved every control into a shadow root, where no host
 * selector can reach it and nothing it sits over can change how it renders --
 * so the reason for the difference no longer exists, and what remained was two
 * of our own controls looking unrelated for a historical reason.
 *
 * Worth knowing: delete is the destructive action, and it is now
 * distinguishable from add by its glyph alone. The two never appear in the
 * same situation -- delete opens on an already-saved highlighted word, add on
 * a fresh selection -- so the glyph is carrying a distinction the context
 * already makes. If that turns out to be too little, the place to add weight
 * back is here, and it should be something that does not re-open the "every
 * control looks different" complaint (#52).
 */

.edit-translation-container {
    display: flex;
    align-items: center;
    gap: 5px;
}

.edit-translation-input {
    width: 180px;
    height: 26px;
    padding: 4px 8px;
    border: 1px solid #cccccc;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1.2;
    color: #111111;
    background-color: #ffffff;
    background-image: none;
    box-shadow: none;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    text-transform: none;
}

.edit-translation-input:focus {
    outline: none;
    border-color: #ff6b35;
    box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.25);
}
`;

// Declared sizes, mirrored from CONTROL_STYLESHEET so that a control can be
// clamped to the viewport without forcing a layout pass to measure it. The
// "control sizes agree with the control stylesheet" test fails if these ever
// drift apart from the CSS above.
const ACTION_BUTTON_SIZE = 24;
// Same as the add button now: the delete control no longer has its own size.
// Kept as a named constant rather than folded into ACTION_BUTTON_SIZE so the
// call site still reads as "the delete button's size" -- if the two ever need
// to diverge again, this is the one line to change.
const DELETE_BUTTON_SIZE = ACTION_BUTTON_SIZE;
const EDIT_INPUT_WIDTH = 180;
const EDIT_CONTAINER_HEIGHT = 26;

let controlHostElement = null;
let controlLayerRoot = null;

// Creates the host + shadow root on first use and reuses them afterwards. Also
// re-creates them if the page removed the host from the document (SPA route
// swaps that wipe large subtrees do happen), so a control can never be mounted
// into a detached tree.
function ensureControlLayer() {
    if (controlLayerRoot && controlHostElement?.isConnected) {
        return controlLayerRoot;
    }

    controlHostElement = document.createElement("div");
    controlHostElement.id = CONTROL_HOST_ID;
    CONTROL_HOST_STYLE.forEach(([property, value]) => {
        controlHostElement.style.setProperty(property, value, "important");
    });

    controlLayerRoot = controlHostElement.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CONTROL_STYLESHEET;
    controlLayerRoot.appendChild(style);

    // Attached to <html>, not <body>: it keeps the host out of every tree the
    // highlighter walks (findTextNodes starts at document.body), and it leaves
    // no light-DOM ancestor between the host and the viewport that could turn
    // `position: fixed` into "fixed relative to a transformed ancestor".
    document.documentElement.appendChild(controlHostElement);
    return controlLayerRoot;
}

// Keeps a control fully on screen. The caller passes the size it declared in
// the stylesheet, so this does not need a layout pass to clamp.
const CONTROL_VIEWPORT_MARGIN = 8;

function clampToViewport(value, size, extent) {
    const upperBound = Math.max(CONTROL_VIEWPORT_MARGIN, extent - size - CONTROL_VIEWPORT_MARGIN);
    return Math.round(Math.min(Math.max(value, CONTROL_VIEWPORT_MARGIN), upperBound));
}

// The single answer to "where does a control go" (#52, criterion 7).
//
// There used to be three different answers. `#add-new-word` was
// `position: absolute` in styles.css and positioned from `event.pageX/pageY`;
// `#add-new-sentence` had no `position` rule at all, so its top/left were
// ignored and it landed in normal body flow; `#deleteWordBtn` set
// `position: fixed` inline and positioned from a viewport rect. Two coordinate
// systems, one control that did not position itself at all, and a stylesheet
// declaration that only sometimes applied.
//
// Now there is one: a control is an absolutely positioned child of a fixed,
// zero-sized host at the viewport origin, so `left`/`top` are always viewport
// coordinates and no per-control `position` declaration exists to conflict.
//
// Note on the stale-rect problem: the anchor is still captured once, when the
// control opens. Repositioning on scroll is deliberately NOT done here --
// #51 chose scroll *dismissal* instead, and that decision stands (a control
// anchored to a word the user has scrolled away from is noise either way).
// Unifying the coordinate system is what makes that dismissal coherent: every
// control is now fixed to the viewport, so every control is equally stale
// after a scroll, rather than one drifting with the document and two not.
function mountControl(element, { left, top, width, height }) {
    const layer = ensureControlLayer();
    element.classList.add("lazylex-control");
    element.style.setProperty("left", `${clampToViewport(left, width, window.innerWidth)}px`);
    element.style.setProperty("top", `${clampToViewport(top, height, window.innerHeight)}px`);
    layer.appendChild(element);
    return element;
}

// Widget ownership: one control on screen at a time (#51)
//
// LazyLex has three control surfaces -- the add-word/add-sentence button, the
// delete button and the inline translation editor. Before this existed each
// one only removed *its own kind* when it opened, so any pair (or all three)
// could be live at once, in different places, belonging to different words.
//
// The rule is now: whatever is open is recorded here, and every path that
// opens a control -- or that has any reason to close one -- goes through
// `setActiveWidget()` / `dismissActiveWidget()`.
//
// Why a teardown callback rather than "remove the node": the translation
// editor hides the original `.translation` span (`display: none`) and only
// its own teardown puts it back. A generic dismiss that called `.remove()`
// on the container would leave the word permanently without a translation.
// So each surface hands in the function that closes *it* cleanly, and the
// shared dismiss runs that.
let activeWidget = null;

// Scroll dismissal ignores anything that arrives in the first moments after a
// control opens: focusing the edit input can scroll the page by itself, and
// that must not close the control that was just opened. A timestamp is used
// rather than a requestAnimationFrame "arm it next frame", because rAF does
// not run in a hidden or throttled tab -- which would leave scroll dismissal
// permanently disarmed there.
const WIDGET_SCROLL_GRACE_MS = 250;
let widgetOpenedAt = 0;

// A text-selection gesture ends with mouseup AND a click: the browser fires
// click on the common ancestor of mousedown/mouseup right after mouseup. The
// mouseup handler opens the add-word control, so without this flag the very
// next event -- part of the same gesture -- reaches the document click
// handler, is read as "the user clicked elsewhere", and dismisses the button
// before it can be seen. Set when mouseup opens a control, consumed by the
// click that closes the same gesture.
let selectionGestureOpenedControl = false;

// Anything the extension itself put on the page. A click or mouseup landing
// inside one of these belongs to that control and must not be treated as
// "the user interacted with the page", which would dismiss it mid-use.
//
// `#lazylex-controls` is the shadow host (#52); the per-control ids and
// `.edit-translation-container` are kept so that a stray control left in light
// DOM by an older injection of this script is still recognised.
const WIDGET_CONTROL_SELECTOR =
    "#lazylex-controls, .lazylex-control, #add-new-word, #add-new-sentence, #deleteWordBtn, .edit-translation-container";

function isWidgetControlNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return !!element?.closest?.(WIDGET_CONTROL_SELECTOR);
}

// "Did this event start inside one of our controls?"
//
// This MUST use composedPath() rather than event.target (#52). Events raised
// inside a shadow root are retargeted on the way out: by the time a listener
// on `document` sees a click on the "+" button, `event.target` is the shadow
// *host*, and for anything nested it can be less useful still. composedPath()
// is the only API that reports the real originating node across a shadow
// boundary.
//
// Getting this wrong is the specific way moving the controls into a shadow
// root breaks #51: the document-level mouseup/click handlers dismiss whatever
// is open before doing their own work, so a control that fails this test
// destroys itself on the user's very first click on it.
//
// The `event.target` fallback at the end is for synthetic events (and the unit
// tests' fake DOM) that carry no composedPath.
function isWidgetControlEvent(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : null;
    if (Array.isArray(path) || (path && typeof path.length === "number")) {
        for (const node of path) {
            if (node === controlHostElement || isWidgetControlNode(node)) {
                return true;
            }
        }
    }

    return isWidgetControlNode(event?.target);
}

// Puts back any `.translation` span an editor is hiding.
//
// The editor used to be inserted as the next sibling of the span it hid, so
// the sweep could find the span with `previousElementSibling`. Now the editor
// lives in the shadow layer and has no light-DOM sibling at all, so the sweep
// asks the question directly: is any translation still hidden? That is a
// stronger version of the same #51 guarantee (criterion 7) -- a translation
// cannot be left invisible no matter which route closed the editor, and now
// also no matter where the editor was mounted.
// Kept unconditional on purpose. A counter guard was tried here and removed:
// it made the sweep restore only what THIS script instance hid, which quietly
// weakened #51 criterion 7 -- a translation hidden by a previous injection of
// the content script would have stayed invisible forever. Measured cost on a
// ~40k-element page is 0.3ms, against the 3.8ms control query that was the
// actual source of the lag. Not worth trading a guarantee for.
function restoreHiddenTranslations() {
    document.querySelectorAll(".translation").forEach((span) => {
        // Ours only. A host page is free to ship its own `.translation` class,
        // and un-hiding one of those would be vandalism.
        if (span?.style?.display === "none" && span.closest?.(".highlight-wrapper")) {
            span.style.display = "";
        }
    });
}

// Belt and braces: close anything that looks like a LazyLex control even if
// no teardown was registered for it. This covers controls that outlived their
// registration -- a re-injected content script, or a widget whose word was
// destroyed underneath it by an SPA navigation.
function sweepOrphanedWidgetControls() {
    // The shadow layer holds every current control. Its <style> element is not
    // a control and must survive the sweep, or the next control to open would
    // be unstyled.
    //
    // This query is scoped to the shadow root, which holds at most one control,
    // so it stays cheap no matter how large the host page is. That matters:
    // dismissActiveWidget runs on every mouseup AND every document click.
    controlLayerRoot?.querySelectorAll(".lazylex-control").forEach((control) => control.remove());

    restoreHiddenTranslations();
}

// The document-wide half of the sweep, which used to run inside
// sweepOrphanedWidgetControls on every gesture.
//
// Measured on a ~40k-element page (a long ChatGPT conversation is that order),
// that query cost 3.8ms. dismissActiveWidget is called from both the mouseup
// and the click handler, so a single click paid it twice -- ~8ms of blocking
// work per interaction, on a page where nothing of ours was open at all. That
// is the lag reported on chatgpt.com.
//
// What it actually guards against is controls left in light DOM by a PREVIOUS
// injection of this script: before #52 every control was appended to
// document.body. Nothing in this version can create one -- mountControl puts
// every control in the shadow layer -- so the only moment it can find anything
// is startup. Running it once is not a weaker guarantee, it is the same
// guarantee at the only time it could ever fire.
function sweepLegacyLightDomControls() {
    document
        .querySelectorAll("#add-new-word, #add-new-sentence, #deleteWordBtn, .edit-translation-container")
        .forEach((control) => control.remove());
}

// Closes whatever control is currently open. Safe to call when nothing is
// open, and safe to call twice; every open path calls it first.
function dismissActiveWidget() {
    const widget = activeWidget;
    activeWidget = null;
    widgetOpenedAt = 0;

    if (widget?.dismiss) {
        try {
            widget.dismiss();
        } catch (error) {
            console.warn("[LazyLexExt] Unable to close the open control:", error?.message || error);
        }
    }

    sweepOrphanedWidgetControls();
}

// Registers a freshly opened control, dismissing whatever was open before it.
// `widget` is `{ type, target, dismiss }`; `target` lets a surface recognise a
// repeat click on itself (the editor uses it to toggle closed).
//
// Call this *before* inserting the new control into the document: the
// dismissal it performs includes the defensive sweep, which would otherwise
// remove the node that was just attached.
function setActiveWidget(widget) {
    dismissActiveWidget();
    activeWidget = widget;
    widgetOpenedAt = Date.now();
}

// Every control is positioned from a rect captured when it opened, so it
// detaches from its word the moment the page scrolls. Capture phase, because
// scroll does not bubble from a scrollable element up to window.
window.addEventListener(
    "scroll",
    () => {
        if (activeWidget && Date.now() - widgetOpenedAt > WIDGET_SCROLL_GRACE_MS) {
            dismissActiveWidget();
        }
    },
    { capture: true, passive: true }
);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeWidget) {
        dismissActiveWidget();
    }
});

// Selection classification (word / phrase / sentence)
//
// Sentence saving is a premium-only feature with its own backend contract
// and private per-user storage (see issue #28). Word/phrase selection must
// keep working exactly as before, so this only needs to reliably recognize
// "this selection is sentence-shaped" and route those (and only those)
// selections down a different path -- it is intentionally conservative
// about calling something a sentence.
const SENTENCE_MAX_LENGTH = 500;

// Pure, side-effect free so it can be unit tested directly (see
// tests/local-build.test.mjs), matching this repo's existing no-DOM-
// dependency test style for content.js logic.
function classifySelectionType(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return null;
    }

    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const endsWithSentencePunctuation = /[.!?]["'’”)\]]?$/.test(trimmed);
    const isSentence = wordCount >= 6
        || trimmed.length > 120
        || (wordCount >= 3 && endsWithSentencePunctuation);

    if (isSentence) {
        return "sentence";
    }

    return wordCount > 1 ? "phrase" : "word";
}

// YouTube SPA navigation handling
//
// YouTube swaps videos through client-side (pushState-based) navigation, so
// the content script is never re-injected between videos. Without explicit
// handling, LazyLex wrappers created for the previous video's title/page
// text are never cleaned up and sit on screen next to the new video.

const YOUTUBE_HOSTNAMES = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

function getYouTubeVideoIdFromUrl(url) {
    try {
        const parsed = new URL(url);
        if (!YOUTUBE_HOSTNAMES.has(parsed.hostname)) {
            return null;
        }
        if (parsed.pathname === "/watch") {
            return parsed.searchParams.get("v");
        }
        const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
        if (shortsMatch) {
            return shortsMatch[1];
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Pure decision helper (kept side-effect free and exported to the file's
// top level so it can be unit tested in isolation): given the video id we
// last processed and a candidate URL, decide whether this is a transition
// to a genuinely different video that requires a DOM cleanup + reprocess.
function isNewYouTubeNavigation(previousVideoId, url) {
    const videoId = getYouTubeVideoIdFromUrl(url);
    return {
        videoId,
        isNewVideo: videoId !== null && videoId !== previousVideoId
    };
}

function isYouTubeHost(hostname = window.location.hostname) {
    return YOUTUBE_HOSTNAMES.has(hostname);
}

let lastProcessedYouTubeVideoId = isYouTubeHost() ? getYouTubeVideoIdFromUrl(window.location.href) : null;
let youtubeNavigationHandlersInstalled = false;
let youtubeNavigationChain = Promise.resolve();

// Removes every LazyLex-owned DOM node (wrappers, highlights, translations,
// delete controls) and reprocesses the current word list against the
// current DOM exactly once. Reuses the same clear+highlight primitives the
// "reload" wordsChanged broadcast already relies on, so there is a single,
// already-tested code path for "wipe the page and rehighlight."
async function resyncHighlightsForCurrentPage() {
    // Before anything is torn down: an open control is anchored to a wrapper
    // that is about to be destroyed. This used to remove #deleteWordBtn only,
    // so an open edit field survived an SPA navigation attached to a span that
    // no longer existed (#51). The shared dismiss runs each surface's own
    // teardown, which is also what restores a hidden translation.
    dismissActiveWidget();
    clearHighlighting();

    if (!extensionEnabledForSite) {
        // Excluded site: the cleanup above is still correct (stale wrappers
        // from a previous video must go), but nothing may be re-rendered.
        return;
    }

    const { words } = await chrome.storage.local.get({ words: [] });
    if (words && words.length > 0) {
        await highlightWords(words);
    }
}

// YouTube renders the new video's metadata asynchronously after
// yt-navigate-finish fires, so poll briefly (bounded attempts) for the
// title element to carry text before reprocessing, instead of racing it.
function waitForYouTubeTitleReady(videoId, attemptsLeft = 10) {
    return new Promise((resolve) => {
        const titleElement = document.querySelector(
            "#title h1, ytd-watch-metadata h1, h1.ytd-watch-metadata, #container h1.title"
        );
        const isStillCurrent = getYouTubeVideoIdFromUrl(window.location.href) === videoId;
        const hasTitleText = !!(titleElement && titleElement.textContent && titleElement.textContent.trim());

        if (!isStillCurrent || hasTitleText || attemptsLeft <= 0) {
            resolve();
            return;
        }

        setTimeout(() => resolve(waitForYouTubeTitleReady(videoId, attemptsLeft - 1)), 150);
    });
}

function handleYouTubeNavigation(url = window.location.href) {
    if (!isYouTubeHost()) {
        return;
    }

    const { videoId, isNewVideo } = isNewYouTubeNavigation(lastProcessedYouTubeVideoId, url);
    if (!isNewVideo) {
        return;
    }
    lastProcessedYouTubeVideoId = videoId;

    // Chain onto any in-flight navigation handling so overlapping triggers
    // (yt-navigate-finish, the pushState hook, and the polling fallback can
    // all fire for the same transition) process the new video exactly once
    // instead of racing or duplicating cleanup/highlight work.
    youtubeNavigationChain = youtubeNavigationChain
        .then(() => waitForYouTubeTitleReady(videoId))
        .then(() => resyncHighlightsForCurrentPage())
        .catch((error) => {
            console.warn(
                "[LazyLexExt] Unable to refresh highlights after YouTube navigation:",
                error?.message || error
            );
        });
}

function installYouTubeNavigationHandlers() {
    if (youtubeNavigationHandlersInstalled || !isYouTubeHost()) {
        return;
    }
    youtubeNavigationHandlersInstalled = true;

    // Primary signal: YouTube's own SPA router dispatches these on window.
    window.addEventListener("yt-navigate-start", () => clearHighlighting());
    window.addEventListener("yt-navigate-finish", () => handleYouTubeNavigation());

    // Fallback signal: some navigations (or older/changed YouTube markup)
    // may not dispatch the events above. Cover both pushState-driven
    // navigation and browser Back/Forward.
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        handleYouTubeNavigation();
        return result;
    };
    window.addEventListener("popstate", () => handleYouTubeNavigation());

    // Last-resort fallback in case none of the above fire for a given
    // transition; cheap (a URL parse) and only runs on YouTube hosts.
    setInterval(() => handleYouTubeNavigation(), 1000);
}

if (isYouTubeHost()) {
    installYouTubeNavigationHandlers();
}

// Saving/deleting words

async function deleteWordFromStorage(wordId) {
    const response = await chrome.runtime.sendMessage({
        action: "deleteWord",
        wordId: Number(wordId)
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to delete the word.");
    }
}

async function updateWordInStorage(wordId, newTranslation) {
    const { words } = await chrome.storage.local.get(["words"]);
    const word = (words || []).find((item) => item.id === Number(wordId));
    if (!word) {
        throw new Error("The word is no longer in your dictionary.");
    }

    const response = await chrome.runtime.sendMessage({
        action: "persistWord",
        word: {
            ...word,
            translation: newTranslation,
            lastUpdated: Date.now()
        }
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to update the translation.");
    }
}

async function runLogic(selectedText, rect) {
    // The keyboard shortcut reaches here without passing the mouseup handler,
    // so the exclusion check has to exist here too. Without it the word was
    // still translated and saved on an excluded page -- the rendering was
    // suppressed by the gates #48 added downstream, which made it look like
    // nothing happened while a billable translation call had already been made.
    if (!extensionEnabledForSite) {
        console.log('[LazyLexExt] Site is excluded; ignoring the add request.');
        return;
    }

    // Clean the selection to only get the original word, not the translation
    const originalWord = selectedText.split('[')[0].trim();
    if (!originalWord) return;

    console.log('[LazyLexExt] runLogic called with:', originalWord);

    const { words } = await chrome.storage.local.get(["words"]) || [];
    const wordList = words || [];
    const wordExists = wordList.some(w => w.word.toLowerCase() === originalWord.toLowerCase());

    if (wordExists) {
        console.log(`Word "${originalWord}" already exists.`);
        return;
    }

    // Provide immediate UI feedback
    if (settings["animationToggle"]) {
        animateWordToToolbar(originalWord, rect);
    }
    showTemporaryHighlightWithLoader(originalWord);

    // Perform saving and translation in the background
    saveWordToDictionary(originalWord).catch((error) => {
        console.error("Error saving word:", error);
        removeTemporaryHighlight(originalWord);
        // A trial refusal gets the full card, and ONLY the card. Both surfaces
        // are `position: fixed; top: 20px; right: 20px`, so raising them
        // together stacked one directly on top of the other -- the overlap in
        // the #49 bug report.
        if (error?.lazylexReason === TRIAL_EXPIRED_REASON) {
            showTrialEndedNotification(error.message, error.lazylexEntitlement);
            return;
        }
        showContentNotification(error?.message || "Unable to save this word.", "error");
    });
}

// Replace saveWordToDictionary to use local storage and GPT API for translation
async function saveWordToDictionary(word) {
    console.log('[LazyLexExt] saveWordToDictionary called with:', word);

    // There is no client-side pre-flight check any more (issue #49).
    //
    // The old one asked the background script whether a locally-computed
    // freemium limit of 5 words/day had been hit. That limit no longer exists
    // in the product, and the client was never in a position to evaluate it
    // anyway: trial state lives in `users/{uid}/private/entitlement`, which
    // firestore.rules denies to every client.
    //
    // Access is decided where it can be enforced -- inside the callable, which
    // refuses with `reason: 'trial-expired'`. That refusal arrives through
    // translateWithTAS below and is handled by runLogic's catch.

    const { words } = await chrome.storage.local.get({ words: [] });
    const baseWord = (word || '').trim().toLowerCase();
    if (!baseWord) {
        throw new Error("Select a word before saving.");
    }

    const tr = await translateWithTAS(baseWord, settings["languageCode"] || "uk");
    const translation = normalizeTranslationCase(tr.translation);
    if (!translation) {
        throw new Error("LazyLex did not return a translation. Please try again.");
    }
    const synonyms = Array.isArray(tr.synonyms) ? tr.synonyms : [];
    const examples = Array.isArray(tr.examples) ? tr.examples : [];
    let newId = Date.now();
    const ids = new Set((words || []).map(w => Number(w.id)));
    while (ids.has(newId)) newId += 1;
    const newWord = {
        id: newId,
        word: baseWord,
        translation,
        dateAdded: Date.now(),
        status: "new",
        learned: false,
        encounterCount: 0,
        synonyms,
        examples
    };

    const response = await chrome.runtime.sendMessage({
        action: "persistWord",
        word: newWord
    });
    if (!response?.success) {
        throw new Error(response?.error?.message || "Unable to save the word.");
    }

    // The current page updates immediately; the background notification keeps
    // other extension surfaces synchronized.
    addHighlightForWord(response.word || newWord);
    return response.word || newWord;
}

// Implement translateWithTAS by delegating to Firebase callable function (minimal change)
async function translateWithTAS(word, targetLang) {
    try {
        console.log('[LazyLexExt] translateWithTAS request', { word, targetLang });
        const response = await chrome.runtime.sendMessage({
            action: 'translateWord',
            word,
            targetLanguage: targetLang || 'uk'
        });
        if (response && response.success && response.result && response.result.translation) {
            console.log('[LazyLexExt] translateWithTAS success', { word, translation: response.result.translation, synonymsCount: (response.result.synonyms||[]).length });
            return response.result;
        }
        // Carry the machine-readable refusal across the Error boundary.
        // `message` alone cannot be branched on: an expired trial and a 500
        // both arrive as a string, and they deserve different UI.
        const failure = new Error(response?.error?.message || response?.error || 'Translate failed');
        failure.lazylexReason = response?.error?.reason || null;
        failure.lazylexEntitlement = response?.error?.entitlement || null;
        throw failure;
    } catch (e) {
        console.warn('[LazyLexExt] translateWithTAS failed:', e?.message || e);
        throw e;
    }
}

// The refusal `lib/entitlement.js` names when the trial window has closed.
const TRIAL_EXPIRED_REASON = 'trial-expired';

// Was `showSubscriptionLimitNotification` (issue #49).
//
// It announced "You've reached your daily limit of 5 words" -- a limit the
// product no longer has, raised by a check the client should never have been
// making. What replaces it fires only when the SERVER refuses, and says the
// one true thing: the trial is over.
//
// Deliberately not auto-dismissed. The old card vanished after 8 seconds,
// which is fine for "something went wrong" and wrong for "your access just
// ended, here is how to restore it".
function showTrialEndedNotification(serverMessage, entitlement) {
    // Never show this alongside the transient toast -- they occupy identical
    // fixed coordinates and would overlap.
    document.getElementById('lazylex-status-notification')?.remove();

    const existingNotification = document.getElementById('lazylex-limit-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'lazylex-limit-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #ff9d7b, #e17e5d);
        color: white;
        padding: 16px 20px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(255, 157, 123, 0.4);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 600;
        max-width: 320px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        animation: slideInRight 0.3s ease-out;
    `;

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px";

    const title = document.createElement("div");
    title.style.cssText = "font-size:16px;font-weight:700";
    title.textContent = "Your free trial has ended";

    const closeButton = document.createElement("button");
    closeButton.id = "lazylex-close-notification";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Dismiss notification");
    closeButton.style.cssText = "background:none;border:none;color:white;cursor:pointer;font-size:18px;padding:0;width:44px;height:44px";
    closeButton.textContent = "×";

    const description = document.createElement("div");
    description.style.cssText = "margin-bottom:12px;opacity:.9;line-height:1.4";
    // Prefer the server's wording: it is the side that knows whether this is a
    // plain expiry or an expiry after an extension was already used.
    description.textContent = String(serverMessage || "").trim()
        || "Your 7-day free trial has ended. Subscribe to keep translating.";

    const upgradeButton = document.createElement("button");
    upgradeButton.id = "lazylex-upgrade-btn";
    upgradeButton.type = "button";
    upgradeButton.style.cssText = "background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);color:white;padding:10px 16px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;transition:all .2s ease;width:100%;min-height:44px";
    upgradeButton.textContent = "Subscribe";

    header.append(title, closeButton);
    notification.append(header, description, upgradeButton);

    // Add animation styles
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        #lazylex-upgrade-btn:hover {
            background: rgba(255, 255, 255, 0.3) !important;
            transform: translateY(-1px);
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Add event listeners
    document.getElementById('lazylex-close-notification').addEventListener('click', () => {
        notification.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
    });

    document.getElementById('lazylex-upgrade-btn').addEventListener('click', () => {
        window.open('https://lazylex.com/#/pricing', '_blank');
        notification.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
    });

    // No auto-dismiss timer. See the note on this function: the user has just
    // lost access, and a card that removes itself after 8 seconds reads as a
    // glitch rather than as a state. It closes on × or on Subscribe.
}

function removeTemporaryHighlight(text) {
    const normalizedText = String(text || "").toLocaleLowerCase();
    const parentsToNormalize = new Set();
    document.querySelectorAll(".highlight-wrapper:not([data-word-id])").forEach((wrapper) => {
        if (String(wrapper.dataset.originalText || "").toLocaleLowerCase() !== normalizedText) {
            return;
        }
        const parent = wrapper.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(wrapper.dataset.originalText || ""), wrapper);
            parentsToNormalize.add(parent);
        }
    });
    parentsToNormalize.forEach((parent) => parent.normalize());
}

function showContentNotification(message, type = "info") {
    const existing = document.getElementById("lazylex-status-notification");
    if (existing) {
        existing.remove();
    }

    const notification = document.createElement("div");
    notification.id = "lazylex-status-notification";
    notification.setAttribute("role", type === "error" ? "alert" : "status");
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        max-width: 340px;
        padding: 14px 18px;
        color: white;
        background: ${type === "error" ? "#b42318" : type === "success" ? "#1a7f45" : "#344054"};
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
        z-index: 999999;
        font: 600 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;
    notification.textContent = String(message || "LazyLex operation failed.");
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
}

// Sentence selection (issues #28, #49)
//
// Sentences never touch the shared word/phrase translation flow
// (translateWithTAS/translateWord) and are stored privately per-account --
// see background.js's translateSentence handler and
// persistSentenceMutation/deleteSentenceMutation.
//
// The premium upsell card was deleted here (issue #49). It announced that
// saving and translating full sentences was a Premium feature and that word
// lookups stayed free. That describes a product that no longer exists: the
// freemium split is gone, #28 was closed for that reason, and
// translateSentence server-side runs the same trial gate as translateWord.
// The card was refusing a feature the backend would have served.
//
// An ended trial now shows showTrialEndedNotification, the same card a refused
// word gets -- one explanation of one account state rather than a separate
// upsell per feature.

function describeSentenceError(error) {
    const code = error?.code || "";
    // The `entitlement` / 403 branch that returned null is gone (issue #49).
    // It existed to tell the caller "show the Premium upsell instead of an
    // error". There is no premium tier to upsell to, and an ended trial is
    // matched by `reason`, not by a status code.
    if (code === "validation" || code.includes("400") || code.includes("413")) {
        return error?.message || `Sentences are limited to ${SENTENCE_MAX_LENGTH} characters.`;
    }
    if (code === "rate_limit" || code.includes("429")) {
        return "You've reached today's sentence limit. Try again tomorrow.";
    }
    if (code === "api/timeout" || code === "api/network") {
        return "Unable to reach LazyLex. Check your connection and try again.";
    }
    return "Unable to translate this sentence right now. Please try again.";
}

async function handleSentenceSelection(rawText) {
    const text = String(rawText || "").trim();
    if (!text) {
        return;
    }

    if (text.length > SENTENCE_MAX_LENGTH) {
        showContentNotification(
            `Sentences are limited to ${SENTENCE_MAX_LENGTH} characters. This selection is ${text.length}.`,
            "error"
        );
        return;
    }

    // No entitlement pre-check (issue #49). Sentences are not a premium
    // feature any more -- #28 was closed when the product moved to a trial
    // where everything is open until it ends -- and `translateSentence`
    // server-side runs exactly the same `requireAccess` trial gate as
    // `translateWord`. Checking here refused a feature the backend would have
    // served.

    showContentNotification("Translating sentence…", "info");

    try {
        const response = await chrome.runtime.sendMessage({
            action: "translateSentence",
            text,
            targetLanguage: settings["languageCode"] || "uk"
        });

        if (!response?.success) {
            const error = response?.error;
            // The only entitlement refusal left is an ended trial, and it gets
            // the same card as a refused word -- one explanation of one state,
            // not a per-feature upsell.
            if (error?.reason === TRIAL_EXPIRED_REASON) {
                showTrialEndedNotification(error.message, error.entitlement);
                return;
            }
            showContentNotification(describeSentenceError(error), "error");
            return;
        }

        showContentNotification("Sentence saved to your private list.", "success");
    } catch (error) {
        showContentNotification(describeSentenceError({ code: "api/network" }), "error");
    }
}

function animateWordToToolbar(selectedText, rect) {
    if (!rect) return;

    const floatingWord = document.createElement("span");
    floatingWord.textContent = selectedText;
    floatingWord.style.position = "fixed";
    floatingWord.style.zIndex = "999999";
    floatingWord.style.background = "#ff6b35";
    floatingWord.style.border = "1px solid #3A8FC9FF";
    floatingWord.style.borderRadius = "5px";
    floatingWord.style.left = `${rect.left}px`;
    floatingWord.style.top = `${rect.top}px`;
    floatingWord.style.transition = "top 0.5s linear, left 0.5s linear";

    document.body.appendChild(floatingWord);

    setTimeout(() => {
        floatingWord.style.left = "95%";
        floatingWord.style.top = "5px";
    }, 50);

    setTimeout(() => {
        floatingWord.remove();
    }, 550);
}

// Highlighting/clearing highlighting saved words

function clearHighlighting() {
    // Wrappers are about to be replaced by plain text, so any control anchored
    // to one has to go first -- otherwise it is left floating over a word that
    // no longer exists. This covers every re-highlight route (the exclusion
    // toggle, the wordsChanged reload/clear broadcasts, yt-navigate-start and
    // resyncHighlightsForCurrentPage). It is a no-op when nothing is open.
    dismissActiveWidget();

    const wrappers = document.querySelectorAll('span.highlight-wrapper');
    const parentsToNormalize = new Set();

    wrappers.forEach(wrapper => {
        const parent = wrapper.parentNode;
        if (parent) {
            const originalText = wrapper.dataset.originalText || '';
            parent.replaceChild(document.createTextNode(originalText), wrapper);
            parentsToNormalize.add(parent);
        }
    });

    parentsToNormalize.forEach(parent => parent.normalize());
}

function disableHighlightingDisplay() {
    document.querySelectorAll('span.highlight-wrapper').forEach(wrapper => {
        const highlighted = wrapper.querySelector('.highlighted-word');
        const translation = wrapper.querySelector('.translation');
        if (highlighted) {
            highlighted.classList.remove('highlighted-word', 'animate-border', 'animate-background');
        }
        if (translation) {
            translation.classList.remove('translation');
        }
    });
}

function showTemporaryHighlightWithLoader(text) {
    if (!extensionEnabledForSite) {
        return;
    }

    const textNodes = Array.from(findTextNodes(document.body));
    const lowerCaseText = text.toLowerCase();
    const replacements = [];

    textNodes.forEach(node => {
        if (node.parentNode.closest('.highlight-wrapper')) {
            return;
        }

        if (node.nodeValue.toLowerCase().includes(lowerCaseText)) {
            const fragment = document.createDocumentFragment();
            const parts = node.nodeValue.split(new RegExp(`(${escapeRegExp(text)})`, 'gi'));

            parts.forEach(part => {
                if (part.toLowerCase() === lowerCaseText) {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'highlight-wrapper';
                    wrapper.dataset.originalText = part;

                    const highlightedSpan = document.createElement("span");
                    highlightedSpan.classList.add("highlighted-word");
                    highlightedSpan.textContent = part;

                    const loader = document.createElement('span');
                    loader.className = 'translation-loader';

                    wrapper.appendChild(highlightedSpan);
                    wrapper.appendChild(loader);
                    fragment.appendChild(wrapper);
                } else {
                    fragment.appendChild(document.createTextNode(part));
                }
            });
            replacements.push({ originalNode: node, newFragment: fragment });
        }
    });

    replacements.forEach(rep => {
        rep.originalNode.parentNode.replaceChild(rep.newFragment, rep.originalNode);
    });
}

function addHighlightForWord(word) {
    if (!extensionEnabledForSite) {
        // Saving a word from an excluded page still works (the user asked
        // for it); it just must not paint anything here. (#48 AC4)
        return;
    }

    if (word?.status === "learned" || word?.learned === true || Number(word?.encounterCount) > 200) {
        return;
    }

    // First, update any existing temporary highlight wrappers
    const existingWrappers = document.querySelectorAll('.highlight-wrapper');
    existingWrappers.forEach(wrapper => {
        if (!wrapper.dataset.wordId && wrapper.dataset.originalText.toLowerCase() === word.word.toLowerCase()) {
            const loader = wrapper.querySelector('.translation-loader');
            if (loader) loader.remove();

            const translationNode = document.createElement("span");
            translationNode.classList.add("translation");
            translationNode.textContent = `[${normalizeTranslationCase(word.translation)}]`;
            wrapper.appendChild(translationNode);

            wrapper.dataset.wordId = word.id;

            const highlightedSpan = wrapper.querySelector('.highlighted-word');
            if (highlightedSpan) {
                applyFrequencyTier(highlightedSpan, word);
                requestAnimationFrame(() => {
                    highlightedSpan.classList.add("animate-border");
                });

                setTimeout(() => {
                    highlightedSpan.classList.add("animate-background");
                }, 10);
            }
        }
    });

    // Then, scan the entire page for new instances of this word and highlight them
    const textNodes = Array.from(findTextNodes(document.body));
    const targetWord = word.word.toLowerCase();
    const translations = { [targetWord]: word };
    recordEncounterCounts([word], textNodes).catch((error) => {
        console.warn("Unable to record word encounters:", error?.message || error);
    });

    textNodes.forEach((node) => {
        if (node.nodeValue.toLowerCase().includes(targetWord) && !node.parentNode.closest('.highlight-wrapper')) {
            replaceTextNode(node, [targetWord], translations);
        }
    });

    if (!settings.highlightingEnabled) {
        disableHighlightingDisplay();
    }
}

function updateHighlightsForWord(word) {
    const wrappers = document.querySelectorAll(`.highlight-wrapper[data-word-id="${word.id}"]`);
    wrappers.forEach(wrapper => {
        const translationSpan = wrapper.querySelector('.translation');
        if (translationSpan) {
            translationSpan.textContent = `[${normalizeTranslationCase(word.translation)}]`;
            translationSpan.style.display = ''; // Ensure span is visible
        }
    });
}

function removeHighlightsForWord(word) {
    // The word is going away (deleted here, from the popup, or reclassified as
    // learned). Any control anchored to one of its wrappers goes with it (#51).
    dismissActiveWidget();

    const wrappers = document.querySelectorAll(`.highlight-wrapper[data-word-id="${word.id}"]`);
    const parentsToNormalize = new Set();
    wrappers.forEach(wrapper => {
        const parent = wrapper.parentNode;
        if (parent) {
            const originalText = wrapper.dataset.originalText || '';
            parent.replaceChild(document.createTextNode(originalText), wrapper);
            parentsToNormalize.add(parent);
        }
    });
    parentsToNormalize.forEach(parent => parent.normalize());
}

function replaceTextNode(node, targetWords, translations) {
    const fragment = document.createDocumentFragment();
    const escapedWords = targetWords
        .filter(Boolean)
        .map(escapeRegExp)
        .sort((left, right) => right.length - left.length);
    if (escapedWords.length === 0) {
        return;
    }
    const parts = node.nodeValue.split(new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi'));

    if (parts.length <= 1) {
        return; // No matches
    }

    parts.forEach(part => {
        const lowerPart = part.toLowerCase();
        if (targetWords.includes(lowerPart)) {
            const wrapper = document.createElement('span');
            wrapper.className = 'highlight-wrapper';
            wrapper.dataset.originalText = part;
            wrapper.dataset.wordId = translations[lowerPart].id;

            const highlightedSpan = document.createElement("span");
            highlightedSpan.classList.add("highlighted-word");
            highlightedSpan.textContent = part;
            applyFrequencyTier(highlightedSpan, translations[lowerPart]);

            requestAnimationFrame(() => {
                highlightedSpan.classList.add("animate-border");
            });

            setTimeout(() => {
                highlightedSpan.classList.add("animate-background");
            }, 10);

            wrapper.appendChild(highlightedSpan);

            const translationNode = document.createElement("span");
            translationNode.classList.add("translation");
            translationNode.textContent = `[${normalizeTranslationCase(translations[lowerPart].translation)}]`;
            wrapper.appendChild(translationNode);
            fragment.appendChild(wrapper);
        } else {
            fragment.appendChild(document.createTextNode(part));
        }
    });

    node.parentNode.replaceChild(fragment, node);
}

function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Where LazyLex refuses to render (#50).
//
// READ THIS BEFORE EDITING THE LIST.
//
// The distinction this list draws is *not* "interactive tag vs. not". It is
// **prose vs. chrome**: running text a learner reads, versus the controls
// they operate. Highlighting a control is actively harmful -- the injected
// "[translation]" span widens the control, wraps its label and drops a second
// click target on top of the first. The reported case was the
// developer.chrome.com sidebar rendering "Before[перед] you publish".
//
// The original list only named controls as HTML wrote them in 2005. Every
// modern component library (Material UI, Ant Design, Bootstrap, Radix)
// composes its controls out of generic <div>/<span> elements carrying ARIA
// roles, so all of them slipped straight through. The ARIA groups below are
// the composed equivalents of the native tags in the first group.
//
// LINK POLICY -- deliberate, do not "fix" it by adding `a` here:
//   A plain `<a href>` in body prose stays ELIGIBLE. Links inside article
//   text are exactly where a learner meets useful vocabulary, and #11
//   deliberately built capture-phase click isolation so a highlighted word
//   inside a link shows the LazyLex controls without navigating. Excluding
//   all anchors would silently undo that feature.
//   Navigation links are still excluded -- not because they are anchors, but
//   because they sit inside `nav` / `[role="navigation"]` / a menu / a
//   toolbar, which is the chrome half of the distinction.
//   The only anchors this list can reach are ones that are also composed
//   controls (e.g. `<a role="menuitem">`), which is correct.
//
// The last group catches bespoke focusable widgets that declare no role at
// all: anything the author put in the tab order is a control. `a[href]` is
// carved back out of it so a prose link that also carries an explicit
// tabindex keeps working, per the policy above.
//
// Role values are a token list, so `~=` is used rather than `=`; a
// `role="button link"` element is still a button. `menu*` and `tab*` are
// enumerated instead of prefix-matched on purpose: `role="tabpanel"` is a
// *content* container whose text is prose and must stay eligible.
//
// If this turns out to be too coarse, the fallback discussed in #50 is to
// decide by ancestry instead: a link whose nearest block ancestor is a `<p>`
// or `<li>` in an article is prose; one inside a `<nav>` or a toolbar is
// chrome.
const NON_PROSE_SELECTOR = [
    // Native controls, non-text content and editable regions.
    "script, style, noscript, textarea, input, select, option, button",
    "code, pre, svg, math, iframe, canvas, video, audio",
    "[contenteditable]:not([contenteditable='false'])",

    // Interactive containers that carry no ARIA role of their own.
    // `summary` is the clickable half of a <details>; clicking a `label`
    // activates its control.
    "nav, menu, summary, label",

    // ARIA-composed controls.
    // Note the absence of [role="link"]: it is the ARIA spelling of a plain
    // hyperlink, so it follows the same prose policy as <a href>.
    '[role~="button"], [role~="checkbox"], [role~="radio"]',
    '[role~="switch"], [role~="slider"], [role~="spinbutton"], [role~="searchbox"]',
    '[role~="combobox"], [role~="listbox"], [role~="option"]',
    '[role~="menu"], [role~="menubar"], [role~="menuitem"]',
    '[role~="menuitemcheckbox"], [role~="menuitemradio"]',
    '[role~="tab"], [role~="tablist"]',
    '[role~="navigation"], [role~="toolbar"], [role~="tree"], [role~="treeitem"]',
    '[role~="grid"], [role~="gridcell"], [role~="dialog"], [role~="alertdialog"]',

    // Anything that opens a popup, whatever it is built from.
    "[aria-haspopup]",

    // Bespoke focusable widgets with no role -- but never a plain prose link.
    '[tabindex]:not([tabindex="-1"]):not(a[href])'
].join(", ");

function isEligibleTextNode(node) {
    if (!node?.parentElement || !node.nodeValue || /^\s*$/.test(node.nodeValue)) {
        return false;
    }

    const parent = node.parentElement;
    if (parent.closest(NON_PROSE_SELECTOR)) {
        return false;
    }

    // LazyLex's own DOM is never prose to be highlighted.
    //
    // The control ids used to carry this on their own. Since #52 the controls
    // live in a shadow root, and a TreeWalker over light DOM does not descend
    // into one -- so their text is unreachable from here by construction.
    // `#lazylex-controls` (the shadow host) replaces them: it is the only part
    // of the control layer that still exists in light DOM, and excluding it
    // keeps the guarantee explicit rather than relying on walker semantics.
    // The notification ids stay, because notifications are still light DOM.
    return !parent.closest(
        ".highlight-wrapper, #lazylex-controls, .lazylex-control, #lazylex-limit-notification, #lazylex-status-notification"
    );
}

function findTextNodes(element) {
    if (!element) {
        return [];
    }

    const nodes = [];
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                return isEligibleTextNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        }
    );

    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }
    return nodes;
}

function getFrequencyTier(encounterCount) {
    const count = Number(encounterCount) || 0;
    if (count > 200) return "learned";
    if (count > 120) return "retained";
    if (count > 50) return "familiar";
    return "new";
}

function applyFrequencyTier(highlightedSpan, word) {
    highlightedSpan.classList.remove(
        "lazylex-frequency-new",
        "lazylex-frequency-familiar",
        "lazylex-frequency-retained"
    );
    if (settings.frequencyColoringEnabled === false) {
        return;
    }

    const tier = getFrequencyTier(word?.encounterCount);
    if (tier !== "learned") {
        highlightedSpan.classList.add(`lazylex-frequency-${tier}`);
    }
}

function countWordOccurrences(textNodes, word) {
    const expression = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    return textNodes.reduce((count, node) => {
        const matches = node.nodeValue.match(expression);
        return count + (matches ? matches.length : 0);
    }, 0);
}

async function recordEncounterCounts(words, textNodes) {
    const increments = new Map();
    words.forEach((word) => {
        const id = Number(word?.id);
        if (!Number.isSafeInteger(id) || countedWordIdsOnPage.has(id)) {
            return;
        }

        const count = countWordOccurrences(textNodes, String(word.word || ""));
        countedWordIdsOnPage.add(id);
        if (count > 0) {
            increments.set(id, count);
        }
    });

    if (increments.size === 0) {
        return;
    }

    const { words: storedWords = [] } = await chrome.storage.local.get({ words: [] });
    const updatedWords = storedWords.map((word) => {
        const increment = increments.get(Number(word.id));
        if (!increment) {
            return word;
        }

        const encounterCount = Number(word.encounterCount || 0) + increment;
        const learned = encounterCount > 200;
        return {
            ...word,
            encounterCount,
            learned,
            status: learned ? "learned" : (word.status || "new"),
            learnedDate: learned ? (word.learnedDate || new Date().toISOString()) : word.learnedDate,
            lastUpdated: Date.now()
        };
    });
    await chrome.storage.local.set({ words: updatedWords });
}

async function highlightWords(words) {
    if (!extensionEnabledForSite) {
        // Single chokepoint for the full-page pass: every caller
        // (applySettings, the wordsChanged "reload" branch, the YouTube SPA
        // resync, the initial bootstrap) funnels through here, so an
        // excluded site cannot be re-highlighted by any of them. Returning
        // before recordEncounterCounts also keeps encounter statistics from
        // counting pages the user chose to opt out of.
        return;
    }

    const visibleWords = (Array.isArray(words) ? words : []).filter((word) => (
        word
        && word.word
        && word.status !== "learned"
        && word.learned !== true
        && Number(word.encounterCount || 0) <= 200
    ));
    const targetWords = visibleWords.map((t) => t.word.toLowerCase());
    const textNodes = findTextNodes(document.body);

    const translations = visibleWords.reduce((result, item) => {
        const key = item.word.toLowerCase();
        result[key] = item;
        return result;
    }, {});

    await recordEncounterCounts(visibleWords, textNodes);

    textNodes.forEach((node) => {
        if (targetWords.some((targetWord) => node.nodeValue.toLowerCase().includes(targetWord))) {
            replaceTextNode(node, targetWords, translations);
        }
    });
}

function handleExtensionStateChange(enabled) {
    // Update the flag *before* touching the DOM: highlightWords() reads it,
    // so setting it late would let the page re-highlight itself.
    setExtensionEnabledForSite(enabled);

    if (extensionEnabledForSite) {
        clearHighlighting();
        chrome.storage.local.get(["words"]).then((result) => {
            if (result.words !== undefined && result.words.length > 0) {
                highlightWords(result.words);
            }
        });

        console.log("Extension is enabled for this site.");
    } else {
        clearHighlighting();
        // A control opened a moment before the site was excluded would
        // otherwise be left floating over a page LazyLex is no longer part of.
        // #48's requirement was that translations go without a page reload;
        // the same has to be true of the controls.
        dismissActiveWidget();
        console.log("Extension is disabled for this site.");
    }
}

// Resolves the exclusion state for *this* tab from the background service
// worker. Returns a promise so the bootstrap can await it before the first
// highlight pass instead of racing it.
function checkInitialExtensionState() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: "checkExtensionState" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn(
                        "[LazyLexExt] Unable to read the extension state:",
                        chrome.runtime.lastError.message
                    );
                    resolve(setExtensionEnabledForSite(true));
                    return;
                }
                resolve(setExtensionEnabledForSite(response?.enabled));
            });
        } catch (error) {
            console.warn("[LazyLexExt] Unable to read the extension state:", error?.message || error);
            resolve(setExtensionEnabledForSite(true));
        }
    });
}

// Event listeners and initialization

function applySettings(newSettings) {
    settings = {...settings, ...newSettings};

    // Apply visual changes based on settings
    updateHighlightColors(settings.highlightColor, settings.translationColor);

    chrome.storage.local.get(["words"]).then((result) => {
        const words = result.words || [];
        clearHighlighting();
        // On an excluded site the clear above is the whole job: changing a
        // setting from the popup must not bring highlights back. (#48 AC5)
        if (!extensionEnabledForSite) {
            return;
        }
        if (words.length > 0) {
            highlightWords(words);
            if (!settings.highlightingEnabled) {
                disableHighlightingDisplay();
            }
        }
    });
}

function loadInitialSettings() {
    chrome.storage.local.get([
        "translateTo",
        "animationToggle",
        "sentenceCounter",
        "highlightingEnabled",
        "highlightColor",
        "translationColor",
        "frequencyColoringEnabled"
    ], (items) => {
        const initialSettings = {
            languageCode: items.translateTo || "uk",
            languageFull: "Ukrainian",
            animationToggle: items.animationToggle !== undefined ? items.animationToggle === "true" : true,
            sentenceCounter: items.sentenceCounter || 1,
            highlightingEnabled: items.highlightingEnabled !== undefined ? items.highlightingEnabled : true,
            highlightColor: items.highlightColor,
            translationColor: items.translationColor,
            frequencyColoringEnabled: items.frequencyColoringEnabled !== false
        };
        applySettings(initialSettings);
    });
}

document.addEventListener("keydown", function (event) {
    if (event.ctrlKey && event.shiftKey && event.code === "KeyS") {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            runLogic(selectedText);
            console.log(`Saved: ${selectedText}`);
        }
    }
});

document.addEventListener("mouseup", function (event) {
    // Cleared first so a flag can never survive into a later, unrelated
    // gesture -- e.g. if a gesture ended without the trailing click arriving.
    selectionGestureOpenedControl = false;

    // A mouseup inside one of our own controls is that control's business
    // (clicking "+", the delete button, or into the edit input). Dismissing
    // here would destroy the control before its own click handler ran.
    // composedPath(), not event.target: the controls are in a shadow root and
    // event.target is retargeted to the host by the time we see it (#52).
    if (isWidgetControlEvent(event)) {
        return;
    }

    // Any interaction with the page closes whatever is open, before a new
    // selection can add a second control somewhere else (#51, criterion 3).
    // mouseup runs ahead of click, so the delete/edit paths below still get a
    // clean slate to open into.
    dismissActiveWidget();

    // Nothing may be OFFERED on an excluded site either.
    //
    // #48 gated every path that RENDERS -- highlightWords, addHighlightForWord,
    // showTemporaryHighlightWithLoader, resyncHighlightsForCurrentPage -- so an
    // excluded page stopped showing translations. It did not gate this handler,
    // so selecting text still produced the "+" button. Excluding a site means
    // LazyLex is absent from it, not that it renders nothing while still
    // reaching for the user's selection.
    //
    // Placed after dismissActiveWidget() deliberately: a control already open
    // when the site is excluded must still be torn down.
    if (!extensionEnabledForSite) {
        return;
    }

    if (event.target.tagName !== "BUTTON") {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        if (selectedText) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const selectionType = classifySelectionType(selectedText);

            const button = document.createElement("button");
            button.type = "button";
            button.className = "action-button";

            if (selectionType === "sentence") {
                // Distinct control: sentence saving has its own backend
                // contract and must never fall through to the word flow.
                button.id = "add-new-sentence";
                button.innerText = "S+";
                // No longer "(Premium)" -- #28 was closed and the server
                // gate is the trial, same as for words (#49, #62).
                button.title = "Save sentence";
                button.setAttribute("aria-label", "Save sentence");
                button.addEventListener("click", function () {
                    console.log('[LazyLexExt] sentence button clicked, length:', selectedText.length);
                    handleSentenceSelection(selectedText);
                    window.getSelection().empty();
                    window.getSelection().removeAllRanges();
                    dismissActiveWidget();
                });
            } else {
                button.id = "add-new-word";
                button.innerText = "+";
                button.addEventListener("click", function () {
                    console.log('[LazyLexExt] + button clicked, selectedText:', selectedText);
                    runLogic(selectedText, rect);
                    window.getSelection().empty();
                    window.getSelection().removeAllRanges();
                    dismissActiveWidget();
                });
            }

            // Registered before it is attached, so the dismissal sweep inside
            // setActiveWidget cannot remove the button we are about to add.
            setActiveWidget({
                type: selectionType === "sentence" ? "add-sentence" : "add-word",
                target: button,
                dismiss: () => button.remove()
            });

            // Viewport coordinates (clientX/clientY), because every control is
            // now placed in the fixed shadow layer. This is also what fixes
            // "S+" landing in body flow: it no longer depends on a per-control
            // `position` declaration existing in styles.css (#52, criterion 7).
            mountControl(button, {
                left: event.clientX + 20,
                top: event.clientY + 20,
                width: ACTION_BUTTON_SIZE,
                height: ACTION_BUTTON_SIZE
            });

            // The click terminating this same gesture is still to come; tell
            // the click handler to leave this control alone (#55).
            selectionGestureOpenedControl = true;
        }
    }
});

// A highlighted word can live inside a link. Guard both mousedown and click
// so the link's own handlers (and default navigation) never fire ahead of
// the delete/edit controls - preventDefault() alone on click is not enough
// once the event has already reached other listeners via bubbling.
document.addEventListener("mousedown", (e) => {
    const wrapper = e.target.closest('.highlight-wrapper');
    if (wrapper?.closest("a[href]")) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

document.addEventListener("click", (e) => {
    // Clicks inside an open control (the edit input, its save button, the
    // delete button) belong to that control. Without this the click would be
    // read as "clicked the page" and dismiss the control the user just
    // pressed. composedPath(), not e.target -- see isWidgetControlEvent (#52).
    if (isWidgetControlEvent(e)) {
        return;
    }

    const wrapper = e.target.closest('.highlight-wrapper');

    // A highlighted word can live inside a link. Keep the first click on the
    // highlight available for LazyLex controls instead of navigating away.
    if (wrapper?.closest("a[href]")) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Handle click on translation to edit. showEditUI() dismisses whatever is
    // open (including the delete button raised by the previous click on this
    // same word) before opening the field -- #51, criterion 1.
    if (e.target.classList.contains('translation') && wrapper) {
        showEditUI(e.target, wrapper.dataset.wordId);
        // Prevent delete button from showing up when we click to edit
        return;
    }

    // This click is the tail of the selection gesture that just opened the
    // add-word control, not a new interaction. Returning here keeps that one
    // control open and, when the selection sits on an already-highlighted
    // word, stops the delete path below from opening a second one -- which
    // would break #51's "one control at a time" in the other direction.
    if (selectionGestureOpenedControl) {
        selectionGestureOpenedControl = false;
        return;
    }

    // Any other click on the page closes what is open (#51, criterion 5),
    // whether or not it lands on a highlighted word.
    dismissActiveWidget();

    // This logic shows the delete button when a highlighted word is clicked
    if (!wrapper) return;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "-";
    deleteButton.id = "deleteWordBtn";
    deleteButton.className = "action-button";
    deleteButton.title = "Delete saved word";
    const wrapperRect = wrapper.getBoundingClientRect();

    deleteButton.setAttribute("aria-label", "Delete saved word");
    deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        deleteButton.disabled = true;
        try {
            await deleteWordFromStorage(wrapper.dataset.wordId);
            dismissActiveWidget();
        } catch (error) {
            deleteButton.disabled = false;
            showContentNotification(error?.message || "Unable to delete the word.", "error");
        }
    });

    // Registered before it is attached (see setActiveWidget): opening the
    // delete control closes an open edit field or add button first.
    setActiveWidget({
        type: "delete",
        target: wrapper,
        dismiss: () => deleteButton.remove()
    });

    // Mounted into the shadow layer, so a clipped or overflow-hidden container
    // around the word cannot hide the control -- and no host `button {}` rule
    // can reach it (#52).
    mountControl(deleteButton, {
        left: wrapperRect.right + 4,
        top: wrapperRect.top - DELETE_BUTTON_SIZE - 4,
        width: DELETE_BUTTON_SIZE,
        height: DELETE_BUTTON_SIZE
    });
});

function showEditUI(translationSpan, wordId) {
    // Clicking the translation whose field is already open still toggles it
    // closed, exactly as before -- but "close it" is now the shared dismiss,
    // so the translation is restored the same way from every route.
    const wasEditingThisSpan = activeWidget?.type === "edit" && activeWidget.target === translationSpan;
    dismissActiveWidget();
    if (wasEditingThisSpan) {
        return;
    }

    // The rect is captured before the span is hidden -- hiding it first would
    // collapse it and leave the editor anchored at 0,0.
    const anchorRect = translationSpan.getBoundingClientRect();
    translationSpan.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    const currentTranslation = translationSpan.textContent.slice(1, -1);
    input.value = currentTranslation;
    input.className = 'edit-translation-input';
    input.setAttribute("aria-label", "Edit translation");

    const saveButton = document.createElement('button');
    saveButton.className = 'action-button';
    saveButton.type = "button";
    saveButton.setAttribute("aria-label", "Save translation");
    saveButton.textContent = "✓";

    const editContainer = document.createElement('span');
    editContainer.className = 'edit-translation-container';
    editContainer.appendChild(input);
    editContainer.appendChild(saveButton);

    // Registered before insertion (see setActiveWidget). The teardown is what
    // makes the shared dismiss safe for this surface: it puts the hidden
    // translation back rather than only deleting the container, so no route
    // out of the editor can leave a word without its translation (#51,
    // criterion 7).
    setActiveWidget({
        type: "edit",
        target: translationSpan,
        dismiss: () => {
            editContainer.remove();
            if (translationSpan.style.display === 'none') {
                translationSpan.style.display = '';
            }
        }
    });

    // Mounted into the shadow layer instead of being inserted next to the
    // translation span. In light DOM this field was the control most exposed
    // to the host page -- styles.css gave it no `!important` at all, so any
    // `input {}` rule reshaped it (#52, criterion 3). It is anchored to where
    // the span was rather than flowing after it.
    mountControl(editContainer, {
        left: anchorRect.left,
        top: anchorRect.bottom + 4,
        width: EDIT_INPUT_WIDTH + ACTION_BUTTON_SIZE + 5,
        height: EDIT_CONTAINER_HEIGHT
    });

    // preventScroll: focusing an off-screen input would scroll the page, and
    // scrolling dismisses the control that was just opened.
    input.focus({ preventScroll: true });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveButton.click();
        }
    });

    saveButton.addEventListener('click', async () => {
        const newTranslation = input.value.trim();

        if (newTranslation && wordId) {
            saveButton.disabled = true;
            try {
                await updateWordInStorage(wordId, newTranslation);
            } catch (error) {
                saveButton.disabled = false;
                showContentNotification(error?.message || "Unable to update the translation.", "error");
                return;
            }
        }

        // Closing through the shared dismiss also restores the translation
        // span. The old `editContainer.remove()` relied on the wordsChanged
        // broadcast to un-hide it, so saving an empty value (or a word that
        // had no id) left the translation invisible.
        dismissActiveWidget();
    });
}

// Helper function to update CSS custom properties for highlight colors
function updateHighlightColors(highlightColor, translationColor) {
    if (highlightColor) {
        document.documentElement.style.setProperty('--highlight-color', highlightColor);
    }
    if (translationColor) {
        document.documentElement.style.setProperty('--translation-color', translationColor);
    }
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "saveWordToDictionary") {
        console.log("Received selected text:", request.text);
        runLogic(request.text);
        sendResponse({ status: "success" });
    }
});

chrome.runtime.onMessage.addListener((request) => {
    // The background worker broadcasts this whenever the exclusion list
    // changes, with the value computed for *this* tab's own URL. Without
    // this listener the broadcast went nowhere and handleExtensionStateChange
    // was dead code (#48).
    if (request.action === "extensionStateChanged") {
        console.log('[LazyLexExt] Extension state changed:', request.newValue);
        handleExtensionStateChange(request.newValue);
    }

    if (request.action === "wordsChanged") {
        console.log('[LazyLexExt] Received wordsChanged message', request);
        const { operation, word, words } = request.newValue;

        if (!extensionEnabledForSite) {
            // Adding, updating or reloading words must not repaint an
            // excluded page. Clearing keeps a delete/clear correct too.
            clearHighlighting();
            return;
        }

        switch (operation) {
            case 'add':
                addHighlightForWord(word);
                break;
            case 'update':
                if (word?.status === "learned" || word?.learned === true || Number(word?.encounterCount) > 200) {
                    removeHighlightsForWord(word);
                } else {
                    updateHighlightsForWord(word);
                }
                break;
            case 'delete':
                removeHighlightsForWord(word);
                break;
            case 'reload':
                clearHighlighting();
                highlightWords(words);
                break;
            case 'clear':
                clearHighlighting();
                break;
        }
    }

    if (request.action === "settingsChanged") {
        console.log('[LazyLexExt] Settings changed:', request.settings);
        applySettings(request.settings);
    }
});

// Resolve the exclusion state first, then load settings. loadInitialSettings()
// ends in applySettings(), which triggers the first highlight pass, so the
// state has to be known by then -- otherwise an excluded site paints once and
// only un-paints when the broadcast happens to arrive. (#48)
// Once, at the only moment it can find anything: controls left in light DOM by
// a previous injection of this script. See sweepLegacyLightDomControls.
sweepLegacyLightDomControls();

checkInitialExtensionState().then(() => {
    loadInitialSettings();
});

console.log('[LazyLexExt] Content script loaded');
