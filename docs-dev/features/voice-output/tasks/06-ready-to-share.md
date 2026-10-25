# 06: Ready to share

**What to build:** the drop-in is safe and easy to try. Its description says in 2 sentences
what it does and which setting it reads (the settings are Pi Pocket's own, and it reads no
file and calls no service). A person can copy the 2 files into `~/.pi-pocket/extensions/` by
the steps in a README, turn it on, and hear an answer. The module loads clean on a fresh copy
of Pi Pocket: no error in the log, and nothing shown in the Extensions sheet but the module
and its 2 settings.

**Blocked by:** 05.

**Status:** ready

- [ ] The module's first comment gives the description that the Extensions sheet shows, in 1 sentence, and it matches what the code does.
- [ ] A README beside the spec tells how to copy the files in, turn it on, and read an answer, and what the tab and the owner each choose.
- [ ] A test loads the module as a drop-in on a fresh copy, turns it on, and shows 2 settings and no error.
- [ ] `npm run check`, `npm run lint`, and `npm test` pass with the module in `test/` for the run.
