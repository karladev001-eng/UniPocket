export const serviceWorker = (id, assets) => `
const BUILD=${JSON.stringify(id)}, CACHE='pocket-'+BUILD, ASSETS=${JSON.stringify(assets)};
let update=null;
self.addEventListener('install', event => event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(ASSETS);
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const u=new URL(event.request.url);
  if(event.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')) return;
  // Cloudflare callbacks must reach the network to establish the Access session.
  if(u.pathname.startsWith('/cdn-cgi/')) return;
  if(u.pathname==='/sw.js'||u.pathname==='/version.json') return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate') return await cache.match('/')||fetch(event.request);
    return await cache.match(event.request)||await caches.match(event.request)||fetch(event.request);
  })());
});
async function abort(error,reason='failed'){
  if(!update) return;
  const state=update;
  update=null;
  clearTimeout(state.timer);
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) client.postMessage({type:'ABORT_UPDATE',token:state.token,error,reason});
  state.port?.postMessage({ok:false,error,reason});
}
self.addEventListener('message', event => {
  const m=event.data;
  if(m?.type==='UPDATE_ACTIVITY'&&m.protocol===2&&!update) event.waitUntil((async()=>{
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) client.postMessage({type:'RECHECK_UPDATE',recovered:m.recovered===true});
  })());
  if(m?.type==='APPLY_UPDATE') event.waitUntil((async()=>{
    if(update){event.ports[0]?.postMessage({ok:false,reason:'pending',error:'別のタブで更新を準備しています。'});return;}
    // The old version's explicit manual update can bootstrap v2.
    // New requests require editing-safe readiness from every tab.
    const state={token:crypto.randomUUID(),strict:m.protocol===2,ids:new Set(),all:new Set(),port:event.ports[0],timer:null,activating:false};
    update=state;
    state.timer=setTimeout(()=>abort('応答しないタブがあります。保存して閉じてから再試行してください。'),15000);
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(update!==state) return;
    if(!clients.length){await abort('アプリのタブが見つかりません。');return;}
    state.ids=new Set(clients.map(c=>c.id));state.all=new Set(state.ids);
    for(const client of clients) client.postMessage({type:'PREPARE_UPDATE',token:state.token,protocol:2});
  })());
  if(m?.type==='UPDATE_REFUSED'&&m.token===update?.token&&update.all.has(event.source?.id)) event.waitUntil(abort(
    m.reason==='busy'?'新版は編集・処理の終了後に自動で更新します。':'保存に失敗したタブがあります。入力を保持しています。保存後に再試行してください。',
    m.reason==='busy'?'busy':'failed'));
  if(m?.type==='UPDATE_READY'&&m.token===update?.token&&update.ids.has(event.source?.id)) event.waitUntil((async()=>{
    const state=update;
    if(state.strict&&m.protocol!==2){await abort('以前の版のタブがあります。保存してそのタブを閉じ、更新を再試行してください。','legacy');return;}
    state.ids.delete(event.source.id);
    if(state.ids.size) return;
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(update!==state||state.activating) return;
    const newcomers=clients.filter(c=>!state.all.has(c.id));
    if(newcomers.length){
      for(const c of newcomers){state.ids.add(c.id);state.all.add(c.id);c.postMessage({type:'PREPARE_UPDATE',token:state.token,protocol:2});}
      return;
    }
    state.activating=true;
    clearTimeout(state.timer);
    try {
      await self.skipWaiting();
      state.port?.postMessage({ok:true});
      // Hold the lock through activation to prevent double apply.
    } catch { await abort('新版の適用に失敗しました。入力を保持しています。再試行してください。'); }
  })());
});
`;
