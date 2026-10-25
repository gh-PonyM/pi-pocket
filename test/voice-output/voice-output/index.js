// Voice output, for the browser: reads Pi's answers with the browser's own speech (`speechSynthesis`). The tab's
// choices stay in its `sessionStorage`; the voice and the speed come from the module's settings on the server.

const KEY = "x.voice-output.state";

// The names of the good English voices, best first: "best" takes the first kind that this browser has.
const KINDS = [/natural/i, /google/i, /enhanced|premium/i, /neural/i, /siri/i];

// A message from another agent starts with this: it is not part of what Pi said.
const FEEDBACK = /\[via [^\]]*\]|\(via [^)]*\)/gi;

/** Why this browser cannot read aloud, or null when it can. */
function blocked() {
    return window.speechSynthesis === undefined
        ? "This browser has no voice. Try another browser."
        : null;
}

/** The tab's choices, with the defaults for what it lacks or does not fit. */
function loadChoices() {
    let stored = {};

    try {
        const raw = sessionStorage.getItem(KEY);

        stored = raw === null ? {} : (JSON.parse(raw) ?? {});
    } catch {
        stored = {};
    }

    const enabled = stored.enabled === true;

    return {
        enabled,
        // A browser starts no speech without a tap. The switch is that tap, so new answers goes with it.
        auto: enabled && stored.auto === true,
        readCode: stored.readCode === true,
    };
}

/** Save the tab's choices. A tab that refuses storage still reads: it forgets the choices when it loads again. */
function saveChoices(choices) {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(choices));
    } catch {
        // Nothing to do: the choices are in memory.
    }
}

/**
 * An answer's Markdown as the words to read, in the pieces that the reader speaks: a code block says how many lines it
 * has, or is read, and a table says that it is a table. No marker, address, tag, or emoji is read.
 */
