import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const authSource = await readFile(new URL("../firebase-auth.js", import.meta.url), "utf8");
const errorHandler = authSource.slice(authSource.indexOf("function getReadableAuthError"), authSource.indexOf("function getGoogleAuthToken"));
const context = vm.createContext({ chrome: { runtime: { id: "test-extension-id" } } });
vm.runInContext(errorHandler, context);
const message = (raw) => context.getReadableAuthError(new Error(raw));

test("wrapped OAuth cancellation and network failures keep their actual diagnosis", () => {
    assert.match(message("OAuth2 request failed: user did not approve access"), /cancelled/);
    assert.match(message("OAuth2 request failed: network error"), /connection/);
    assert.match(message("OAuth2 request failed: access_denied"), /access was denied/);
    assert.doesNotMatch(message("OAuth2 request failed: unexpected provider error"), /not configured/);
});

test("specific OAuth configuration failures still identify the extension", () => {
    for (const reason of ["bad client id", "invalid_client", "unauthorized_client", "redirect_uri_mismatch"]) {
        assert.match(message("OAuth2 request failed: " + reason), /not configured.*test-extension-id/);
    }
});

test("both local build commands select the dedicated QA OAuth client", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const localClient = "318380438947-fk505l37ves52tfv6pvklrcanh7fhq6b.apps.googleusercontent.com";
    assert.ok(pkg.scripts.build.includes("--oauth-client-id=" + localClient));
    assert.equal(pkg.scripts["build:local"], "npm run build --");
});

test("an explicit OAuth override wins over the default client", async () => {
    const source = await readFile(new URL("../scripts/build-extension.mjs", import.meta.url), "utf8");
    const argumentReader = source.match(/function readArgument\(name\) \{[\s\S]*?\n}/)?.[0];
    assert.ok(argumentReader);
    const buildContext = vm.createContext({ process: { argv: [
        "node", "build-extension.mjs",
        "--oauth-client-id=default-client",
        "--oauth-client-id=explicit-client"
    ] } });
    vm.runInContext(argumentReader, buildContext);
    assert.equal(buildContext.readArgument("oauth-client-id"), "explicit-client");
    assert.equal(buildContext.readArgument("extension-key"), null);
});
