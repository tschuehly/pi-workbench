#!/usr/bin/env node
// Run before human handoff: this opens and closes one isolated, read-only review browser.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const url = process.argv[2] || 'http://127.0.0.1:4753';
const session = `skill-mode-check-${process.pid}`;
function browser(args, input) {
  const result = spawnSync('agent-browser', ['--session', session, ...args], { input, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
const evaluate = code => browser(['eval', '--stdin'], code);
try {
  browser(['open', url]);
  browser(['wait', '--fn', "!!document.querySelector('#skill-define-goal [data-proposal-slot] atelier-proposal')"]);
  evaluate(`if(!document.querySelector('#effect-define-goal').innerText.includes('hidden in this configuration')) throw Error('Vibe preview');`);
  browser(['select', '#alignment', 'Plan']);
  evaluate(`
    if(!document.querySelector('#effect-define-goal').innerText.includes('shown for task-triggered')) throw Error('Plan preview');
    if(!document.querySelector('#effect-code-review').innerText.includes('hidden in this configuration')) throw Error('Axes coupled');
  `);
  browser(['select', '#checking', 'adversarial']);
  evaluate(`
    if(!document.querySelector('#effect-code-review').innerText.includes('shown for task-triggered')) throw Error('Checking preview');
    if(!document.querySelector('#effect-to-spec').innerText.includes('manual invocation only')) throw Error('Manual rule lost');
    const data=JSON.parse(document.querySelector('#skills-data').textContent);
    if(document.querySelectorAll('#skill-nav button').length!==data.length) throw Error('Inventory count');
    for(const button of document.querySelectorAll('#skill-nav button')) {
      button.click();
      const visible=[...document.querySelectorAll('.detail')].filter(r=>!r.hidden);
      if(visible.length!==1 || visible[0].querySelectorAll('atelier-proposal').length!==1) throw Error('Detail/proposal count');
      if(!visible[0].querySelector('[data-proposal-slot] atelier-proposal')) throw Error('Proposal not beside rationale');
    }
  `);
  browser(['fill', '#search', 'no-match-for-this-filter']);
  evaluate(`document.querySelector('atelier-cockpit [data-goto="skills/to-spec"]').click()`);
  browser(['wait', '--fn', "document.querySelector('#search').value==='' && !document.querySelector('#skill-to-spec').hidden"]);
  evaluate(`if(document.querySelector('.atl-warn')) throw Error('Kernel warning')`);
  console.log('PASS: independent mode preview, manual rule, every skill reachable, one proposal per skill, cockpit reveals filtered skill. No decisions submitted.');
} finally {
  browser(['close']);
}
