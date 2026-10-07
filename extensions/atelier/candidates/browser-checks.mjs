// Functions run in the browser, after check.mjs installs C (assertions and DOM helpers).
export const checks = {
  'review-filter': {
    async prepare() {
      const { q, ok, until, input, post } = C;
      await until(() => q('#review-count').textContent === '2 / 4 sichtbar');
      ok(!q('#item-a').hidden && !q('#item-d').hidden && q('#item-b').hidden && q('#item-c').hidden, 'pending predicate, including open Decision');
      const answer=await post({type:'decide',decision:'queue/item-a',key:'queue/item-a',ver:'artifact-a1',options:'Confirm|Redo',option:'Confirm'});
      q('#review-refresh').click();await until(()=>q('#item-a').hidden);
      await post({type:'undo',target:answer.seq});q('#review-refresh').click();await until(()=>!q('#item-a').hidden);
      await post({type:'decide',decision:'queue/item-a',key:'queue/item-a',ver:'older-artifact',options:'Confirm|Redo',option:'Confirm'});
      q('#review-refresh').click();await until(()=>q('#review-count').textContent==='2 / 4 sichtbar');
      input('#review-query','absent');ok(!q('#review-empty').hidden,'empty state');
      input('#review-view','all');input('#review-query','Ergebnis B');
    },
    async verify() {
      const {q,ok,until}=C;
      await until(()=>q('#review-count').textContent==='1 / 4 sichtbar');
      ok(q('#review-view').value==='all'&&q('#review-query').value==='Ergebnis B','URL controls restored');
      ok(!q('#item-b').hidden&&q('#item-a').hidden&&q('#item-c').hidden&&q('#item-d').hidden,'render matches controls after morph');
    },
    async change() { C.input('#review-view','pending');C.input('#review-query','');C.q('#review-refresh').click(); },
    async verifyChanged() {
      await C.until(()=>C.q('#review-count').textContent==='2 / 4 sichtbar');
      C.ok(!C.q('#item-a').hidden&&!C.q('#item-d').hidden&&C.q('#item-b').hidden&&C.q('#item-c').hidden,'current-version/undo projection remains correct');
    },
  },
  'video-stage': {
    async prepare() {
      const {q,ok,until}=C;window.savedVideo=q('video');
      await until(()=>savedVideo.readyState>=1);savedVideo.currentTime=1.25;
      await until(()=>Math.abs(savedVideo.currentTime-1.25)<.05);
      q('#video-size').click();ok(new URL(location.href).searchParams.get('video-size')==='small','size URL');
      q('[data-atl=comment][data-key="video-example"]').click();
      C.input('[atl-ui=composer] textarea','time-bound note');q('[atl-ui=composer] button[type=submit]').click();
      await until(()=>document.querySelector('.atl-msg')?.textContent.includes('time-bound note'));
      const page=decodeURIComponent(location.pathname.slice(1));
      const data=await(await fetch(`/.atelier/events?page=${encodeURIComponent(page)}`)).json();
      const comment=data.entries.find(e=>e.type==='comment');ok(comment.key==='video-example'&&Math.abs(comment.t-1.3)<.01,'container records media time');
    },
    async verify() {
      const {q,ok}=C;
      ok(q('video')===savedVideo&&Math.abs(savedVideo.currentTime-1.25)<.05,'media node and playback time survive');
      ok(q('#video-figure').classList.contains('small')&&q('#video-size').getAttribute('aria-pressed')==='true','size and ARIA survive');
      ok(getComputedStyle(savedVideo).filter==='none','unfiltered media');
    },
    async change() { C.q('#video-size').click(); },
    async verifyChanged() {
      C.ok(!C.q('#video-figure').classList.contains('small')&&C.q('#video-size').getAttribute('aria-pressed')==='false','listener works after Update');
      C.ok(C.q('video')===savedVideo&&Math.abs(savedVideo.currentTime-1.25)<.05,'media still retained');
    },
  },
  'review-bridge': {
    async prepare() {
      const {q,ok,until,input}=C;
      await until(()=>!q('[data-pick]').disabled);
      window.savedFrame=q('iframe');window.savedDoc=savedFrame.contentDocument;
      const w=savedFrame.contentWindow;await until(()=>savedDoc.querySelectorAll('[data-review-pins] button').length===1);
      const before=q('#bridge-state').textContent;
      dispatchEvent(new MessageEvent('message',{source:w,origin:'https://invalid.example',data:{type:'review-select',id:'send-failure'}}));
      dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'review-select',id:'send-failure'}}));
      ok(q('#bridge-state').textContent===before,'parent rejects wrong origin/source');
      w.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://invalid.example',data:{type:'review-items',items:[]}}));
      w.dispatchEvent(new MessageEvent('message',{source:w,origin:location.origin,data:{type:'review-items',items:[]}}));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      ok(savedDoc.querySelectorAll('[data-review-pins] button').length===1,'target rejects wrong origin/source');
      const old=savedDoc.querySelector('#target-send');old.replaceWith(old.cloneNode(true));
      savedDoc.querySelector('[data-review-pins] button').click();await until(()=>q('#bridge-state').textContent.includes('gewählt'));
      input('#bridge-width','390');q('[data-pick]').click();await until(()=>savedDoc.body.style.cursor==='crosshair');
      savedDoc.querySelector('#target-send').click();await until(()=>q('[name=locator]').value!=='');
      window.savedLocator=q('[name=locator]').value;
      ok(JSON.parse(savedLocator).cssPath==='#target-send','precise locator');
      dispatchEvent(new MessageEvent('message',{source:w,origin:location.origin,data:{type:'review-picked',locator:{cssPath:17}}}));
      ok(q('[name=locator]').value===savedLocator,'malformed locator rejected');
      const cyclic={...JSON.parse(savedLocator)};cyclic.extra=cyclic;
      dispatchEvent(new MessageEvent('message',{source:w,origin:location.origin,data:{type:'review-picked',locator:cyclic}}));
      ok(q('[name=locator]').value===savedLocator,'only allowlisted fields serialized');
      input('#bridge-note','Draft remains editable');q('[data-pick]').click();await until(()=>savedDoc.body.style.cursor==='crosshair');
      q('[data-atl=comment][data-key="trial-app"]').click();input('[atl-ui=composer] textarea','Kernel draft survives too');
    },
    async verify() {
      const {q,ok,until}=C;await until(()=>!q('[data-pick]').disabled);
      ok(q('iframe')===savedFrame&&savedFrame.contentDocument===savedDoc,'embedded app not reloaded');
      ok(q('iframe').style.width==='390px'&&q('#bridge-width').value==='390','viewport restored');
      ok(q('[name=locator]').value===savedLocator&&q('#bridge-locator').textContent===savedLocator,'locator rendered after morph');
      ok(q('[name=build]').value==='build-example-1'&&!q('#bridge-submit').disabled,'captured version and Request readiness');
      ok(q('#bridge-note').value==='Draft remains editable','draft note restored');
      ok(q('[atl-ui=composer] textarea').value==='Kernel draft survives too','Kernel composer retained');
      await until(()=>savedDoc.body.style.cursor==='crosshair');ok(!q('[data-cancel]').disabled,'picker mode retained');
      ok(q('#bridge-state').textContent.includes('Entwurf übernommen'),'picked status retained');
      const ui=q('[atl-ui=key][data-key="trial-app"]'), stage=q('.stage');
      ok(!stage.contains(ui)&&ui.getBoundingClientRect().top>=stage.getBoundingClientRect().bottom,'Kernel UI outside clip');
      C.hit(q('[data-atl=comment][data-key="trial-app"]'));C.hit(ui.querySelector('.atl-msg'));
    },
    async change() {
      const {q,until}=C;q('[data-cancel]').click();await until(()=>savedDoc.body.style.cursor==='');
      C.input('#bridge-width','1024');
    },
    async verifyChanged() {
      await C.until(()=>!C.q('[data-pick]').disabled);
      C.ok(C.q('iframe').style.width==='1024px'&&savedDoc.body.style.cursor===''&&C.q('[data-cancel]').disabled,'changed state survives another morph');
      C.ok(C.q('[name=locator]').value===savedLocator,'locator still retained');
      C.hit(C.q('[data-atl=comment][data-key="trial-app"]'));
    },
  },
};