function spokenWords(text, code) {
    // The pieces that must survive the tidy-up below: an inline code's words, and each code block's place.
    const inline = [];
    const blocks = [];
    const words = String(text)
        .replace(/\r\n?/g, " ")
        .replace(FEEDBACK, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<[^>]*>/g, " ")
        .replace(
            /```[ \t]*([\w+#.-]*)[^\n\n]*(?:\n([\s\S]*?))?(?:```|$)/g,
            (_all, language, body = "") => {
                if (code) {
                    return ` ${body.replace(/\s*\n\s*/g, " ")} `;
                }

                const lines = body
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== "").length;
                const what = language === "" ? "code" : `${language} code`;

                blocks.push(`${what}, ${lines} ${lines === 1 ? "line" : "lines"}.`);

                return ` SLOT${blocks.length - 1}END `;
            },
        )
        .replace(/^[ \t]*\|?[ \t:|-]{5,}\|?[ \t]*$/gm, "")
        .replace(/^[ \t]*\|.*\|[ \t]*$/gm, " table ")
        .replace(/`([^`\n]+)`/g, (_all, inner) => {
            if (!code) {
                return " code ";
            }

            inline.push(inner);

            return ` INLINE${inline.length - 1}END `;
        })
        .replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, "")
        .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
        .replace(/^[ \t]*>[ \t]?/gm, "")
        .replace(/(\*\*|__|~~)/g, "")
        .replace(/https?:\/\/\S+/g, " link ")
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, " ")
        .replace(/[\u2014\u2013]/g, " ")
        .replace(/([\s(])[*_]([^*_\n]+)[*_](?=[.,;:!?]?(?:\s|$))/g, "$1$2")
        .replace(/\s+/g, " ")
        .replace(/(?<!SLOT|INLINE)\b(\d)(?=[a-zA-Z])/g, "$1 ")
        .replace(/ ([.,;:!?])/g, "$1")
        .trim()
        .replace(/SLOT(\d+)END/g, (_all, index) => blocks[Number(index)] ?? "")
        .replace(/INLINE(\d+)END/g, (_all, index) => inline[Number(index)] ?? "");

    return splitSentences(words);
}

/** Text in the pieces that the reader speaks: a sentence each, and a long sentence cut at a comma or a space. */
function splitSentences(text) {
    const pieces = [];

    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        let rest = sentence.trim();

        while (rest.length > 220) {
            const at = Math.max(
                rest.lastIndexOf(", ", 200),
                rest.lastIndexOf("; ", 200),
                rest.lastIndexOf(" ", 190),
            );
            const cut = at < 40 ? 200 : at + 1;

            pieces.push(rest.slice(0, cut).trim());
            rest = rest.slice(cut).trim();
        }

        if (rest !== "") {
            pieces.push(rest);
        }
    }

    return pieces;
}

/**
 * One voice for the whole tab: a queue of the pieces that it reads, one at a time. Chromium stops one long utterance
 * after about 15 seconds, so each piece is a sentence. A new read replaces what plays, so a person hears one thing.
 */
class Reader {
    constructor() {
        this.queue = [];
        this.reading = false;
        this.rate = 1;
        this.voice = null;
    }

    /** Read the pieces now, in order, in place of what plays. */
    start(pieces) {
        this.stop();

        this.add(pieces);
    }

    /** Add pieces after what the queue has: an answer that continues goes on with no new read to start it. */
    add(pieces) {
        this.queue.push(...pieces.filter((each) => each.words.trim() !== ""));
        this.pump();
    }

    stop() {
        this.queue = [];
        this.reading = false;
        window.speechSynthesis.cancel();
    }

    pump() {
        const next = this.queue.shift();

        if (this.reading || next === undefined) {
            return;
        }

        this.reading = true;

        const utterance = new SpeechSynthesisUtterance(next.words);
        let finished = false;

        const finish = () => {
            if (finished) {
                return;
            }

            finished = true;
            this.reading = false;
            // A cancelled utterance can end after the next one started: a moment between them tells them apart.
            setTimeout(() => this.pump(), 0);
        };

        utterance.rate = this.rate;

        if (this.voice !== null) {
            utterance.voice = this.voice;
            utterance.lang = this.voice.lang;
        }

        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
    }
}

/** The voice for the owner's choice: a voice of that name, or for "best" the first good English one. */
function pickVoice(choice, voices) {
    if (choice === "auto") {
        return null;
    }

    const english = voices.filter((voice) => /^en[-_]/i.test(voice.lang));

    if (typeof choice === "string" && choice !== "best") {
        return voices.find((voice) => voice.name === choice) ?? null;
    }

    for (const kind of KINDS) {
        const found = english.find((voice) => kind.test(voice.name));

        if (found !== undefined) {
            return found;
        }
    }

    return english.find((voice) => /^en[-_]US/i.test(voice.lang)) ?? english[0] ?? null;
}

export const pocketApi = 1;

export default function setup(pocket) {
    const { html, useEffect, useState } = pocket;
    const problem = blocked();
    const reader = new Reader();
    let choices =
        problem === null ? loadChoices() : { enabled: false, auto: false, readCode: false };
    let settings = {};

    let redraw = () => {};

    let rail = null;
    /** Whether this app says when Pi starts and stops: a server older than 0.22.0 does not. */
    let told = typeof pocket.on === "function";

    // ─── Settings ────────────────────────────────────────────────────────────

    /** The owner's voice and speed, for every tab. A browser without them keeps its own voice, at the normal speed. */
    function hearSettings() {
        if (typeof pocket.settings !== "function") {
            return;
        }

        pocket.settings().then(
            (each) => {
                settings = each.values;
                reader.rate = typeof settings.rate === "number" ? settings.rate : 1;
                voices().then((list) => {
                    reader.voice = pickVoice(settings.voice, list);
                });
            },
            () => {
                // The settings are the owner's: a browser that cannot read them still reads.
            },
        );
    }

    /** The list of voices can be empty until the browser says that it has them. */
    function voices() {
        return new Promise((resolve) => {
            const found = window.speechSynthesis.getVoices();

            if (found.length > 0) {
                resolve(found);

                return;
            }

            let done = false;

            const finish = () => {
                if (done) {
                    return;
                }

                done = true;
                clearTimeout(timer);
                window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
                resolve(window.speechSynthesis.getVoices());
            };

            const timer = setTimeout(finish, 2000);

            window.speechSynthesis.addEventListener?.("voiceschanged", finish);
        });
    }

    // ─── The page's choices ──────────────────────────────────────────────────

    function set(patch) {
        choices = { ...choices, ...patch };
        saveChoices(choices);

        if (!choices.enabled) {
            reader.stop();
        }

        rail?.update({ badge: badgeOf() });
        redraw();
    }

    const badgeOf = () => (choices.auto ? "auto" : choices.enabled ? "on" : "off");

    // ─── Reading ─────────────────────────────────────────────────────────────

    /** Read an answer's words now, in place of what plays. */
    function read(text) {
        const pieces = spokenWords(text, choices.readCode);

        if (pieces.length === 0) {
            pocket.notify("info", "There are no words to read here.");

            return;
        }

        reader.start(pieces.map((words) => ({ words })));
    }

    // ─── New answers ─────────────────────────────────────────────────────────

    /** The id of each message of a session that this tab has read, and who Pi answered there. */
    const seen = new Set();
    let session = null;
    let requester = null;

    /** Read the session's newest messages, and read aloud the answers that are new, in order. */
    function catchUp(id, { atEnd }) {
        if (typeof pocket.messages !== "function") {
            return Promise.resolve();
        }

        if (id !== session) {
            session = id;
            requester = null;
            seen.clear();
        }

        return pocket.messages({ limit: 200 }).then(
            (page) => {
                const fresh = [];

                for (const message of page.messages) {
                    if (seen.has(message.id)) {
                        continue;
                    }

                    seen.add(message.id);

                    if (atEnd) {
                        fresh.push(message);
                    }
                }

                // Who Pi answers here: the newest message that a person wrote.
                const person = page.messages.filter((each) => each.by.id !== null).at(-1);

                if (person !== undefined) {
                    requester = person.by.id;
                }

                if (!atEnd || !choices.auto || requester === null) {
                    return;
                }

                if (pocket.me?.id !== requester) {
                    return;
                }

                const pieces = [];

                for (const message of fresh) {
                    if (message.kind === "assistant") {
                        pieces.push(
                            ...spokenWords(message.text, choices.readCode).map((words) => ({
                                words,
                            })),
                        );
                    }
                }

                if (pieces.length > 0) {
                    reader.start(pieces);
                }
            },
            () => {
                // A cursor that went stale after a compaction: the next message reads again from the start.
            },
        );
    }

    if (problem === null && typeof pocket.onConversation === "function") {
        pocket.onConversation((id) => {
            if (id === null) {
                return;
            }

            // What the session had before this tab looked is not new: it is remembered, not read.
            catchUp(id, { atEnd: false });
        });
    }

    const stopEvents =
        problem === null && told
            ? pocket.on("running", ({ session: id, running }) => {
                  if (id !== session || !choices.auto) {
                      return;
                  }

                  // At the end of the run, and only then, the answers of the run are new.
                  if (!running) {
                      catchUp(id, { atEnd: true });
                  }
              })
            : null;

    // ─── The page ────────────────────────────────────────────────────────────

    /** The module's page: the switches, the voice's name, a field of text, and the buttons to try it. */
    function Voice() {
        const [, draw] = useState(0);
        const [sample, setSample] = useState(
            "This is how Pi's answers sound, one sentence at a time.",
        );

        useEffect(() => {
            redraw = () => draw((each) => each + 1);

            return () => {
                redraw = () => {};
            };
        }, []);

        const choice =
            settings.voice === "auto" ? "the browser's own" : String(settings.voice ?? "best");

        return html`<div class="voice-output">
            <div class="setting">
                <span>Voice output</span>
                <${pocket.Switch}
                    on=${choices.enabled}
                    label="Voice output"
                    disabled=${problem !== null}
                    onChange=${() => set({ enabled: !choices.enabled })}
                />
            </div>
            <p class="small muted">
                ${
                    problem ??
                    (choices.enabled
                        ? "Read aloud is under each answer. New answers reads them as they end."
                        : "Off. Tap Read aloud under an answer to hear it.")
                }
            </p>
            <div class="setting">
                <span>New answers</span>
                <${pocket.Switch}
                    on=${choices.auto}
                    label="New answers"
                    disabled=${!choices.enabled || problem !== null || !told}
                    onChange=${() => set({ auto: !choices.auto })}
                />
            </div>
            <p class="small muted">
                ${
                    !told
                        ? "This server is too old to say when Pi answers. Update Pi Pocket, and restart it."
                        : "Reads the answers in the session that this tab shows, when you are the one Pi answers there."
                }
            </p>
            <div class="setting">
                <span>Code in answers</span>
                <${pocket.Switch}
                    on=${choices.readCode}
                    label="Code in answers"
                    onChange=${() => set({ readCode: !choices.readCode })}
                />
            </div>
            <p class="small muted">Off says "bash code, 12 lines" where an answer has a block.</p>
            <p class="small muted">
                Voice: ${choice} · speed ${settings.rate ?? 1}× · the owner sets both in Extensions.
            </p>
            <input
                class="voice-output-sample"
                aria-label="Text to read"
                value=${sample}
                onInput=${(event) => setSample(event.currentTarget.value)}
            />
            <div class="voice-output-buttons">
                <button class="button" onClick=${() => read(sample)} disabled=${problem !== null}>
                    Hear it
                </button>
                <button class="button" onClick=${() => reader.stop()}>Stop</button>
            </div>
        </div>`;
    }

    pocket.page({ id: "voice", title: "Voice output", component: Voice });
    rail = pocket.rail({
        id: "voice",
        title: "Voice",
        icon: "chat",
        badge: badgeOf(),
        page: "voice",
    });
    pocket.replyAction({ id: "read", label: "Read aloud", run: (reply) => read(reply.text) });

    if (problem !== null) {
        return;
    }

    hearSettings();

    if (typeof pocket.onSettings === "function") {
        pocket.onSettings(hearSettings);
    }

    return () => {
        reader.stop();
        stopEvents?.();
    };
}
