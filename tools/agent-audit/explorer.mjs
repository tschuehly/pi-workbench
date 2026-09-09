const MAX_CHARS = 200_000;
const MAX_LINES = 2_000;
const MAX_CELLS = 400_000;

export function normalizePreviewSet(set) {
  const previews = (set.previews ?? []).map((preview) => ({
    ...preview,
    savedPreview: preview,
    dials: preview.dials && typeof preview.dials === 'object'
      ? { ...preview.dials }
      : Object.fromEntries([['alignment', preview.alignment], ['checking', preview.checking]].filter(([, value]) => value != null)),
  }));
  const keys = [];
  for (const key of Object.keys(set.dialDefinitions ?? {})) if (!keys.includes(key)) keys.push(key);
  for (const preview of previews) for (const key of Object.keys(preview.dials)) if (!keys.includes(key)) keys.push(key);
  const definitions = Object.fromEntries(keys.map((key) => {
    const definition = set.dialDefinitions?.[key] ?? {};
    const observed = [...new Set(previews.map((preview) => preview.dials[key]).filter((value) => value != null))];
    const ordered = [...(definition.values ?? []).filter((value) => observed.includes(value)), ...observed.filter((value) => !(definition.values ?? []).includes(value))];
    return [key, { label: definition.label ?? title(key), values: ordered }];
  }));
  return { ...set, savedPreviewSet: set, previews, dialKeys: keys, dialDefinitions: definitions };
}

export function findPreview(set, selected) {
  return set.previews.find((preview) => set.dialKeys.every((key) => preview.dials[key] === selected[key])) ?? null;
}

export function dialOptions(set, selected, key) {
  return set.dialDefinitions[key].values.map((value) => ({
    value,
    available: set.previews.some((preview) => set.dialKeys.every((candidate) => candidate === key ? preview.dials[candidate] === value : preview.dials[candidate] === selected[candidate])),
  }));
}

export function diffText(before = '', after = '') {
  const a = lines(before), b = lines(after);
  if (before.length + after.length > MAX_CHARS || a.length > MAX_LINES || b.length > MAX_LINES || (a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return { status: 'fallback', reason: 'Exact line diff exceeds the bounded comparison budget.', before: measure(before, a), after: measure(after, b), segments: [] };
  }
  const width = b.length + 1, table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const operations = [];
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) { operations.push({ kind: 'unchanged', text: a[i] }); i++; j++; }
    else if (j < b.length && (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) { operations.push({ kind: 'added', text: b[j++] }); }
    else operations.push({ kind: 'removed', text: a[i++] });
  }
  const segments = [];
  for (let at = 0; at < operations.length;) {
    if (operations[at].kind === 'unchanged') {
      let text = ''; while (operations[at]?.kind === 'unchanged') text += operations[at++].text;
      segments.push({ kind: 'unchanged', text }); continue;
    }
    let beforeText = '', afterText = '';
    while (operations[at] && operations[at].kind !== 'unchanged') {
      if (operations[at].kind === 'removed') beforeText += operations[at].text; else afterText += operations[at].text;
      at++;
    }
    segments.push(beforeText && afterText ? { kind: 'changed', before: beforeText, after: afterText }
      : beforeText ? { kind: 'removed', text: beforeText } : { kind: 'added', text: afterText });
  }
  return { status: 'compared', before: measure(before, a), after: measure(after, b), segments };
}

export function diffSkills(before = [], after = []) {
  const a = new Map(before.map((skill) => [skill.name, skill])), b = new Map(after.map((skill) => [skill.name, skill]));
  const added = [...b.keys()].filter((name) => !a.has(name)).map((name) => b.get(name));
  const removed = [...a.keys()].filter((name) => !b.has(name)).map((name) => a.get(name));
  const changed = [...a.keys()].filter((name) => b.has(name) && a.get(name).description !== b.get(name).description).map((name) => ({ before: a.get(name), after: b.get(name) }));
  const unchanged = [...a.keys()].filter((name) => b.has(name) && !changed.some((item) => item.before.name === name)).map((name) => a.get(name));
  return { added, removed, changed, unchanged };
}

export function savedCombinations(set) {
  return set.previews.map((preview) => ({ id: preview.id, dials: { ...preview.dials }, label: set.dialKeys.map((key) => `${set.dialDefinitions[key].label}: ${preview.dials[key]}`).join(' · ') }));
}

