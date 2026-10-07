# Atelier

Pages an agent builds for one task, through which the human comments, decides and asks for work,
and through which those actions reach the agent's Pi session.

## Language

**Page**:
An HTML document an agent writes for one task, identified by its file path, that outlives the
session that created it. A Page may serve as a Review Surface.
_Avoid_: Surface, artifact, dashboard

**Key**:
A stable attribute (`atl-key`) the agent puts on an element the human judges; nested Keys form its
address, such as `run-12/turn-3`.
_Avoid_: Region, id, selector

**Kernel**:
The small script and Pi extension that carry Comments, Decisions, Requests and Updates between a
Page and the agent.
_Avoid_: core, runtime, SDK, kit

**Comment**:
A human remark anchored to text, an element or a point on a Page.
_Avoid_: Thread, annotation, note

**Unanchored Comment**:
A Comment whose anchor can no longer be found on the Page; it stays listed, never dropped.
_Avoid_: lost comment, orphan

**Decision**:
A choice the human answers among declared options: one the agent asks, or one a Page declares on a
Key, such as a 1–5 score or Confirm/Redo. It may recommend one option, and may require a note for
some options. The human can change the answer at any time; the answer records what it replaced and
whether the human opened the material first.
_Avoid_: grade, score, proposal, approval

**Request**:
A typed job the human asks the agent to do from a Page, with a status: queued, running, done,
failed or cancelled.
_Avoid_: command, action, task

**Update**:
An agent change to a Page shown live, without a reload and without destroying the human's open
input. It carries a one-line note, and the Page marks what it changed until the human has seen it.
_Avoid_: Ready, refresh, publish

**Event Log**:
The append-only, numbered record of every human and agent event on one Page, kept on disk.
_Avoid_: store, inbox, queue

**Delivery**:
Handing a human event to an agent's Pi session as a message, after its 10-second undo window. An
event not yet delivered goes to the next session that opens the Page.
_Avoid_: poll, wake, notify

## Registry

**Component**:
A reusable piece of page code copied into a project and adapted there.
_Avoid_: block, widget, element

**Pattern**:
A proven arrangement of Components for a kind of task, offered as an example, never enforced.
_Avoid_: template, recipe, skeleton, router

**Registry**:
The collection of the Kernel, Components and Patterns, each with its source and version.
_Avoid_: library, catalog

**Contribution**:
A change made to a copied Kernel or Component in a project, sent back to the Registry.
_Avoid_: upstream patch, fork
