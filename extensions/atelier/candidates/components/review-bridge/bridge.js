// Original candidate; source and licence assessment in README.md. Load only in a dev build.
window.installAtelierReviewBridge = ({ dev, parentOrigin }) => {
  if (!dev || parent === window || !new URLSearchParams(location.search).has('review')) return;
  const origin = new URL(parentOrigin).origin;
  if (origin === 'null' || origin !== parentOrigin) throw new Error('Configure an exact parent origin');
  const send = data => parent.postMessage(data, origin);
  const layer = document.createElement('div'); layer.dataset.reviewPins = '';
  document.body.append(layer);
  let items = [], picking = false, queued = false;
  const target = selector => {
    try { return [...document.querySelectorAll(selector)].find(el => !layer.contains(el) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility === 'visible'); }
    catch { return undefined; }
  };
  function refresh() {
    queued = false;
    const ids = [], keep = new Set();
    items.forEach((item, i) => {
      const el = target(item.selector); if (!el) return;
      ids.push(item.id); keep.add(item.id);
      let pin = [...layer.children].find(p => p.dataset.id === item.id);
      if (!pin) {
        pin = document.createElement('button'); pin.type = 'button'; pin.dataset.id = item.id;
        pin.textContent = String(i + 1); pin.setAttribute('aria-label', `Prüfpunkt ${i + 1}`);
        pin.style.cssText = 'position:fixed;z-index:2147483646;border:2px solid #173648;background:#cceeff;color:#173648;border-radius:50%;width:28px;height:28px;';
        pin.onclick = () => send({ type: 'review-select', id: item.id }); layer.append(pin);
      }
      const r = el.getBoundingClientRect();
      pin.hidden = r.bottom < 0 || r.top > innerHeight;
      pin.style.top = `${Math.max(0, Math.min(innerHeight - 28, r.top))}px`;
      pin.style.left = `${Math.max(0, Math.min(innerWidth - 28, r.right))}px`;
    });
    [...layer.children].forEach(p => { if (!keep.has(p.dataset.id)) p.remove(); });
    send({ type: 'review-resolved', ids }); // located is NOT scenario-ready or verified
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(refresh); } };
  addEventListener('message', e => {
    if (e.source !== parent || e.origin !== origin || !e.data || typeof e.data !== 'object') return;
    const m = e.data;
    if (m.type === 'review-hello') send({ type: 'review-ready' });
    if (m.type === 'review-items' && Array.isArray(m.items) && m.items.length <= 200) {
      items = m.items.filter(x => x && typeof x.id === 'string' && /^[\w-]{1,80}$/.test(x.id) && typeof x.selector === 'string' && x.selector.length <= 500);
      items = [...new Map(items.map(x => [x.id, x])).values()]; schedule();
    }
    if (m.type === 'review-focus') target(items.find(x => x.id === m.id)?.selector)?.scrollIntoView({ block: 'nearest' });
    if (m.type === 'review-pick') { picking = true; document.body.style.cursor = 'crosshair'; }
    if (m.type === 'review-pick-off') { picking = false; document.body.style.cursor = ''; }
  });
  addEventListener('click', e => {
    if (!picking || layer.contains(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation(); picking = false; document.body.style.cursor = '';
    const el = e.target, r = el.getBoundingClientRect(), parts = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (n.id && document.querySelectorAll(`#${CSS.escape(n.id)}`).length === 1) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
      parts.unshift(`${n.localName}:nth-of-type(${[...n.parentElement.children].filter(x => x.localName === n.localName).indexOf(n) + 1})`);
    }
    send({ type: 'review-picked', locator: { cssPath: parts.join(' > '), text: el.textContent.trim().slice(0, 160),
      rect: { x: r.x / innerWidth, y: r.y / innerHeight, w: r.width / innerWidth, h: r.height / innerHeight },
      viewport: { w: innerWidth, h: innerHeight }, route: location.pathname + location.search + location.hash } });
  }, true);
  addEventListener('scroll', schedule, true); addEventListener('resize', schedule); addEventListener('hashchange', schedule);
  // ponytail: O(items × DOM) re-resolution, max 200 items; cache selectors if profiling shows churn.
  new MutationObserver(records => { if (records.some(r => !layer.contains(r.target))) schedule(); }).observe(document.body, { childList: true, subtree: true, attributes: true });
  send({ type: 'review-ready' });
};
