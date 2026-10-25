# Tasks: Voice output

## Dependency graph

```mermaid
graph LR
  T01[01: module and page] --> T02[02: markdown to words]
  T02 --> T03[03: read an answer]
  T03 --> T04[04: continuing answers]
  T04 --> T05[05: new answers]
  T05 --> T06[06: ready to share]
```

## Frontier

Tasks whose blockers are all `Status: done`, not yet claimed.

- 01: module-and-page — ready

## All tasks

| #   | Title              | Blocked by | Status |
| --- | ------------------ | ---------- | ------ |
| 01  | module-and-page    | None       | ready  |
| 02  | markdown-to-words  | 01         | ready  |
| 03  | read-an-answer     | 02         | ready  |
| 04  | continuing-answers | 03         | ready  |
| 05  | new-answers        | 04         | ready  |
| 06  | ready-to-share     | 05         | ready  |
