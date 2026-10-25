# 05: New answers, read as they arrive

**What to build:** with new answers on in a tab, each answer of Pi in the session that the tab
shows is read when it is done, and one answer in several parts goes on to its end. A tab does
not read when its person is not the person Pi answers there, and a tab that shows no session
reads nothing. The page's new-answers switch turns it on, and the rail button says "auto" while
it is on.

**Blocked by:** 04.

**Status:** ready

- [ ] New answers on, in the session's tab, reads the next `answer` event: its words without Markdown, with the owner's voice and speed.
- [ ] The tab of a person who is not Pi's in the session ignores it; a tab with no session ignores it.
- [ ] The rail button shows "auto" with new answers on, and "off" with them off.
- [ ] A browser test with 2 people in one session shows that only the answerer's tab reads.
