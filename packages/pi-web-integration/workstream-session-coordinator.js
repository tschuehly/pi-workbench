const PRODUCER = "pi-web";

/**
 * Coordinates the non-atomic Workstream/PI WEB session launch handshake.
 * The Workstream Store remains authoritative for the association; the host only
 * owns session creation and navigation.
 */
export class WorkstreamSessionCoordinator {
  constructor(client, host) {
    if (client === undefined || host === undefined) throw new TypeError("client and host are required");
    this.client = client;
    this.host = host;
  }

  async launch(snapshot) {
    if (snapshot.closed) throw new Error("Closed Workstreams cannot start sessions.");
    const location = this.host.currentLocation();
    if (location?.workspaceId === undefined) throw new Error("Select a workspace before starting a Workstream session.");
    const associationKey = newId("launch");
    await this.#appendFresh(snapshot.id, associationKey, [{
      type: "session.pending",
      producer: PRODUCER,
      payload: { associationKey, ...location },
    }]);

    let session;
    try {
      session = await this.host.start({
        startupToken: associationKey,
        initialPrompt: workstreamPrompt(snapshot, associationKey),
      });
    } catch (error) {
      await this.#failPending(snapshot.id, associationKey, error);
      throw error;
    }

    try {
      await this.#appendFresh(snapshot.id, `${associationKey}:confirmed`, [{
        type: "session.confirmed",
        producer: PRODUCER,
        sourceSessionId: session.id,
        payload: { sessionId: session.id, associationKey, ...session.location },
      }]);
      return session;
    } catch (error) {
      const current = await this.client.inspect(snapshot.id);
      if (current.sessions.some((candidate) => candidate.status === "active" && candidate.id === session.id && candidate.associationKey === associationKey)) return session;
      // The runtime session exists. Keep the durable association pending so reconnect
      // can confirm this same startup token instead of launching a duplicate child.
      throw error;
    }
  }

  async resume(session) {
    if (session.status !== "active") throw new Error("Only confirmed sessions can be resumed.");
    await this.host.open({ sessionId: session.id, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId });
  }

  async reconcile(snapshot) {
    const pending = snapshot.sessions.filter((session) => session.status === "pending");
    const results = [];
    for (const association of pending) {
      const found = await this.host.findByStartupToken(association.associationKey, {
        machineId: association.machineId,
        projectId: association.projectId,
        workspaceId: association.workspaceId,
      });
      if (found === undefined) {
        results.push({ associationKey: association.associationKey, status: "pending" });
        continue;
      }
      const current = await this.client.inspect(snapshot.id);
      if (!current.sessions.some((candidate) => candidate.status === "active" && candidate.id === found.id && candidate.associationKey === association.associationKey)) {
        try {
          await this.#appendFresh(snapshot.id, `${association.associationKey}:reconciled`, [{
            type: "session.confirmed",
            producer: PRODUCER,
            sourceSessionId: found.id,
            payload: { sessionId: found.id, associationKey: association.associationKey, ...found.location },
          }]);
        } catch (error) {
          const reconciled = await this.client.inspect(snapshot.id);
          if (!reconciled.sessions.some((candidate) => candidate.status === "active" && candidate.id === found.id && candidate.associationKey === association.associationKey)) throw error;
        }
      }
      results.push({ associationKey: association.associationKey, status: "confirmed", sessionId: found.id });
    }
    return results;
  }

  async #failPending(workstreamId, associationKey, error) {
    try {
      await this.#appendFresh(workstreamId, `${associationKey}:failed`, [{
        type: "session.failed",
        producer: PRODUCER,
        payload: { associationKey, reason: errorMessage(error) },
      }]);
    } catch (recordError) {
      throw new AggregateError([error, recordError], "Session launch failed and its pending association could not be reconciled.");
    }
  }

  async #appendFresh(workstreamId, idempotencyKey, records) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await this.client.inspect(workstreamId);
      try {
        return await this.client.append({ workstreamId, expectedRevision: snapshot.revision, idempotencyKey, records });
      } catch (error) {
        if (error?.code !== "STALE_REVISION" || attempt === 2) throw error;
      }
    }
    throw new Error("Unreachable append retry state.");
  }
}

export function workstreamPrompt(snapshot, associationKey) {
  return [
    `You are pairing in Pi Workbench Workstream “${snapshot.title}” (${snapshot.id}).`,
    `The attended session association key is ${associationKey}.`,
    "Remain in Level 1 Pair posture: work with the attending user, reconcile any bounded child work yourself, and do not claim background execution or managed Run authority.",
    "When asked for a checkpoint, propose concise values for: what changed, what remains, the next useful action, an exact paste-ready prompt for a fresh attended session, and only the concrete references needed to resume. The user must review and confirm every field before persistence.",
  ].join("\n\n");
}

function newId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
