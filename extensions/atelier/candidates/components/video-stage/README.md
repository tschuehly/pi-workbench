# video-stage

**Pick:** judge one versioned media item and comment at its current playback time.
**Lesson:** Key the outer, unclipped container, not the video: Kernel finds its descendant media for `t`.
Keep the video ID/source stable across Updates; re-render size controls without replacing that node.

**Why:** Thomas wanted large/small rather than a tiny video and one item unless comparing (VV lines 25–26).
278/318 Comments were time-anchored; stale masters caused rejected fixes ([VR T1–T3](../../SOURCES.md)).

**Use:** copy [example.html](example.html)'s section/module. Supply actual media, captions and a byte-bound
version; change source URL when bytes change. Size comes from `video-size` in the URL and restores on
`atelier:update`. Native playback stays on the retained node. Keep media ancestors free of color filters.
**Limits:** no source media bundled; verify real playback/Range and changed media in your project. Kernel
records time but has no frame capture or seek-on-Comment. Safe-zone/frame examples are in TIPS.
**Skip:** simultaneous comparison unless that is the task. Pair with review-filter or attempt-timeline.
