const WIDGET_KEY = "pi-workbench:delegates";

export function createDelegateWidget() {
  const delegates = new Map();
  let ui;

  const render = () => {
    if (ui === undefined) return;
    const lines = renderDelegateWidget([...delegates.values()]);
    ui.setWidget(WIDGET_KEY, lines);
  };

  return {
    attach(nextUi) {
      ui = nextUi;
      render();
    },

    launch(delegate) {
      delegates.set(delegate.executionId, { ...delegate, activity: "starting" });
      render();
    },

    update(executionId, activity) {
      const delegate = delegates.get(executionId);
      if (delegate === undefined || delegate.activity === activity) return;
      delegates.set(executionId, { ...delegate, activity });
      render();
    },

    finish(executionId) {
      if (!delegates.delete(executionId)) return;
      render();
    },

    dispose() {
      delegates.clear();
      if (ui !== undefined) ui.setWidget(WIDGET_KEY, undefined);
      ui = undefined;
    },
  };
}

export function renderDelegateWidget(delegates) {
  if (delegates.length === 0) return undefined;
  const lines = [`Delegates · ${delegates.length} active`];
  for (const delegate of delegates) {
    const actor = delegate.workerName === undefined ? "Subagent" : `Worker “${bounded(delegate.workerName, 48)}”`;
    lines.push(`● ${actor} · ${bounded(delegate.profile, 24)} · ${bounded(delegate.cognitiveRole, 32)} — ${bounded(delegate.taskPreview, 80)} — ${bounded(delegate.activity, 100)}`);
  }
  return lines;
}

function bounded(value, max) {
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
