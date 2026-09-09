import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonData, dialOptions, diffSkills, diffText, findPreview, instructionSummary, normalizePreviewSet, recordsFromBundle, savedCombinations } from './explorer.mjs';

test('instruction diff preserves exact unchanged, added, removed, and changed text', () => {
  const before = 'shared\nold\nanchor\nremove\ntail\n';
  const after = 'shared\nnew\nanchor\ntail\nadd\n';
  const diff = diffText(before, after);
  assert.equal(diff.status, 'compared');
  assert.deepEqual(diff.segments.map((segment) => segment.kind), ['unchanged', 'changed', 'unchanged', 'removed', 'unchanged', 'added']);
  assert.equal(diff.segments[0].text, 'shared\n');
  assert.deepEqual(diff.segments[1], { kind:'changed', before:'old\n', after:'new\n' });
  assert.equal(diff.segments[2].text, 'anchor\n');
  assert.equal(diff.segments[3].text, 'remove\n');
  assert.equal(diff.segments[4].text, 'tail\n');
  assert.equal(diff.segments[5].text, 'add\n');
  assert.equal(diff.segments.filter((segment) => segment.kind === 'unchanged').map((segment) => segment.text).join(''), 'shared\nanchor\ntail\n');
});

test('skill differences preserve saved additions, removals, description changes, and common entries', () => {
  const changes = diffSkills(
    [{name:'removed',description:'old'},{name:'changed',description:'before'},{name:'same',description:'same'}],
    [{name:'added',description:'new'},{name:'changed',description:'after'},{name:'same',description:'same'}],
  );
  assert.deepEqual(changes.added.map((item) => item.name), ['added']);
  assert.deepEqual(changes.removed.map((item) => item.name), ['removed']);
  assert.deepEqual(changes.changed, [{before:{name:'changed',description:'before'},after:{name:'changed',description:'after'}}]);
  assert.deepEqual(changes.unchanged.map((item) => item.name), ['same']);
});

test('recognized skill catalog markup leaves readable mode changes and named skill changes', () => {
  const skill = (name) => ({name,description:`${name} description`,filePath:`/skills/${name}/SKILL.md`});
  const beforeSkills = [skill('research')], afterSkills = [...beforeSkills,skill('code-review'),skill('tdd'),skill('ponytail-review')];
  const catalog = (skills) => `\n\nThe following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill's file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n\n<available_skills>\n${skills.map((item)=>`  <skill>\n    <name>${item.name}</name>\n    <description>${item.description}</description>\n    <location>${item.filePath}</location>\n  </skill>`).join('\n')}\n</available_skills>`;
  const record = (checking, skills) => ({instructions:`Shared${catalog(skills)}\n\n# Working Mode (prompt guidance)\nAlignment: Vibe. Same alignment.\nChecking: ${checking}. Saved checking behavior.\nShared close.`,instructionAvailability:{status:'available'},skills,skillAvailability:{status:'available'}});
  const comparison = comparisonData(record('unset',beforeSkills),record('adversarial',afterSkills));
  const readable = comparison.instructionDiff.segments.flatMap((segment)=>[segment.text,segment.before,segment.after]).filter(Boolean).join('');
  const exact = comparison.exactInstructionDiff.segments.flatMap((segment)=>[segment.text,segment.before,segment.after]).filter(Boolean).join('');
  assert.doesNotMatch(readable,/<skill>|<location>/); assert.match(readable,/Checking: unset/); assert.match(readable,/Checking: adversarial/); assert.match(exact,/<skill>/);
  assert.deepEqual(comparison.skillDiff.added.map((item)=>item.name),['code-review','tdd','ponytail-review']);
  const alignment = comparisonData(
    {...record('unset',beforeSkills),instructions:`Shared${catalog(beforeSkills)}\nAlignment: Vibe. Before.\nChecking: unset. Same.`},
    {...record('unset',beforeSkills),instructions:`Shared${catalog(beforeSkills)}\nAlignment: Plan. After.\nChecking: unset. Same.`},
  );
  const alignmentText=alignment.instructionDiff.segments.filter((item)=>item.kind!=='unchanged').flatMap((item)=>[item.before,item.after,item.text]).filter(Boolean).join('');
  assert.match(alignmentText,/Alignment:/); assert.doesNotMatch(alignmentText,/Checking:/); assert.equal(alignment.skillDiff.added.length+alignment.skillDiff.removed.length+alignment.skillDiff.changed.length,0);
  assert.equal(instructionSummary(record('unset',beforeSkills)).status,'recognized');
  for (const skills of [[{...beforeSkills[0],description:null}],[{...beforeSkills[0],filePath:null}]]) {
    const unrecognized={...record('unset',beforeSkills),skills};
    assert.equal(instructionSummary(unrecognized).status,'unrecognized'); assert.match(instructionSummary(unrecognized).text,/<skill>/);
  }
});

