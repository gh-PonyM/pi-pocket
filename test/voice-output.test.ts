// Voice output, a drop-in: its server part, the words and the sentences that it reads, and its settings in a tab. The
// words and the sentences come from the browser module's own file, without the app.
import {
    type App,
    say,
    cleanUp,
    newSession,
    openApp,
    owner,
    root,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ConversationId } from "@earendil-works/pi-durable";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import { createHandler } from "../src/server/http.ts";
import type { Web } from "../types/pocket.d.ts";

const chromium = findBrowser();
const real = { skip: chromium === undefined ? "no Chromium on this machine" : false } as const;
const dropIns = join(root, "data", "extensions");
const FILES = join(import.meta.dirname, "voice-output");
const BROWSER = join(FILES, "voice-output", "index.js");
const SERVER = join(FILES, "voice-output.ts");

// ─── The words, the sentences, and the voice ────────────────────────────────

/** The parts of the browser module that need no page. */
type Pieces = {
    spokenWords(text: string, code?: boolean): string[];
    pickVoice(choice: string | undefined, voices: { name: string; lang: string }[]): unknown;
};

let pieces: Pieces;

before(async () => {
    const source = readFileSync(BROWSER, "utf8");
    const file = join(mkdtempSync(join(tmpdir(), "voice-output-")), "index.mjs");

    // The default export needs the app's page. The test needs the parts that find the words, and the voice.
    writeFileSync(
        file,
        `${source.replace("export default function setup(", "export function setup(")}
export { spokenWords, pickVoice };`,
    );
    pieces = (await import(file)) as Pieces;
});

const speech = (text: string, code = false) => pieces.spokenWords(text, code).join(" ");

