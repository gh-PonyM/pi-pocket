// The seam that gives a browser module the answer while Pi writes it (`pocket.onAnswer`), in a real
// Chromium: a test module records each answer that the listener gets, and the test reads what it kept.
import {
    type App,
    cleanUp,
    newSession,
    openApp,
    owner,
    root,
    say,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ConversationId } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import { createHandler } from "../src/server/http.ts";

const chromium = findBrowser();
const real = { skip: chromium === undefined ? "no Chromium on this machine" : false } as const;
const dropIns = join(root, "data", "extensions");
const NAME = "on-answer";
// Long enough that the tab sees the answer grow: the scripted model writes 2000 tokens a second.
const ANSWER = Array.from(
    { length: 250 },
    (_, index) => `Part ${index + 1} says that the build is ready.`,
).join(" ");

/** The drop-in's server part: it adds nothing but the browser module. */
const SERVER = `/** A test module for pocket.onAnswer. */
export default function createOnAnswer(host, web) {
    web.client("${NAME}");
}
`;

/** The drop-in's browser module: it keeps each answer that the listener gets, for the test. */
const BROWSER = `export const pocketApi = 1;

export default function setup(pocket) {
    const answers = (globalThis.answers = []);

    pocket.onAnswer((answer) => answers.push({ ...answer }));
}
`;

type Answer = {
    conversationId: number | null;
    part: number;
    text: string;
    done: boolean;
};

type Page = Awaited<ReturnType<Browsers["open"]>>;

let pi: App | undefined;
let server = undefined as unknown as Server;
let browsers = undefined as unknown as Browsers;
let base = "";
let session = 0 as ConversationId;

const answers = async (on: Page): Promise<Answer[] | null> =>
    JSON.parse(await on.evaluate(`return JSON.stringify(globalThis.answers ?? null)`)) as
        Answer[] | null;

after(async () => {
    await browsers?.closeAll({ final: true });
    server?.closeAllConnections();
    server?.close();
    await pi?.close();
    cleanUp();
});

test("a module hears the answer while Pi writes it, and once more when it ends", real, async () => {
    mkdirSync(join(dropIns, NAME), { recursive: true });
    writeFileSync(join(dropIns, `${NAME}.ts`), SERVER);
    writeFileSync(join(dropIns, NAME, "index.js"), BROWSER);

    pi = await openApp(scriptedModel(() => fauxAssistantMessage([fauxText(ANSWER)]) as never));
    await pi.setExtensionEnabled(owner(pi), `${NAME}.ts`, true);
    session = await newSession(pi);

    server = createServer(
        createHandler({
            app: pi,
            listen: { host: "127.0.0.1", port: 0 },
            restart: () => {},
        }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    browsers = new Browsers({
        dataDir: mkdtempSync(join(tmpdir(), "on-answer-")),
        load: async () => undefined,
        save: () => {},
    });

    const tab = await browsers.open(1, { restore: false });

    await tab.navigate(`${base}/login?token=${encodeURIComponent(pi.config.ownerToken)}`);
    await tab.navigate(`${base}/s/${session}`);

    // The module is set up before the run: it must hear this run from its first words.
    await until(async () => (await answers(tab)) !== null, "the module's page");
    await say(pi, session, "Build it");

    await until(
        async () => (await answers(tab))?.some((answer) => answer.done) === true,
        "the end of the answer",
    );

    const heard = (await answers(tab)) ?? [];
    const growing = heard.filter((answer) => !answer.done);
    const last = heard.at(-1)!;

    assert.ok(growing.length >= 1, "the listener hears the answer before it ends");
    assert.deepEqual(
        heard.map((answer) => answer.text),
        heard
            .map((answer) => answer.text)
            .slice()
            .sort((a, b) => a.length - b.length),
        "each answer it hears has the text so far, never less",
    );
    assert.ok(growing.length >= 3, "the listener hears the answer grow, more than once");
    assert.deepEqual(
        heard.map((answer) => answer.text),
        heard
            .map((answer) => answer.text)
            .slice()
            .sort((a, b) => a.length - b.length),
        "each answer it hears has the text so far, never less",
    );
    assert.equal(growing.at(-1)!.done, false, "the calls before the end are not done");
    assert.equal(last.done, true, "one last call says the part is done");
    assert.equal(last.text, growing.at(-1)!.text, "the done call has the text that the tab had");
    assert.ok(last.text.startsWith("Part 1 says"), "the answer from its first words");
    assert.equal(last.conversationId, session, "the session that the tab shows");
    assert.equal(last.part, 1, "one answer of one run is one part");
});
