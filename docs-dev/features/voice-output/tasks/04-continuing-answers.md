# 04: The runs of a session, and an answer in parts

**What to build:** the server hears when Pi starts and when Pi stops in a session, and sends
its tabs a `running` event with that session's id: `true` at the start and `false` at the end.
A tab in that session keeps the answers that it has not read yet, and reads them, in order and
one time each, when the run ends. So an answer that Pi gives in several parts, with tool calls
between them, is read in order and once. A tab that hears no event for 10 minutes stops
waiting. A server too old to hear these events says so in the page, and reads no new answer.

**Blocked by:** 03.

**Status:** ready

- [ ] A run's start and end in a session send `running` to the module's tabs with the session's id.
- [ ] A tab in that session reads the new answers of the run when it ends, in order, each one time.
- [ ] An answer in 2 parts, with a tool call between them, is read in order, once each.
- [ ] A tab that hears no event for 10 minutes drops what it waits with.
- [ ] A browser test with a scripted answer in 2 parts, with a tool call between them, shows both parts in order.
