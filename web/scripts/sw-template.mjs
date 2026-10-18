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
  if(u.pathname==='/sw.js'||u.pathname==='/version.json') return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate') return await cache.match('/index.html')||fetch(event.request);
    return await cache.match(event.request)||await caches.match(event.request)||fetch(event.request);
  })());
});
async function abort(reason){
  if(!update) return;
  const state=update;
  update=null;
  clearTimeout(state.timer);
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) client.postMessage({type:'ABORT_UPDATE'});
  state.port?.postMessage({ok:false,error:reason});
}
self.addEventListener('message', event => {
  const m=event.data;
  if(m?.type==='APPLY_UPDATE') event.waitUntil((async()=>{
    if(update){event.ports[0]?.postMessage({ok:false,error:'別のタブで更新を準備しています。'});return;}
    const state={token:crypto.randomUUID(),ids:new Set(),all:new Set(),port:event.ports[0],timer:null};
    update=state;
    state.timer=setTimeout(()=>abort('応答しないタブがあります。保存して閉じてから再試行してください。'),15000);
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(update!==state) return;
    if(!clients.length){await abort('アプリのタブが見つかりません。');return;}
    state.ids=new Set(clients.map(c=>c.id));state.all=new Set(state.ids);
    for(const client of clients) client.postMessage({type:'PREPARE_UPDATE',token:state.token});
  })());
  if(m?.type==='UPDATE_REFUSED'&&m.token===update?.token&&update.all.has(event.source?.id)) event.waitUntil(abort('編集中・処理中、または保存に失敗したタブがあります。入力を保持しています。'));
  if(m?.type==='UPDATE_READY'&&m.token===update?.token&&update.ids.has(event.source?.id)) event.waitUntil((async()=>{
    const state=update;
    state.ids.delete(event.source.id);
    if(state.ids.size) return;
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(update!==state) return;
    const newcomers=clients.filter(c=>!state.all.has(c.id));
    if(newcomers.length){
      for(const c of newcomers){state.ids.add(c.id);state.all.add(c.id);c.postMessage({type:'PREPARE_UPDATE',token:state.token});}
      return;
    }
    clearTimeout(state.timer);
    update=null;
    state.port?.postMessage({ok:true});
    await self.skipWaiting();
  })());
});
`;