export function instructionSummary(record) {
  if (record.instructionAvailability?.status !== 'available') return { status: record.instructionAvailability?.status ?? 'unknown', text: record.instructions, catalog: null };
  const marker = '\n\nThe following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill\'s file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n\n<available_skills>\n';
  const end = '\n</available_skills>', start = record.instructions.indexOf(marker);
  if (start < 0 || record.instructions.indexOf(marker, start + marker.length) >= 0) return { status: 'unrecognized', text: record.instructions, catalog: null };
  const close = record.instructions.indexOf(end, start + marker.length);
  if (close < 0) return { status: 'unrecognized', text: record.instructions, catalog: null };
  const body = record.instructions.slice(start + marker.length, close), entries = [], pattern = /  <skill>\n    <name>([^<]*)<\/name>\n    <description>([^<]*)<\/description>\n    <location>([^<]*)<\/location>\n  <\/skill>/g;
  let match, consumed = '';
  while ((match = pattern.exec(body))) { consumed += `${consumed ? '\n' : ''}${match[0]}`; entries.push({ name: xml(match[1]), description: xml(match[2]), location: xml(match[3]) }); }
  const expected = record.skills ?? [];
  const verified = consumed === body && entries.length === expected.length && entries.every((entry, index) => entry.name === expected[index].name && expected[index].description != null && entry.description === expected[index].description && expected[index].filePath != null && entry.location === expected[index].filePath);
  if (!verified) return { status: 'unrecognized', text: record.instructions, catalog: null };
  return { status: 'recognized', text: record.instructions.slice(0, start) + record.instructions.slice(close + end.length), catalog: record.instructions.slice(start, close + end.length) };
}

export function comparisonData(before, after) {
  const instructionsAvailable = before.instructionAvailability?.status === 'available' && after.instructionAvailability?.status === 'available';
  const beforeSummary = instructionSummary(before), afterSummary = instructionSummary(after);
  const skillsAvailable = before.skillAvailability?.status === 'available' && after.skillAvailability?.status === 'available';
  return {
    instructionAvailability: instructionsAvailable ? { status:'available' } : unavailable(before.instructionAvailability, after.instructionAvailability),
    instructionDiff: instructionsAvailable ? diffText(beforeSummary.text, afterSummary.text) : null,
    exactInstructionDiff: instructionsAvailable ? diffText(before.instructions, after.instructions) : null,
    recognizedCatalog: beforeSummary.status === 'recognized' || afterSummary.status === 'recognized',
    skillAvailability: skillsAvailable ? { status:'available' } : unavailable(before.skillAvailability, after.skillAvailability),
    skillDiff: skillsAvailable ? diffSkills(before.skills, after.skills) : null,
  };
}

export function recordsFromBundle(bundle) {
  const records = [], sets = (bundle.previewSets ?? (bundle.previewSet ? [bundle.previewSet] : [])).map(normalizePreviewSet);
  for (const item of bundle.requests ?? (bundle.capture ? [bundle] : [])) records.push(requestRecord(item));
  for (const set of sets) for (const preview of set.previews) records.push(previewRecord(set, preview));
  return { records, sets };
}

