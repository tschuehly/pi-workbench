import { WorkstreamSessionCoordination } from './coordination.mjs';
import { createWorkbenchWorkstreamClient } from './workstream-client.mjs';
import { savedLaunchPrompt } from './workstream-host.mjs';

const prefix = 'workbench:workstream:operation:';
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,79}$/.test(id);
const same = (a, b) => a?.machineId === b?.machineId && a?.projectId === b?.projectId && a?.workspaceId === b?.workspaceId;
const message = error => error instanceof Error ? error.message : String(error);

// service is a transport scoped to one registered project/workspace, not a raw Workstream client.
export function createWorkstreamLaunch({ service, host, storage }) {
  if (!service || typeof service.request !== 'function' || !host || !storage) throw new TypeError('Scoped service, host and durable storage are required');
  const client = createWorkbenchWorkstreamClient(service);
  const coordinator = new WorkstreamSessionCoordination({
    withWorkstreamClient: callback => callback(client),
    producer: 'workbench-web',
    attendedSession: {
      async checkLocation({ location }) {
        let current;
        try { current = host.currentLocation(); } catch (error) { return { type: 'blocked', cause: 'HOST_LOCATION_UNAVAILABLE', reason: message(error) }; }
        return same(current, location) && current?.machineId === 'local' && current?.projectId && current?.workspaceId
          ? { type: 'ready' }
          : { type: 'blocked', cause: current ? 'HOST_LOCATION_MISMATCH' : 'HOST_LOCATION_UNAVAILABLE', reason: 'Select the registered local workspace for this launch.' };
      },
      async launch(request, hooks) {
        if (!same(host.currentLocation(), request.location)) return { type: 'failed', reason: 'Selected workspace changed before creation.' };
        let session;
        try {
          session = await host.start({ startupToken: request.associationKey, initialPrompt: request.initialPrompt, location: request.location });
        } catch (error) {
          return { type: error?.nonCreationProven === true ? 'failed' : 'unknown', reason: message(error) };
        }
        try { await hooks.created(session); } catch (error) { return { type: 'unknown', reason: message(error) }; }
        return { type: 'completed' };
      },
      async lookup({ associationKey, location }) {
        try {
          const session = await host.findByStartupToken(associationKey, location);
          return session ? { type: 'found', session } : { type: 'unknown' };
        } catch { return { type: 'unknown' }; }
      },
    },
  });
  const key = id => `${prefix}${id}`;
  function saved(operationId) {
    if (!validId(operationId)) throw new TypeError('Invalid operation id');
    const raw = storage.getItem(key(operationId));
    if (raw === null) return null;
    let request;
    try { request = JSON.parse(raw); } catch { throw new Error('Saved launch request is damaged; do not relaunch'); }
    if (request?.operationId !== operationId || !['blank', 'checkpoint'].includes(request.kind) || !validId(request.workstreamId) || (request.kind === 'blank' ? request.location?.machineId !== 'local' || !request.location.projectId || !request.location.workspaceId : typeof request.selection !== 'string')) throw new Error('Saved launch request is invalid; do not relaunch');
    return request;
  }
  async function resume(operationId) {
    const request = saved(operationId);
    if (!request) throw new Error('No saved launch request');
    const token = `workbench-web:${operationId}`;
    const terminal = storage.getItem(`${key(operationId)}:terminal`);
    if (terminal !== null) {
      const outcome = JSON.parse(terminal);
      if (!['failed', 'cancelled'].includes(outcome?.type) || outcome.operationToken !== token || typeof outcome.reason !== 'string') throw new Error('Saved launch outcome is invalid');
      return outcome;
    }
    let snapshot;
    try { snapshot = await client.inspect(request.workstreamId); }
    catch (error) { return { type: 'unavailable', operationToken: token, cause: error?.code ?? 'WORKSTREAM_UNAVAILABLE', reason: message(error) }; }
    const association = snapshot.sessions.find(s => s.associationKey === token);
    if (association?.status === 'active') return { type: 'confirmed', operationToken: token, session: { id: association.id, location: { machineId: association.machineId, projectId: association.projectId, workspaceId: association.workspaceId } } };
    if (association?.status === 'failed') return { type: 'failed', operationToken: token, reason: association.launchFailure?.reason ?? 'Session creation failed.' };
    if (association?.status === 'pending') {
      const outcome = (await coordinator.reconcile(request.workstreamId, snapshot)).find(item => item.associationKey === token);
      if (outcome?.status === 'confirmed') return resume(operationId);
      if (outcome?.status === 'conflict') return { type: 'conflict', operationToken: token, cause: outcome.cause, reason: outcome.reason };
      if (outcome?.status === 'blocked') return { type: 'blocked', cause: outcome.cause, reason: outcome.reason };
      return { type: 'pending', operationToken: token, reason: outcome?.reason ?? 'Session creation outcome is unknown; no new POST will be sent.' };
    }
    return { type: 'pending', operationToken: token, reason: 'Saved launch has no confirmed association; inspect before starting another operation.' };
  }
  async function launch(request) {
    if (!request || !validId(request.operationId) || !validId(request.workstreamId) || !['blank', 'checkpoint'].includes(request.kind)) throw new TypeError('Invalid launch request');
    const previous = saved(request.operationId);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(request)) throw new Error('Operation id already belongs to a different request');
      return resume(request.operationId);
    }
    const exact = JSON.stringify(request);
    storage.setItem(key(request.operationId), exact);
    if (storage.getItem(key(request.operationId)) !== exact) throw new Error('Launch request could not be persisted');
    const outcome = await coordinator.launch(request);
    // All blocked outcomes precede the pending append and session POST.
    if (outcome.type === 'blocked') storage.removeItem(key(request.operationId));
    if (outcome.type === 'failed' || outcome.type === 'cancelled') storage.setItem(`${key(request.operationId)}:terminal`, JSON.stringify(outcome));
    return outcome;
  }
  return { inspectContinuation: id => coordinator.inspectContinuation(id), launch, resume, reconcile: id => coordinator.reconcile(id), saved, savedPrompt: id => savedLaunchPrompt(storage, `workbench-web:${id}`) };
}