test('future dials are data-driven and missing combinations stay unavailable', () => {
  const set = normalizePreviewSet({
    id:'future',
    dialDefinitions:{ alignment:{label:'Alignment',values:['Vibe','Plan']}, checking:{label:'Checking'}, tone:{label:'Tone',values:['plain','warm']} },
    previews:[
      {id:'a',dials:{alignment:'Vibe',checking:'light',tone:'plain'},systemPrompt:'a'},
      {id:'b',dials:{alignment:'Plan',checking:'light',tone:'plain'},systemPrompt:'b'},
      {id:'c',dials:{alignment:'Vibe',checking:'tests',tone:'warm'},systemPrompt:'c'},
    ],
  });
  assert.deepEqual(set.dialKeys, ['alignment','checking','tone']);
  const selected = {alignment:'Vibe',checking:'light',tone:'plain'};
  assert.equal(findPreview(set, selected).id, 'a');
  assert.deepEqual(dialOptions(set, selected, 'alignment'), [{value:'Vibe',available:true},{value:'Plan',available:true}]);
  assert.deepEqual(dialOptions(set, selected, 'tone'), [{value:'plain',available:true},{value:'warm',available:false}]);
  assert.equal(findPreview(set, {...selected,tone:'warm'}), null);
});

test('sparse future dials retain a direct path to every saved combination', () => {
  const set=normalizePreviewSet({id:'sparse',previews:[{id:'one',dials:{a:'1',b:'1',c:'1'}},{id:'two',dials:{a:'2',b:'2',c:'2'}}]});
  const selected={a:'1',b:'1',c:'1'};
  assert.ok(['a','b','c'].every((key)=>dialOptions(set,selected,key).find((item)=>item.value==='2').available===false));
  assert.deepEqual(savedCombinations(set),[
    {id:'one',dials:{a:'1',b:'1',c:'1'},label:'A: 1 · B: 1 · C: 1'},
    {id:'two',dials:{a:'2',b:'2',c:'2'},label:'A: 2 · B: 2 · C: 2'},
  ]);
  assert.equal(findPreview(set,savedCombinations(set)[1].dials).id,'two');
});

test('legacy previews gain dial maps without changing stable Region keys or exact evidence', () => {
  const preview = {id:'vibe-unset',alignment:'Vibe',checking:'unset',systemPrompt:'saved',advertisedSkills:[]};
  const bundle = { requests:[], previewSets:[{id:'set-1',previews:[preview],sourceSnapshots:{},activeTools:[]}] };
  const { records, sets } = recordsFromBundle(bundle);
  assert.deepEqual(sets[0].previews[0].dials, {alignment:'Vibe',checking:'unset'});
  assert.equal(records[0].key, 'preview-set-1-vibe-unset');
  assert.equal(records[0].exact.preview, preview);
});

test('request records use saved provider instructions without inventing dials', () => {
  const item = { capture:{ id:'capture-1',timestamp:'now',provider:{provider:'anthropic'},transport:{kind:'http-fetch'},actualRequestInterpretation:{instructionFields:[{path:'system',value:'exact provider instructions'}]},skills:{advertisedCatalog:{skills:[]}},sourceSnapshots:{},activeTools:[] } };
  const { records } = recordsFromBundle({requests:[item],previewSets:[]});
  assert.equal(records[0].type, 'request'); assert.equal(records[0].instructions, 'exact provider instructions');
  assert.equal(records[0].dials, undefined); assert.equal(records[0].exact, item);
});

test('missing request evidence stays unavailable instead of becoming an empty comparison', () => {
  const missing={capture:{id:'missing',timestamp:'now',provider:{},transport:{kind:'missing'},actualRequestInterpretation:{status:'unavailable',instructionFields:[]},skills:{advertisedCatalog:{status:'unknown',reason:'no transport payload'}},sourceSnapshots:{},activeTools:[]},events:[{type:'native-output-link'}],nativeOutputs:{status:'missing',groupId:'group-1'}};
  const available={capture:{id:'available',timestamp:'now',provider:{},transport:{kind:'http-fetch'},actualRequestInterpretation:{status:'decoded-json',instructionFields:[{path:'system',value:'saved'}]},skills:{advertisedCatalog:{status:'observed',skills:[]}},sourceSnapshots:{},activeTools:[]}};
  const records=recordsFromBundle({requests:[missing,available]}).records, comparison=comparisonData(records[0],records[1]);
  assert.equal(records[0].instructionAvailability.status,'unavailable'); assert.equal(records[0].skillAvailability.status,'unknown');
  assert.equal(records[0].requestMetadata.events[0].type,'native-output-link'); assert.equal(records[0].summary.find(([key])=>key==='Output group')[1],'group-1');
  assert.equal(comparison.instructionAvailability.status,'unavailable'); assert.equal(comparison.instructionDiff,null); assert.equal(comparison.skillAvailability.status,'unknown'); assert.equal(comparison.skillDiff,null);
});

test('large instruction comparisons fall back truthfully without partial diff segments', () => {
  const before = 'a'.repeat(120_000), after = 'b'.repeat(120_000);
  const diff = diffText(before, after);
  assert.equal(diff.status, 'fallback');
  assert.equal(diff.before.characters, before.length);
  assert.equal(diff.after.characters, after.length);
  assert.deepEqual(diff.segments, []);
  assert.match(diff.reason, /bounded comparison budget/);
});
