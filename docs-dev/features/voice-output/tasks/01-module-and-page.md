# 01: The module, its settings, and its page

**What to build:** a person who turns on `voice-output` in Menu → Extensions sees the module
there with 2 settings (Voice, Speed). A Voice button on the rail opens a page with a switch
that turns voice output on (which unlocks the voice with that tap), a switch for new answers
(off for now), a switch for code, a field of text, and the buttons Hear it and Stop. Hear it
reads the field with the voice and speed from the settings; a second tap replaces the first.
In a browser with no voice, the page says so. The on/off choice stays in the tab.

**Blocked by:** None (can start immediately).

**Status:** ready

- [ ] `voice-output.ts` declares the 2 settings and gives the browser module; it adds nothing on a Pi Pocket older than 0.22.0.
- [ ] The rail button opens the page; the page's switch turns voice output on in this tab, and the choice stays after a reload of the tab.
- [ ] Hear it reads the text in the field, one sentence at a time, with the owner's voice and speed; Stop ends it; a second Hear it replaces the first.
- [ ] The settings' voice names match the list in the module, and the speed stays between 0.5 and 2.
- [ ] A browser test with a recorded `speechSynthesis` shows the words, the rate, and the voice; a browser with none says so.