function requestRecord(item) {
  const capture = item.capture, transport = capture.transport ?? {}, observed = ['http-fetch', 'websocket-send'].includes(transport.kind);
  const interpretation = capture.actualRequestInterpretation ?? {}, fields = interpretation.instructionFields ?? [];
  const catalog = capture.skills?.advertisedCatalog, skills = describedSkills(catalog?.skills ?? [], capture.sourceSnapshots);
  const instructionAvailability = !observed || interpretation.status === 'unavailable' ? { status:'unavailable', reason:'No supported outgoing instruction payload was observed.' }
    : fields.length ? { status:'available', fields:fields.map((field) => field.path) } : { status:'unknown', reason:'The decoded request did not provide a recognized instruction field.' };
  const skillAvailability = catalog?.status === 'observed' || catalog?.status === 'absent' ? { status:'available', evidence:catalog.status }
    : { status:catalog?.status === 'unknown' ? 'unknown' : 'unavailable', reason:catalog?.reason ?? 'No catalog evidence was saved.' };
  return {
    key: `request-${capture.id}`, type: 'request', kind: observed ? 'Observed transport send' : transport.kind === 'unsupported' ? 'Unsupported transport' : 'Missing transport observation',
    label: `${capture.timestamp} · ${capture.provider?.provider ?? 'unknown'} · ${transport.kind ?? 'unknown'}`,
    instructions: fields.map((field) => readableText(field.value)).join('\n\n'), instructionAvailability, skills, skillAvailability, tools: capture.activeTools ?? [], sources: capture.sourceSnapshots ?? {}, outputs: item.nativeOutputs ?? null,
    summary: [['Capture', capture.id], ['Session', capture.session?.sessionId], ['Provider', `${capture.provider?.provider ?? '?'} / ${capture.provider?.model ?? '?'}`], ['Transport', transport.kind], ['Instruction evidence', instructionAvailability.status], ['Instruction field paths', instructionAvailability.fields?.join(', ')], ['Skill catalog evidence', skillAvailability.status], ['Applied Working Mode', mode(capture.workingMode?.appliedToPrompt)], ['Selected next turn', mode(capture.workingMode?.selectedNextTurnAtTransport)], ['Native output evidence', item.nativeOutputs?.status ?? 'missing'], ['Output group', item.nativeOutputs?.groupId]],
    transport, skillEvidence: capture.skills, requestMetadata:{provider:capture.provider,group:capture.group,events:item.events ?? []}, logical: { promptInputs: capture.promptInputs, logicalObservation: capture.logicalObservation }, exact: item,
  };
}

function previewRecord(set, preview) {
  return {
    key: `preview-${set.id}-${preview.id}`, type: 'preview', kind: 'Unsent preview', label: `Preview · ${Object.values(preview.dials).join(' / ')}`,
    instructions: preview.systemPrompt ?? '', instructionAvailability: typeof preview.systemPrompt === 'string' ? {status:'available',fields:['systemPrompt']} : {status:'unavailable',reason:'No preview system prompt was saved.'},
    skills: describedSkills(preview.advertisedSkills ?? [], set.sourceSnapshots), skillAvailability: Array.isArray(preview.advertisedSkills) ? {status:'available',evidence:'saved preview advertisedSkills'} : {status:'unknown',reason:'No preview skill list was saved.'}, tools: set.activeTools ?? [], sources: set.sourceSnapshots ?? {}, outputs: null,
    summary: [['Preview set', set.id], ...Object.entries(preview.dials).map(([key, value]) => [set.dialDefinitions[key]?.label ?? title(key), value]), ['Status', preview.label], ['Provider request', 'None — no model call']],
    setId: set.id, dials: preview.dials, basePrompt: set.basePrompt, installedExplicitlyCallable: set.installedExplicitlyCallable ?? [], exact: { previewSet: set.savedPreviewSet, preview: preview.savedPreview },
  };
}

