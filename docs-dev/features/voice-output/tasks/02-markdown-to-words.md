# 02: An answer's words, without its Markdown

**What to build:** the words that a person hears for an answer are the answer's own words:
no `**`, `#`, backticks, list marks, link addresses, HTML tags, or emoji. A heading or a list
item is a sentence. A table says "Table." A fenced block says "bash code, 12 lines" (or "code,
4 lines"), and inline code says "code". When the tab turns on code, the block's lines and the
inline text are read. The `[via …]` marker that a message from another agent starts with is
not read. The same function is used by Hear it, Read aloud, and new answers.

**Blocked by:** 01.

**Status:** ready

- [ ] Plain prose, headings, lists, emphasis, links, images, quotes, and HTML tags give their words alone.
- [ ] A fenced block with a language says "<language> code, N lines"; without a language, "code, N lines"; with code on, its lines are read.
- [ ] Inline code says "code", or its text with code on.
- [ ] A table says "Table."; emoji, `#` in front of a number, and a `[via …]` marker give no word.
- [ ] A test checks each shape on its own; no Markdown marker survives in what is read.
