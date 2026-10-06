# Atelier (working name)

Pages an agent builds for one task, through which the human comments, decides and asks for work,
and through which those actions reach the agent's Pi session.

## Language

**Page**:
An HTML document an agent writes for one task, identified by its file path, that outlives the
session that created it. A Page may serve as a Review Surface.
_Avoid_: Surface, artifact, dashboard

**Kernel**:
The small script and Pi extension that carry Comments, Decisions, Requests and Updates between a
Page and the agent.
_Avoid_: core, runtime, SDK, kit

**Comment**:
A human remark anchored to text, an element or a point on a Page.
_Avoid_: Thread, annotation, note

**Decision**:
A question the agent asks with options and one recommended option. The human's answer can be
revoked for 10 seconds and records whether the human opened the question's material first.
_Avoid_: Proposal, choice, approval

**Request**:
A typed job the human asks the agent to do from a Page, with a status: queued, running, done,
failed or cancelled.
_Avoid_: command, action, task

**Update**:
An agent change to a Page shown live, without a reload and without destroying the human's open
input.
_Avoid_: Ready, refresh, publish

**Event Log**:
The append-only, numbered record of every human and agent event on one Page, kept on disk.
_Avoid_: store, inbox, queue

**Delivery**:
Handing a human event to an agent's Pi session as a message. An event not yet delivered goes to
the next session that opens the Page.
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
