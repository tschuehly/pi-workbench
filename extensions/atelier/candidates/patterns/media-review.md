# One-video review loop

Candidate Pattern · VR PL · Observed. An offered arrangement, not a Registry admission or
content rule (107/117). Choose and change it for the task; no prescribed word count or page schema.

## When it helps
Watch one current master, comment at a moment and judge its result without burying the video in controls.

## Components and hierarchy
1. [review-filter](../components/review-filter/README.md) selects ready, unjudged videos; [video-stage](../components/video-stage/README.md) keeps the current one large.
2. [theme-switch](../components/theme-switch/README.md) and [safe-zone](../components/safe-zone/README.md) change presentation, never the media pixels.
3. [frame-strip](../components/frame-strip/README.md) returns to cited moments; [item-pager](../components/item-pager/README.md) uses plain scroll/buttons, not gestures.
4. [decision-context](../components/decision-context/README.md) sits on the concerned video. [action-dialog](../components/action-dialog/README.md) contains [score-scale](../components/score-scale/README.md) and rare Request controls.
5. [revision-summary](../components/revision-summary/README.md) identifies a rerender before judging older Comments.

## Kernel / Keys
video-ID/variant-ID + master hash. Verdict Record is not production approval. Kernel Update must preserve unchanged video identity/time; changed media receives a fresh version, leaving earlier feedback visibly historical.

## Evidence for and against
[VR §2 T1–T7](../SOURCES.md#use-cases), observed scores, time anchors, batch sends and navigation churn. [VV](../SOURCES.md#owner) asks large/small toggle and one-at-a-time unless actually comparing.

## Boundaries
Timestamp capture, frame asset persistence, batch Send and Comment acceptance belong in the Kernel. This Pattern does not recreate the old chat/server/poller. Mac-only default (132) overrides historical phone layouts; D119 real-batch comparison remains pending.
