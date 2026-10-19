import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryWorkstreamAdapter, WorkstreamStore } from "../../workstream-store/src/index.js";
import { parseRecordedWorkstreams } from "../fake-workstream-client.js";
import { joinChatsAndWorkstreams } from "../unified-navigation-state.js";
import { createWorkbenchWorkstreamClient } from "../workstream-client.js";

test("a visiting session is a valid projection and never associates its Chat with the visited Workstream", async () => {
  const store = new WorkstreamStore({ adapter: new InMemoryWorkstreamAdapter() });
  await store.create({ workstreamId: "ws-visited", idempotencyKey: "create", title: "Visited", producer: "session" });
  await store.append({
    workstreamId: "ws-visited",
    expectedRevision: 1,
    idempotencyKey: "visit",
    records: [{ type: "checkpoint.visiting", producer: "session", sourceSessionId: "chat-1", payload: { sessionId: "chat-1", checkpoint: { id: "cp-1", whatChanged: "a", remains: "b", next: "c", waitingOn: "owner" } } }],
  });
  const snapshot = await store.inspect("ws-visited");
  const [summary] = await store.list();

  const typed = createWorkbenchWorkstreamClient({ request: async (operation) => ({ ok: true, value: operation === "list" ? [summary] : snapshot }) });
  assert.equal((await typed.inspect("ws-visited")).sessions[0].status, "visiting");
  assert.equal((await typed.list())[0].waitingOn, "owner");
  assert.notEqual(parseRecordedWorkstreams({ version: 1, sequence: 1, snapshots: [snapshot] }), undefined);

  const native = { complete: true, sessions: [{ sessionId: "chat-1", machineId: "studio", projectId: "pi-web", workspaceId: "main", title: "Chat" }] };
  const joined = joinChatsAndWorkstreams(native, { complete: true, snapshots: [snapshot] });
  assert.equal(joined.status, "ready");
  assert.deepEqual(joined.chats.map((chat) => chat.sessionId), ["chat-1"]);
});