function describedSkills(names, snapshots = {}) {
  const saved = new Map((snapshots.skills ?? []).map((skill) => [skill.name, skill]));
  return names.map((item) => {
    const name = typeof item === 'string' ? item : item.name, source = saved.get(name) ?? (typeof item === 'object' ? item : {});
    return { name, description: source.description ?? null, filePath: source.filePath ?? null, sourceInfo: source.sourceInfo ?? null };
  });
}
function readableText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((part) => typeof part?.text === 'string')) return value.map((part) => part.text).join('\n');
  return JSON.stringify(value, null, 2);
}
function unavailable(before = {status:'unknown'}, after = {status:'unknown'}) { return { status:before.status === 'unavailable' || after.status === 'unavailable' ? 'unavailable' : 'unknown', before, after }; }
function xml(value) { return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function lines(text) { return text.match(/[^\n]*\n|[^\n]+$/g) ?? []; }
function measure(text, split) { return { characters: text.length, lines: split.length }; }
function mode(value) { return value ? `${value.alignment} / ${value.checking}` : 'unobserved'; }
function title(value) { return value.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }

export function openDisclosureAncestors(node) {
  for (let current = node?.parentElement; current; current = current.parentElement) if (current.tagName === 'DETAILS') current.open = true;
}

export async function mountAgentAuditExplorer(root = document) {
  const response = await fetch('/audit.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('audit.json unavailable');
  const audit = await response.json(), { records, sets } = recordsFromBundle(audit);
  root.querySelector('#bundle-status').textContent = records.some((record) => record.type === 'request') ? `${records.filter((record) => record.type === 'request').length} request record(s) in this frozen export.` : (audit.notice || 'No actual requests are recorded; this export contains saved previews only.');
  const selectors = [makeSelector('baseline', root, records, sets), makeSelector('target', root, records, sets)];
  chooseDefaults(selectors, records, sets);
  const evidence = root.querySelector('#evidence');
  for (const record of records) evidence.append(renderRecord(record));
  const update = () => {
    const [before, after] = selectors.map((selector) => selector.record());
    renderDifferences(root.querySelector('#differences'), before, after);
    const visible = new Set([before?.key, after?.key]);
    for (const region of evidence.querySelectorAll(':scope > atelier-region')) region.hidden = !visible.has(region.getAttribute('key'));
  };
  selectors.forEach((selector) => selector.onChange(update)); update();
  const { setRevealResolver } = await import('/atelier.mjs');
  setRevealResolver(async ({ region, id }) => {
    const local = region.split('/').at(-1), record = records.find((item) => item.key === local);
    if (!record) return;
    selectors[1].select(record); update(); await Promise.resolve();
    const recordRegion = [...evidence.querySelectorAll(':scope > atelier-region')].find((item) => item.getAttribute('key') === local);
    const interaction = [...(recordRegion?.querySelectorAll('[data-comment],[data-update],[data-proposal]') ?? [])].find((item) => Object.values(item.dataset).includes(String(id)));
    openDisclosureAncestors(interaction ?? recordRegion);
  });
}

function makeSelector(side, root, records, sets) {
  const source = root.querySelector(`#${side}-source`), dials = root.querySelector(`#${side}-dials`), status = root.querySelector(`#${side}-status`), listeners = [];
  for (const record of records.filter((item) => item.type === 'request')) source.append(option(`record:${record.key}`, `Request · ${record.label}`));
  for (const set of sets) source.append(option(`set:${set.id}`, `Unsent preview set · ${set.timestamp ?? set.id}`));
  let selectedDials = {};
  const renderDials = () => {
    dials.replaceChildren(); status.textContent = '';
    const set = currentSet(); if (!set) return;
    const current = findPreview(set, selectedDials) ?? set.previews[0]; selectedDials = { ...current?.dials };
    for (const key of set.dialKeys) {
      const select = document.createElement('select'); select.id = `${side}-${key}`; select.setAttribute('aria-label', set.dialDefinitions[key].label);
      for (const item of dialOptions(set, selectedDials, key)) { const node = option(item.value, item.available ? item.value : `${item.value} — unavailable with other choices`); node.disabled = !item.available; select.append(node); }
      select.value = selectedDials[key]; select.addEventListener('change', () => { selectedDials[key] = select.value; renderDials(); fire(); });
      const label = document.createElement('label'); label.append(text('span', set.dialDefinitions[key].label), select); dials.append(label);
    }
    const combinations = savedCombinations(set), jump = document.createElement('select'); jump.id = `${side}-combination`; jump.setAttribute('aria-label', 'Jump to saved combination');
    combinations.forEach((item, index) => jump.append(option(String(index), item.label))); jump.value = String(Math.max(0, set.previews.indexOf(current)));
    jump.addEventListener('change', () => { selectedDials = { ...combinations[Number(jump.value)].dials }; renderDials(); fire(); });
    const jumpLabel = document.createElement('label'); jumpLabel.className = 'combination-jump'; jumpLabel.append(text('span', 'Jump to saved combination'), jump); dials.append(jumpLabel);
    status.textContent = 'Dial changes never alter another dial. Use the explicit jump control for any other saved combination.';
  };
  const currentSet = () => sets.find((set) => `set:${set.id}` === source.value);
  const record = () => {
    if (source.value.startsWith('record:')) return records.find((item) => `record:${item.key}` === source.value) ?? null;
    const set = currentSet(); return set && findPreview(set, selectedDials) ? records.find((item) => item.setId === set.id && sameDials(item.dials, selectedDials)) ?? null : null;
  };
  const fire = () => listeners.forEach((listener) => listener());
  source.addEventListener('change', () => { selectedDials = { ...(currentSet()?.previews[0]?.dials ?? {}) }; renderDials(); fire(); });
  return { source, renderDials, record, onChange: (listener) => listeners.push(listener), select(record) { if (!record) return; source.value = record.type === 'preview' ? `set:${record.setId}` : `record:${record.key}`; selectedDials = { ...(record.dials ?? {}) }; renderDials(); } };
}

function chooseDefaults(selectors, records, sets) {
  const firstPreview = records.find((record) => record.type === 'preview'), firstRequest = records.find((record) => record.type === 'request');
  if (firstPreview) selectors[0].select(firstPreview); else if (firstRequest) selectors[0].select(firstRequest);
  if (firstRequest && firstPreview) selectors[1].select(firstRequest);
  else {
    const alternative = sets[0]?.previews.find((preview) => firstPreview && Object.keys(preview.dials).filter((key) => preview.dials[key] !== firstPreview.dials[key]).length === 1);
    selectors[1].select(alternative ? records.find((record) => record.setId === sets[0].id && sameDials(record.dials, alternative.dials)) : records[1] ?? records[0]);
  }
  selectors.forEach((selector) => selector.renderDials());
}

function renderDifferences(host, before, after) {
  host.replaceChildren();
  if (!before || !after) { host.append(text('p', 'Choose two saved records to compare.')); return; }
  const heading = text('h2', `${before.kind} → ${after.kind}`); host.append(heading, text('p', `${before.label} compared with ${after.label}`));
  const comparison = comparisonData(before, after), instruction = section('Instruction changes');
  if (comparison.instructionAvailability.status !== 'available') instruction.append(availabilityFacts('Instruction comparison', comparison.instructionAvailability));
  else {
    const changed = comparison.instructionDiff.segments.filter((segment) => segment.kind !== 'unchanged');
    if (comparison.instructionDiff.status === 'fallback') instruction.append(text('p', `${comparison.instructionDiff.reason} Exact text remains available in each selected record.`));
    else if (!changed.length) instruction.append(text('p', 'No instruction paragraphs changed.'));
    else changed.forEach((segment) => instruction.append(renderHumanSegment(segment)));
    const exact = section('Exact instruction diff');
    if (comparison.recognizedCatalog) exact.append(text('p', 'Includes the positively recognized saved skill catalog markup omitted from the readable summary above.'));
    if (comparison.exactInstructionDiff.status === 'fallback') exact.append(text('p', `${comparison.exactInstructionDiff.reason} Baseline: ${comparison.exactInstructionDiff.before.characters} characters / ${comparison.exactInstructionDiff.before.lines} lines. Target: ${comparison.exactInstructionDiff.after.characters} characters / ${comparison.exactInstructionDiff.after.lines} lines.`));
    else comparison.exactInstructionDiff.segments.forEach((segment) => exact.append(renderExactSegment(segment)));
    instruction.append(category('Exact instruction diff, including catalog markup', exact));
  }
  host.append(instruction, renderSkillChanges(comparison));
}

function renderHumanSegment(segment) {
  if (segment.kind === 'changed') { const block = el('div', 'change changed'); block.append(copyBlock('Before', segment.before), copyBlock('After', segment.after)); return block; }
  return copyBlock(segment.kind === 'added' ? 'Added' : 'Removed', segment.text, `change ${segment.kind}`);
}
function renderExactSegment(segment) {
  if (segment.kind === 'unchanged') return disclosure(`Unchanged · ${lines(segment.text).length} line(s)`, pre(segment.text, 'unchanged'));
  if (segment.kind === 'changed') { const block = el('div', 'change changed exact-change'); block.append(labelled('Before', segment.before), labelled('After', segment.after)); return block; }
  return labelled(segment.kind === 'added' ? 'Added' : 'Removed', segment.text, `change ${segment.kind} exact-change`);
}

function renderSkillChanges(comparison) {
  const host = section('Skill catalog changes');
  if (comparison.skillAvailability.status !== 'available') { host.append(availabilityFacts('Skill comparison', comparison.skillAvailability)); return host; }
  const changes = comparison.skillDiff;
  for (const [label, skills] of [['Added', changes.added], ['Removed', changes.removed]]) if (skills.length) host.append(skillList(label, skills));
  if (changes.changed.length) { const changed = section('Changed'); for (const item of changes.changed) { const card = el('article', 'structured-card'); card.append(text('h4', item.after.name), copyBlock('Before', item.before.description ?? 'No saved description.'), copyBlock('After', item.after.description ?? 'No saved description.')); changed.append(card); } host.append(changed); }
  if (!changes.added.length && !changes.removed.length && !changes.changed.length) host.append(text('p', 'No advertised skill changed.'));
  if (changes.unchanged.length) host.append(disclosure(`Unchanged · ${changes.unchanged.length} skill(s)`, skillList('', changes.unchanged)));
  return host;
}

function renderRecord(record) {
  const region = document.createElement('atelier-region'); region.setAttribute('key', record.key); region.setAttribute('label', record.label); region.setAttribute('comments', 'sheet'); region.hidden = true;
  const article = el('article', 'record'); article.append(text('p', record.kind), text('h2', record.label), facts(record.summary));
  const instructions = sectionWithText('Instruction evidence', `${title(record.instructionAvailability.status)}${record.instructionAvailability.reason ? ` — ${record.instructionAvailability.reason}` : ''}`);
  if (record.instructions) instructions.append(disclosure('Full saved instructions', pre(record.instructions, 'exact-text')));
  if (record.basePrompt != null) instructions.append(disclosure('Saved base prompt', pre(record.basePrompt, 'exact-text')));
  article.append(category('Instructions', instructions));
  const skills = readableSkills(record.skills, record.skillAvailability);
  if (record.skillEvidence) skills.append(disclosure('Full saved skill-access evidence', pre(JSON.stringify(record.skillEvidence, null, 2))));
  if (record.installedExplicitlyCallable?.length) skills.append(readableList('Installed explicitly callable skills', record.installedExplicitlyCallable));
  article.append(category('Skills', skills), category('Active tools', readableTools(record.tools)), category('Source provenance', readableSources(record.sources)));
  if (record.outputs) article.append(category('Native session outputs', readableOutputs(record.outputs)));
  if (record.transport) article.append(category('Outgoing transport data', readableTransport(record.transport)));
  if (record.requestMetadata) article.append(category('Provider, request group, and events', readableRequestMetadata(record.requestMetadata)));
  if (record.logical) article.append(category('Logical prompt and provider-hook evidence', disclosure('Full saved logical evidence', pre(JSON.stringify(record.logical, null, 2)))));
  article.append(category('Exact complete saved JSON', pre(JSON.stringify(record.exact, null, 2), 'raw'))); region.append(article); return region;
}

function readableSkills(skills, availability) { return availability.status !== 'available' ? sectionWithText('Advertised skills', `${title(availability.status)} — ${availability.reason}`) : skills.length ? skillList('Advertised skills', skills) : sectionWithText('Advertised skills', 'The saved catalog was observed and contained no advertised skills.'); }
function skillList(label, skills) { const host = section(label); const list = el('ul', 'item-list'); for (const skill of skills) { const item = document.createElement('li'); item.append(text('strong', skill.name), text('p', skill.description || 'No saved description.')); if (skill.filePath || skill.sourceInfo) item.append(disclosure('Saved path and source', facts([['Path', skill.filePath], ['Source', skill.sourceInfo?.source], ['Scope', skill.sourceInfo?.scope], ['Origin', skill.sourceInfo?.origin]]))); list.append(item); } host.append(list); return host; }
function readableTools(tools) { const host = section('Active tools'); if (!tools.length) { host.append(text('p', 'No active tools were recorded.')); return host; } for (const tool of tools) { const card = el('article', 'structured-card'); card.append(text('h4', tool.name ?? 'Unnamed tool'), text('p', tool.description ?? 'No saved description.')); card.append(disclosure('Parameters and saved definition', pre(JSON.stringify(tool, null, 2)))); host.append(card); } return host; }
function readableSources(sources) { const host = section('Source provenance'); const entries = [...(sources.contextFiles ?? []).map((item) => ({ label: item.path, item })), ...(sources.skills ?? []).map((item) => ({ label: item.name ?? item.filePath, item }))]; if (!entries.length) { host.append(text('p', 'No source snapshots were recorded.')); return host; } for (const { label, item } of entries) { const card = el('article', 'structured-card'); card.append(text('h4', label), facts([['Path', item.path ?? item.filePath], ['Availability', item.availability ?? item.kind], ['Loaded SHA-256', item.loadedSourceContent?.sha256], ['Disk SHA-256', item.diskAtCapture?.sha256], ['Disk status', item.diskAtCapture?.status]])); card.append(disclosure('Full saved source evidence', pre(JSON.stringify(item, null, 2)))); host.append(card); } return host; }
function readableOutputs(outputs) { const host = section('Native session outputs'); host.append(facts([['Status', outputs.status], ['Session', outputs.sessionId], ['Entries', outputs.entries?.length ?? 0], ['Limit', outputs.limitation]])); for (const entry of outputs.entries ?? []) { const card = el('article', 'structured-card'); card.append(text('h4', `${entry.type ?? 'entry'} · ${entry.id ?? 'no id'}`)); const content = entry.message?.content; if (typeof content === 'string') card.append(text('p', content)); else if (Array.isArray(content)) for (const part of content) card.append(text('p', part.text ?? part.thinking ?? `${part.type ?? 'content'} (see exact entry)`)); card.append(disclosure('Exact native entry', pre(JSON.stringify(entry, null, 2)))); host.append(card); } host.append(disclosure('Full saved native output evidence', pre(JSON.stringify(outputs, null, 2)))); return host; }
function readableTransport(transport) { const host = section('Outgoing transport data'); host.append(facts([['Kind', transport.kind], ['URL', transport.url], ['Method', transport.method], ['Content type', transport.contentType], ['Encoding', transport.contentEncoding], ['Send outcome', transport.sendOutcome], ['Limit', transport.claimLimit]])); const body = transport.body; if (body?.interpretation?.text != null) host.append(disclosure('Decoded exact outgoing text', pre(body.interpretation.text, 'exact-text'))); host.append(disclosure('Exact saved body evidence and bytes', pre(JSON.stringify(body, null, 2), 'raw'))); return host; }
function readableRequestMetadata(metadata) { const host = section('Request provenance'); host.append(facts([['Provider', metadata.provider?.provider], ['Model', metadata.provider?.model], ['API', metadata.provider?.api], ['Coverage', metadata.provider?.coverage?.status], ['Run', metadata.group?.runId], ['Logical observation', metadata.group?.logicalObservationId], ['Turn', metadata.group?.turnIndex], ['Attempt', metadata.group?.attempt], ['Correlation limit', metadata.group?.correlation], ['Events', metadata.events.map((event) => event.type).join(', ') || 'none']])); host.append(disclosure('Full provider, group, and event evidence', pre(JSON.stringify(metadata, null, 2)))); return host; }
function readableList(label, value) { const host = section(label); for (const item of value) host.append(disclosure(item.invocationName ?? item.name ?? 'Saved item', pre(JSON.stringify(item, null, 2)))); return host; }
function facts(rows) { const dl = el('dl', 'facts'); for (const [term, value] of rows) if (value != null) dl.append(text('dt', term), text('dd', value)); return dl; }
function section(label) { const node = el('section', 'detail-section'); if (label) node.append(text('h3', label)); return node; }
function sectionWithText(label, value) { const node = section(label); node.append(text('p', value)); return node; }
function disclosure(label, content) { const node = document.createElement('details'); node.append(text('summary', label), content); return node; }
function category(label, content) { const node = disclosure(label, content); node.className = 'record-category'; return node; }
function availabilityFacts(label, value) { return facts([[label, title(value.status)], ['Baseline', `${value.before.status}${value.before.reason ? ` — ${value.before.reason}` : ''}`], ['Target', `${value.after.status}${value.after.reason ? ` — ${value.after.reason}` : ''}`]]); }
function copyBlock(label, value, className = 'change') { const node = el('div', className); node.append(text('strong', label), text('p', value)); return node; }
function labelled(label, value, className = 'change') { const node = el('div', className); node.append(text('strong', label), pre(value)); return node; }
function pre(value, className = '') { const node = el('pre', className); node.textContent = String(value ?? 'missing'); return node; }
function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
function text(tag, value) { const node = document.createElement(tag); node.textContent = String(value ?? 'missing'); return node; }
function el(tag, className) { const node = document.createElement(tag); if (className) node.className = className; return node; }
function sameDials(a, b) { const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]); return [...keys].every((key) => a?.[key] === b?.[key]); }