test("an answer's Markdown becomes its words", () => {
    const said = speech(
        [
            "## Done",
            "",
            "The **build** is ready, and *fast*. See [the log](http://example.invalid/log).",
            "",
            "- first",
            "- second",
            "",
            "| a | b |",
            "| --- | --- |",
            "| 1 | 2 |",
            "",
            "Read `index.js` next \u2014 and that is all!",
        ].join("\n"),
    );

    assert.match(said, /^Done/);
    assert.match(said, /The build is ready, and fast\./);
    assert.match(said, /the log/);
    assert.match(said, /first second/);
    assert.match(said, /table table/, "a table says that it is one");
    assert.match(said, /Read code next and that is all!/);
    assert.ok(!/[*#`|]/.test(said), `no marker is read: ${said}`);
    assert.ok(!said.includes("http"), "a link's address is not read");
    assert.ok(!said.includes("---"), "a table's rule is not read");
});

test("a code block says how many lines it has, or is read", () => {
    const text = [
        "Before.",
        "",
        "```bash",
        "npm test",
        "",
        "npm run build",
        "```",
        "",
        "After.",
    ].join("\n");

    assert.match(speech(text), /Before\. bash code, 2 lines\. After\./);
    assert.match(speech("```\nls\n```"), /^code, 1 line\.$/);
    assert.match(speech(text, true), /Before\. npm test npm run build After\./);
    assert.match(speech("Read `index.js` now."), /Read code now\./);
    assert.match(speech("Read `index.js` now.", true), /Read index\.js now\./);
});

test("a marker from another agent, an image's address, a tag, and an emoji are not read", () => {
    const said = speech(
        "[via PiP] Done ![a chart](http://example.invalid/x.png) <b>bold</b> \u{1F389} #3",
    );

    assert.ok(!said.includes("via"), said);
    assert.ok(!said.includes("example.invalid"), said);
    assert.ok(!said.includes("<b>"), said);
    assert.ok(!said.includes("\u{1F389}"), said);
    assert.match(said, /a chart/);
    assert.match(said, /bold/);
    assert.match(said, /#3/, "a number in front of a # stays one word");
});

test("the words come one sentence at a time, and a long sentence in parts", () => {
    assert.deepEqual(pieces.spokenWords("First one. Second one? Third!"), [
        "First one.",
        "Second one?",
        "Third!",
    ]);
    assert.deepEqual(pieces.spokenWords("**First.** Then more."), ["First.", "Then more."]);

    const long = pieces.spokenWords(`${"word ".repeat(60)}.`);

    assert.ok(long.length > 1, "a long sentence is cut");
    assert.ok(
        long.every((each) => each.length <= 221),
        `each piece is short: ${long.map((each) => each.length).join(",")}`,
    );
    assert.equal(long.join(" "), `${"word ".repeat(60).trim()}.`, "no word goes missing");
});

test("the voice for the owner's choice: best is the first natural English one", () => {
    const voices = [
        { name: "Deutsch", lang: "de-DE" },
        { name: "Google UK English Male", lang: "en-GB" },
        { name: "Microsoft Aria Online (Natural)", lang: "en-US" },
    ];

    assert.deepEqual(pieces.pickVoice("best", voices), voices[2]);
    assert.deepEqual(pieces.pickVoice("Google UK English Male", voices), voices[1]);
    assert.equal(pieces.pickVoice("auto", voices), null);
    assert.equal(pieces.pickVoice("Not a voice", voices), null);
});

// ─── The server part ─────────────────────────────────────────────────────────

/** The server part, in a host of its own: what it adds, and the events that it sends. */
async function load(version = "0.22.0") {
    const added = {
        settings: [] as { name: string; type: string; default: unknown }[],
        clients: [] as unknown[],
        listeners: new Map<string, (each: { conversationId: number }) => void>(),
        sent: [] as { event: string; data: unknown }[],
        disposed: [] as (() => unknown)[],
    };
    const web = {
        settings: (fields: unknown[]) => added.settings.push(...(fields as never[])),
        client: (entry: unknown) => added.clients.push(entry),
        send: (event: string, data: unknown) => added.sent.push({ event, data }),
        onDispose: (dispose: () => unknown) => added.disposed.push(dispose),
    } as unknown as Web;
    const host = {
        pocketVersion: version,
        on: (event: string, listener: (each: { conversationId: number }) => void) => {
            added.listeners.set(event, listener);

            return () => added.listeners.delete(event);
        },
    };
    const module = (await import(SERVER)) as { default: (h: unknown, w: Web) => unknown };

    module.default(host, web);

    return added;
}

test("the server part adds the 2 settings and the browser module, and sends each run's ends", async () => {
    const added = await load();

    assert.deepEqual(
        added.settings.map(({ name }) => name),
        ["voice", "rate"],
    );
    assert.deepEqual(added.clients, ["voice-output"]);

    added.listeners.get("run.started")!({ conversationId: 7 });
    added.listeners.get("run.ended")!({ conversationId: 7 });
    assert.deepEqual(added.sent, [
        { event: "running", data: { session: 7, running: true } },
        { event: "running", data: { session: 7, running: false } },
    ]);

    // A new version of the module hears nothing more.
    for (const dispose of added.disposed) {
        dispose();
    }

    assert.equal(added.listeners.size, 0);
});

test("the server part adds nothing on a Pi Pocket older than 0.22.0", async () => {
    const added = await load("0.21.3");

    assert.deepEqual(added.settings, []);
    assert.deepEqual(added.clients, []);
});

// ─── The page, in a real Chromium ───────────────────────────────────────────

let pi: App | undefined;
let server = undefined as unknown as Server;
let browsers = undefined as unknown as Browsers;
let base = "";
let session = 0 as ConversationId;
let tab = undefined as unknown as Page;

type Page = Awaited<ReturnType<Browsers["open"]>>;

/** The app's page in this tab, with the module's `pocket` kept for the test: the page names it in `globalThis`. */
const VOICE = `.ext-page .voice-output`;

const inPage = async <T>(on: Page, script: string): Promise<T> =>
    JSON.parse(await on.evaluate(script)) as T;

const has = (on: Page, selector: string) =>
    inPage<boolean>(
        on,
        `return JSON.stringify(document.querySelector(${JSON.stringify(selector)}) !== null)`,
    );

before(async () => {
    if (chromium === undefined) {
        return;
    }

    mkdirSync(dropIns, { recursive: true });
    cpSync(join(FILES, "voice-output.ts"), join(dropIns, "voice-output.ts"));
    cpSync(join(FILES, "voice-output"), join(dropIns, "voice-output"), { recursive: true });

    let answers = 0;

    pi = await openApp(
        scriptedModel(() => {
            answers += 1;

            return {
                content: [{ type: "text", text: `Answer ${answers}: the **build** is ready.` }],
                stopReason: "stop",
            } as never;
        }),
    );
    await pi.setExtensionEnabled(owner(pi), "voice-output.ts", true);
    session = await newSession(pi);
    await say(pi, session, "Build it");

    server = createServer(
        createHandler({ app: pi, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browsers = new Browsers({
        dataDir: mkdtempSync(join(root, "voice-output-")),
        load: async () => undefined,
        save: () => {},
    });
    tab = await browsers.open(1, { restore: false });
    await tab.navigate(`${base}/login?token=${encodeURIComponent(pi.config.ownerToken)}`);
    await tab.navigate(`${base}/s/${session}`);
});

after(async () => {
    await browsers?.closeAll({ final: true });
    server?.closeAllConnections();
    server?.close();
    await pi?.close();
    cleanUp();
});

test(
    "its page shows the owner's settings, and new answers waits for voice output",
    real,
    async () => {
        await until(() => has(tab, '.sidebar .rail-ext[title="Voice"]'), "the rail button");
        await tab.click({ selector: '.sidebar .rail-ext[title="Voice"]' });
        await until(() => has(tab, VOICE), "the page");
        const shown = await inPage<string>(
            tab,
            `return JSON.stringify(document.querySelector(".ext-page").innerText)`,
        );

        assert.match(shown, /Voice output/);
        assert.match(shown, /New answers/);
        assert.match(shown, /Code in answers/);
        assert.match(shown, /speed 1×/, "the owner's default speed");
        assert.match(
            shown,
            /when you are the one Pi answers there/,
            "new answers says what it reads",
        );
        assert.equal(
            await inPage<boolean>(
                tab,
                `return JSON.stringify(document.querySelector('.ext-page [role=\\"switch\\"][aria-label=\\"New answers\\"]').disabled)`,
            ),
            true,
            "new answers waits for voice output",
        );
    },
);

test("Read aloud is under each answer", real, async () => {
    await tab.navigate(`${base}/s/${session}`);
    await until(
        async () =>
            (
                await inPage<string[]>(
                    tab,
                    `return JSON.stringify([...document.querySelectorAll(".ext-reply-action")].map((each) => each.textContent.trim()))`,
                )
            ).includes("Read aloud"),
        "Read aloud under the answer",
    );
});
