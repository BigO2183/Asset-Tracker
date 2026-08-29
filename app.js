const STORAGE_KEY='resellerEstateTrackerV1.items';
const HISTORY_KEY='resellerEstateTrackerV1.history';
const ADMIN_PIN='1234';
const PREF_KEY='simpleStockV9.preferences';
const CLOUD_ENDPOINT='/.netlify/functions/inventory';
const AUTH_ENDPOINT='/.netlify/functions/auth';
const FEEDBACK_ENDPOINT='/.netlify/functions/feedback';
const AUTH_KEY='simpleStock.auth.v18';
let authState=JSON.parse(localStorage.getItem(AUTH_KEY)||'null');
let cloudEnabled=false;
let cloudSyncTimer=null;
let items=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
let history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
let prefs=JSON.parse(localStorage.getItem(PREF_KEY)||'{"recentLocations":[],"lastCategory":"","lastPlatform":"","mode":"reseller"}');
let currentMode=prefs.mode==='estate'?'estate':'reseller';
let isAdmin=false,quickFilter='all';
let bulkMode=false;
let selectedKeys=new Set();
let scannerStream=null;
let scannerTimer=null;
let currentWorkspaceLogo='';
let saveInProgress=false;
items=items.map(i=>({...i,status:i.status==='Reserved'?'Hold':(['Donated','Bulk Sale'].includes(i.status)?'Donate / Bulk':i.status)}));

const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const now=()=>new Date().toLocaleString();
const todayISO=()=>new Date().toISOString().slice(0,10);
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const save=()=>{
 if(authState?.demo)return true;
 try{
   localStorage.setItem(STORAGE_KEY,JSON.stringify(items));
   localStorage.setItem(HISTORY_KEY,JSON.stringify(history));
   return true;
 }catch(err){
   console.error('Storage save failed:',err);
   return false;
 }
};
const savePrefs=()=>{
 try{
   localStorage.setItem(PREF_KEY,JSON.stringify(prefs));
   return true;
 }catch(err){
   console.error('Preference save failed:',err);
   return false;
 }
};



function showLoading(message='Loading…'){
 $('loadingText').textContent=message;
 $('loadingOverlay').classList.remove('hidden');
}
function hideLoading(){
 $('loadingOverlay').classList.add('hidden');
}
function setSyncStatus(message,type='info'){
 const el=$('syncStatus');
 el.textContent=message;
 el.className=`sync-status ${type}`;
 el.classList.remove('hidden');
 clearTimeout(setSyncStatus.timer);
 setSyncStatus.timer=setTimeout(()=>el.classList.add('hidden'),2400);
}
function setSaving(on,message='Saving…'){
 saveInProgress=Boolean(on);
 document.body.classList.toggle('is-saving',saveInProgress);
 if(on)setSyncStatus(message,'saving');
}
function workspacePrefKey(name){
 return `simpleStock.workspace.${authState?.user?.workspaceId||'local'}.${name}`;
}
function updateOnboarding(){
 const banner=$('onboardingBanner');
 if(!banner)return;

 const dismissed=localStorage.getItem(workspacePrefKey('onboardingDismissed'))==='1';
 const scoped=modeItems();
 const show=!dismissed && scoped.length===0 && Boolean(authState?.user);

 banner.classList.toggle('hidden',!show);
 $('onboardingText').textContent=currentMode==='estate'
   ?'Add the first estate-sale item to start organizing the sale.'
   :'Add your first item to start tracking inventory, sales, and locations.';
}
function applyWorkspaceLogo(){
 const stored=localStorage.getItem(workspacePrefKey('logo'))||'';
 currentWorkspaceLogo=stored;
 const mark=$('workspaceLogoMark');
 if(!mark)return;

 if(stored){
   mark.innerHTML=`<img src="${stored}" alt="Workspace logo" />`;
   mark.classList.add('has-logo');
 }else{
   mark.textContent='SS';
   mark.classList.remove('has-logo');
 }
}
function compressLogo(file,{maxSize=300,quality=.8}={}){
 return compressPhoto(file,{maxSize,quality});
}
function friendlyError(err,fallback='Something went wrong.'){
 const message=err?.message||String(err||fallback);
 if(/network|fetch|offline/i.test(message))return 'Connection problem. Check your internet and try again.';
 if(/401|not signed in|session/i.test(message))return 'Your session expired. Please sign in again.';
 if(/403|view-only|owner access/i.test(message))return 'This account does not have permission to make that change.';
 if(/storage/i.test(message))return 'Storage is full. Download a backup or remove older photos/items.';
 return message||fallback;
}

function authHeaders(extra={}){
 return authState?.token
   ?{...extra,Authorization:`Bearer ${authState.token}`}
   :extra;
}
function setAuthState(state){
 authState=state||null;
 if(authState && !authState.demo)localStorage.setItem(AUTH_KEY,JSON.stringify(authState));
 else localStorage.removeItem(AUTH_KEY);
}
function showAuthError(message=''){
 const el=$('authError');
 if(!el)return;
 el.textContent=message;
 el.classList.toggle('hidden',!message);
}
function showAuthGate(show=true){
 $('authGate')?.classList.toggle('hidden',!show);
 document.body.classList.toggle('auth-locked',show);
}
function updateWorkspaceUI(){
 const user=authState?.user;
 if(!user)return;
 $('workspaceNameLabel').textContent=user.workspaceName||'Workspace';
 isAdmin=user.role==='owner' || Boolean(user.canEdit);
 updateAdminButton();
 applyWorkspaceLogo();
 $('addItemBtn')?.classList.toggle('disabled-nav',!isAdmin);
 $('bulkSelectBtn')?.classList.toggle('hidden',!isAdmin);
}

function updateAdminButton(){
 const btn=$('headerAdminBtn');
 if(!btn)return;
 btn.textContent=isAdmin?'Admin On':'Admin Off';
 btn.classList.toggle('admin-off',!isAdmin);
}
function switchAuthTab(tab){
 const login=tab==='login';
 $('loginTabBtn').classList.toggle('active',login);
 $('signupTabBtn').classList.toggle('active',!login);
 $('loginForm').classList.toggle('hidden',!login);
 $('signupForm').classList.toggle('hidden',login);
 showAuthError('');
}
async function authRequest(action,body,{authorized=false}={}){
 let res;
 try{
   res=await fetch(`${AUTH_ENDPOINT}?action=${encodeURIComponent(action)}`,{
     method:'POST',
     headers:authorized?authHeaders({'Content-Type':'application/json'}):{'Content-Type':'application/json'},
     body:JSON.stringify(body||{})
   });
 }catch(err){
   throw new Error('Cannot reach the SimpleStock login service. Check your connection or Netlify deployment.');
 }

 const raw=await res.text();
 let payload={};
 try{ payload=raw?JSON.parse(raw):{}; }catch{}

 if(!res.ok){
   if(payload?.error)throw new Error(payload.error);

   if(res.status===404){
     throw new Error('Login service is not deployed. Check netlify/functions/auth.mjs in GitHub.');
   }
   if(res.status===500){
     throw new Error('Login service had a server error. Check the latest Netlify function deploy.');
   }

   throw new Error(`Login service error (${res.status}).`);
 }

 if(!payload || typeof payload!=='object'){
   throw new Error('Login service returned an invalid response.');
 }

 return payload;
}

async function checkAuthService(){
 try{
   const res=await fetch(`${AUTH_ENDPOINT}?action=health`,{cache:'no-store'});
   const raw=await res.text();
   let payload={};
   try{payload=JSON.parse(raw)}catch{}

   if(!res.ok || !payload.ok){
     return {
       ok:false,
       message:res.status===404
         ?'Login backend is missing from this deployment.'
         :`Login backend error (${res.status}).`
     };
   }
   return {ok:true};
 }catch{
   return {ok:false,message:'Cannot reach the login backend.'};
 }
}
async function verifySession(){
 if(!authState?.token)return false;
 try{
   const res=await fetch(`${AUTH_ENDPOINT}?action=me`,{
     headers:authHeaders(),
     cache:'no-store'
   });
   if(!res.ok)throw new Error('Session expired');
   const payload=await res.json();
   authState.user=payload.user;
   authState.workspace=payload.workspace||authState.workspace;
   setAuthState(authState);
   return true;
 }catch(err){
   setAuthState(null);
   return false;
 }
}

function toggleAdminControls(){
 if(!(authState?.user?.role==='owner' || authState?.user?.canEdit)){
   showToast('This account is view-only');
   return;
 }
 isAdmin=!isAdmin;
 updateAdminButton();
 render();
 showToast(isAdmin?'Admin controls on':'Admin controls off');
}

async function signOut(){
 try{
   if(authState?.token && !authState?.demo){
     await fetch(`${AUTH_ENDPOINT}?action=logout`,{
       method:'POST',
       headers:authHeaders({'Content-Type':'application/json'}),
       body:'{}'
     });
   }
 }catch(err){
   console.warn('Logout request failed:',err);
 }
 setAuthState(null);
 isAdmin=false;
 bulkMode=false;
 selectedKeys.clear();
 updateAdminButton();
 cloudEnabled=false;
 items=[];
 history=[];
 localStorage.removeItem(STORAGE_KEY);
 localStorage.removeItem(HISTORY_KEY);
 showAuthGate(true);
 switchAuthTab('login');
}

function normalizeItemStatus(i){
 return {
   ...i,
   recordType:i.recordType||'reseller',
   status:i.status==='Reserved'?'Hold':(['Donated','Bulk Sale'].includes(i.status)?'Donate / Bulk':i.status)
 };
}
function mergeItems(localItems=[],cloudItems=[]){
 const map=new Map();
 const add=(item,prefer=false)=>{
   const normalized=normalizeItemStatus(item);
   const key=normalized.key || normalized.itemId || `${normalized.name}|${normalized.acquiredDate}|${normalized.location}`;
   if(prefer || !map.has(key)) map.set(key,normalized);
 };
 localItems.forEach(i=>add(i,false));
 cloudItems.forEach(i=>add(i,true));

 // Deduplicate demo / migrated rows that may have different random keys but same item ID.
 const byItemId=new Map();
 [...map.values()].forEach(item=>{
   const id=(item.itemId||'').trim();
   if(id){
     if(!byItemId.has(id)) byItemId.set(id,item);
     else {
       const existing=byItemId.get(id);
       // Prefer whichever copy contains more meaningful data.
       const score=x=>Object.values(x||{}).filter(v=>v!==''&&v!==0&&v!==null&&v!==undefined).length;
       if(score(item)>=score(existing)) byItemId.set(id,item);
     }
   } else {
     byItemId.set(`__${item.key||uid()}`,item);
   }
 });
 return [...byItemId.values()];
}
function mergeHistory(localHistory=[],cloudHistory=[]){
 const map=new Map();
 [...localHistory,...cloudHistory].forEach(h=>{
   const key=h.id || `${h.time}|${h.action}|${h.itemName}|${h.detail}`;
   if(!map.has(key)) map.set(key,h);
 });
 return [...map.values()].sort((a,b)=>String(b.time||'').localeCompare(String(a.time||''))).slice(0,500);
}
async function pushCloud({quiet=false}={}){
 if(!cloudEnabled || authState?.demo)return false;
 if(!quiet)setSaving(true,'Saving…');
 try{
   const res=await fetch(CLOUD_ENDPOINT,{
     method:'POST',
     headers:authHeaders({'Content-Type':'application/json'}),
     body:JSON.stringify({items,history})
   });
   if(!res.ok)throw new Error(`Cloud save failed (${res.status})`);
   if(!quiet)setSyncStatus('Saved everywhere ✓','success');
   return true;
 }catch(err){
   console.error(err);
   if(!quiet)setSyncStatus(friendlyError(err,'Saved on this device — cloud sync failed'),'error');
   return false;
 }finally{
   if(!quiet)setSaving(false);
 }
}
function queueCloudSync(){
 if(!cloudEnabled)return;
 clearTimeout(cloudSyncTimer);
 cloudSyncTimer=setTimeout(()=>pushCloud({quiet:true}),250);
}
async function loadCloud(){
 if(authState?.demo)return false;
 showLoading('Loading inventory…');
 try{
   const res=await fetch(CLOUD_ENDPOINT,{headers:authHeaders(),cache:'no-store'});
   if(!res.ok)throw new Error(`Cloud load failed (${res.status})`);
   const payload=await res.json();
   cloudEnabled=true;
   if(typeof payload.canEdit==='boolean'){
     authState.user.canEdit=payload.canEdit;
     isAdmin=authState.user.role==='owner'||payload.canEdit;
     updateAdminButton();
   }

   const cloudItems=payload?.data?.items || [];
   const cloudHistory=payload?.data?.history || [];

   if(payload.exists){
     const mergedItems=mergeItems(items,cloudItems);
     const mergedHistory=mergeHistory(history,cloudHistory);
     const changed=JSON.stringify(mergedItems)!==JSON.stringify(cloudItems) || JSON.stringify(mergedHistory)!==JSON.stringify(cloudHistory);
     items=mergedItems;
     history=mergedHistory;
     save();
     if(changed)await pushCloud({quiet:true});
   }else{
     // First cloud launch: migrate whatever this device already has.
     if(items.length || history.length){
       await pushCloud({quiet:true});
     }
   }

   setSyncStatus('Inventory synced ✓','success');
   return true;
 }catch(err){
   console.warn('Cloud sync unavailable; using device storage.',err);
   cloudEnabled=false;
   setSyncStatus(friendlyError(err,'Cloud sync unavailable'),'error');
   return false;
 }finally{
   hideLoading();
 }
}

const log=(action,item,detail='')=>{history.unshift({id:uid(),time:now(),actor:authState?.user?.email||'Unknown',action,itemName:item?.name||'Unknown item',detail});history=history.slice(0,500);save();queueCloudSync();};
const daysOld=i=>{const d=new Date((i.acquiredDate||todayISO())+'T12:00:00');return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));};
const profit=i=>(Number(i.soldPrice)||0)-(Number(i.cost)||0)-(Number(i.fees)||0)-(Number(i.shipping)||0);
const attention=i=>i.status==='Needs Attention'||!i.name||!i.location||(!i.askingPrice&&i.status!=='Sold'&&i.status!=='Donated')||((i.status==='Listed')&&!i.platform)||daysOld(i)>=90;



function compressPhoto(file,{maxSize=1200,quality=.72}={}){
 return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onerror=()=>reject(new Error('Could not read photo'));
   reader.onload=()=>{
     const img=new Image();
     img.onerror=()=>reject(new Error('Could not open photo'));
     img.onload=()=>{
       let width=img.naturalWidth||img.width;
       let height=img.naturalHeight||img.height;
       const scale=Math.min(1,maxSize/Math.max(width,height));
       width=Math.max(1,Math.round(width*scale));
       height=Math.max(1,Math.round(height*scale));

       const canvas=document.createElement('canvas');
       canvas.width=width;
       canvas.height=height;
       const ctx=canvas.getContext('2d',{alpha:false});
       ctx.drawImage(img,0,0,width,height);

       // JPEG keeps mobile inventory photos dramatically smaller than raw camera files.
       resolve(canvas.toDataURL('image/jpeg',quality));
     };
     img.src=reader.result;
   };
   reader.readAsDataURL(file);
 });
}


const RESELLER_STATUSES=['Unlisted','Listed','Hold','Sold','Donate / Bulk','Needs Attention'];
const ESTATE_STATUSES=['For Sale','Hold','Sold','Family Keep','Donate','Bulk Buyer','Dispose'];

function modeItems(){
 return items.filter(i=>(i.recordType||'reseller')===currentMode);
}
function setStatusOptions(selected=''){
 const select=$('status');
 const options=currentMode==='estate'?ESTATE_STATUSES:RESELLER_STATUSES;
 select.innerHTML=options.map(s=>`<option>${s}</option>`).join('');
 select.value=options.includes(selected)?selected:options[0];
}
function currentEstatePrice(i){
 const asking=Number(i.askingPrice)||0;
 if(i.discountStage==='25')return asking*.75;
 if(i.discountStage==='50')return asking*.5;
 if(i.discountStage==='final' && Number(i.finalPrice)>=0)return Number(i.finalPrice)||0;
 return asking;
}
function applyModeUI(){
 const estate=currentMode==='estate';
 $('resellerModeBtn').classList.toggle('active',!estate);
 $('estateModeBtn').classList.toggle('active',estate);

 document.querySelectorAll('.estate-only').forEach(el=>el.classList.toggle('hidden',!estate));

 const locationLabel=$('location').closest('label');
 if(locationLabel){
   locationLabel.childNodes[0].nodeValue=estate?'Room / Location':'Location';
   $('location').placeholder=estate?'Living Room, Garage, Bedroom 2…':'Garage A3, Shelf B2…';
 }
 const askLabel=$('askingPrice').closest('label');
 if(askLabel){
   askLabel.childNodes[0].nodeValue=estate?'Tag Price ($)':'Asking Price ($)';
 }

 $('searchInput').placeholder=estate?'Search estate items…':'Search items…';
 const head=$('inventorySection').querySelector('h2');
 if(head)head.textContent=estate?'Estate Inventory':'Inventory';

 setStatusOptions();
 renderRecentLocations();
 render();
}
function setMode(mode){
 currentMode=mode==='estate'?'estate':'reseller';
 prefs.mode=currentMode;
 savePrefs();
 applyModeUI();
 setView('inventory');
}

function nextItemId(){
 const nums=items.map(i=>String(i.itemId||'').match(/(\d+)$/)).filter(Boolean).map(m=>Number(m[1])).filter(Number.isFinite);
 const next=(nums.length?Math.max(...nums):0)+1;
 return `${currentMode==='estate'?'ES':'RS'}-${String(next).padStart(3,'0')}`;
}
function showToast(message){
 const t=$('toast');
 t.textContent=message;
 t.classList.remove('hidden');
 clearTimeout(showToast.timer);
 showToast.timer=setTimeout(()=>t.classList.add('hidden'),1800);
}
function rememberLocation(location){
 const value=(location||'').trim();
 if(!value)return;
 const key=currentMode==='estate'?'estateLocations':'recentLocations';
 const list=Array.isArray(prefs[key])?prefs[key]:[];
 prefs[key]=[value,...list.filter(x=>x!==value)].slice(0,6);
 savePrefs();
}
function renderRecentLocations(){
 const wrap=$('recentLocations');
 if(!wrap)return;
 const key=currentMode==='estate'?'estateLocations':'recentLocations';
 const locations=Array.isArray(prefs[key])?prefs[key]:[];
 if(!locations.length){
   wrap.innerHTML=`<span class="quick-pick-empty">No recent ${currentMode==='estate'?'rooms':'locations'} yet</span>`;
   return;
 }
 wrap.innerHTML=locations.map(loc=>`<button type="button" class="quick-pick" data-location="${esc(loc)}">${esc(loc)}</button>`).join('');
 wrap.querySelectorAll('.quick-pick').forEach(btn=>btn.addEventListener('click',()=>{$('location').value=btn.dataset.location;}));
}
function prepareFreshIntake({keepContext=true}={}){
 const keepLocation=keepContext?$('location').value:'';
 $('itemForm').reset();
 $('itemKey').value='';
 $('quantity').value=1;
 setStatusOptions(currentMode==='estate'?'For Sale':'Unlisted');
 $('acquiredDate').value=todayISO();
 $('itemId').value=nextItemId();
 if($('discountStage'))$('discountStage').value='full';
 if($('finalPrice'))$('finalPrice').value='';
 $('category').value=keepContext?(prefs.lastCategory||''):'';
 $('platform').value=keepContext?(prefs.lastPlatform||''):'';
 $('location').value=keepLocation;
 $('dialogTitle').textContent='Fast Intake';
 $('deleteItemBtn').classList.add('hidden');
 $('saveNextBtn').classList.remove('hidden');
 $('moreDetailsPanel').classList.add('hidden');
 $('moreDetailsBtn').setAttribute('aria-expanded','false');
 $('moreDetailsBtn').textContent='＋ More Details';
 setPhotoPreview('');
 toggleSaleFields();
 renderRecentLocations();
}
function buildRecord(){
 return {
  key:$('itemKey').value||uid(),
  recordType:currentMode,
  photo:$('photo').value,
  name:$('name').value.trim(),
  itemId:$('itemId').value.trim()||nextItemId(),
  category:$('category').value.trim(),
  quantity:Number($('quantity').value||1),
  location:$('location').value.trim(),
  cost:Number($('cost').value||0),
  askingPrice:Number($('askingPrice').value||0),
  platform:$('platform').value,
  status:$('status').value,
  acquiredDate:$('acquiredDate').value||todayISO(),
  soldPrice:Number($('soldPrice').value||0),
  fees:Number($('fees').value||0),
  shipping:Number($('shipping').value||0),
  notes:$('notes').value.trim(),
  discountStage:currentMode==='estate'?$('discountStage').value:'',
  finalPrice:currentMode==='estate'?Number($('finalPrice').value||0):0
 };
}
function saveCurrentItem({addAnother=false}={}){
 if(saveInProgress)return false;
 if(!$('name').value.trim()){
   $('name').focus();
   $('name').reportValidity();
   showToast('Add an item name first');
   return false;
 }

 const key=$('itemKey').value;
 const record=buildRecord();
 const previousItems=[...items];
 const previousHistory=[...history];

 if(key){
   const old=items.find(i=>i.key===key);
   items=items.map(i=>i.key===key?record:i);
   history.unshift({
     id:uid(),
     time:now(),
     actor:authState?.user?.email||'Unknown',
     action:'Updated',
     itemName:record.name,
     detail:`${old?.status||'Unknown'} → ${record.status}; ${old?.location||'No location'} → ${record.location||'No location'}`
   });
 }else{
   items.unshift(record);
   history.unshift({
     id:uid(),
     time:now(),
     actor:authState?.user?.email||'Unknown',
     action:'Added',
     itemName:record.name,
     detail:`${money(record.cost)} paid • ${record.location||'No location'} • ${record.status}`
   });
 }
 history=history.slice(0,500);

 // Save inventory before changing UI. If mobile browser storage is full,
 // keep the intake screen open and show the user exactly what happened.
 setSaving(true,'Saving item…');
 if(!save()){
   setSaving(false);
   items=previousItems;
   history=previousHistory;
   showToast('Could not save — browser storage is full');
   alert('This item could not be saved because browser storage is full. Try removing older demo items or using a smaller photo.');
   return false;
 }

 rememberLocation(record.location);
 if(record.category)prefs.lastCategory=record.category;
 if(record.platform)prefs.lastPlatform=record.platform;
 savePrefs();

 render();
 if(cloudEnabled){
   pushCloud({quiet:true}).then(ok=>setSyncStatus(ok?`${record.name} saved everywhere ✓`:`${record.name} saved on this device`,ok?'success':'error')).finally(()=>setSaving(false));
 }else{
   setSaving(false);
   setSyncStatus(`${record.name} saved ✓`,'success');
 }

 if(addAnother){
   const lastLocation=record.location;
   prepareFreshIntake({keepContext:true});
   $('location').value=lastLocation;
   setTimeout(()=>$('photoFile').click(),120);
 }else{
   if(document.activeElement && typeof document.activeElement.blur==='function'){
     document.activeElement.blur();
   }

   $('itemDialog').close();
   setView('inventory');

   requestAnimationFrame(()=>{
     requestAnimationFrame(()=>{
       const inventory=$('inventorySection');
       const topbar=document.querySelector('.topbar');
       const offset=(topbar?.offsetHeight||0)+12;
       const top=inventory.getBoundingClientRect().top+window.scrollY-offset;
       window.scrollTo({top:Math.max(0,top),behavior:'auto'});
     });
   });
 }

 return true;
}

const DEMO_PHOTOS={
  'drill-kit.webp':'data:image/webp;base64,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',
  'stand-mixer.webp':'data:image/webp;base64,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',
  'smart-tv.webp':'data:image/webp;base64,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',
  'security-cameras.webp':'data:image/webp;base64,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',
  'tool-chest.webp':'data:image/webp;base64,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',
  'brass-lamp.webp':'data:image/webp;base64,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',
  'vacuum.webp':'data:image/webp;base64,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',
  'speaker.webp':'data:image/webp;base64,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',
  'pressure-washer.webp':'data:image/webp;base64,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',
  'dresser.webp':'data:image/webp;base64,UklGRggYAABXRUJQVlA4IPwXAACwggCdASoYARgBPp1OnkylpKK2IP48GsATiWdsyucbU+iNrXIO7AIRw8TXLnZ08Eu0/kBYgOL1uQp+TP73gK4U9rZ6rP5n0alj0ZABMl6tPw+jNQdhrGK/wP++9BfDTxH/p/8Fr1VAD9Jek5p3VFhwoOBi7i0ITodQatcyRQEM4AuffeXC9uT3oL5yDmDa4gzlDHewV/QClmyYo9ljL0yVgX0muUkZ8daJHiKrXckm53s1ya7lRzgGChGIUo1Z7dAELasHbRZmzqTiXpqpsxcXqukrw1ctawBGcACTLXMC9br+b+EkKpYFObrkakEXxyKSBEn88O1ZLprGepdehJGXhFXB2VbRh1lLwrWV39VqPs5HpkWOPqkK3zTQD+whILoX0jalta5dhXylxClo/YSIIQ6CUwcWqYtJD9/gKxx+XH9Us0T3/JFB2026isRN7HDDMOXoKMUIVmCOPAefKM4sLOd9psKssKMCfzDuEfIveKNV+2m3ulL9oYue2OVD7pMWoA+F8pA2psdGVJ40hIVEyqQXpjmOFoovaq+XfsTOjUCCYm0tFih+HVNPJhSpe7ElVXyO0oeRjgZodA0DNs62gmld06K1tJ8F8/F3lb/AXTw26kUTY4JfucevtTYpdhNcfXL8uT3Jqu6CJ+S6HdFmrsoxdFacwgg6yIBa0Iz6T3577Y6lSxJImg2KnjQ45l9MOYsjnr9an5e6hHzruwABPw9IdOUAB+PC1K79rqI7YM5sp9/0aGGxo0qBNDTrfdrrhF7fV/UA+FyS5t/nIuGfDfDgyC4b7jz1aP+cf2kUg4ZvTsonCFsxDIQvqNFc2v01zfpYqrpo029MjKIKRLU+StpckjlIYYBvJh1HQhJK9Yq7FkS8s5Q1O3R0XUeXs0evu0NDodLFHX6oGNu+TAxQmeZqfax1akEbQDkQWfrSkxjpH5IYhW7iLfGc4YYpp3xb91aGFxaF9bAVZAjOc8FPvXdplCnprjdrxcXQy6f4YninbQMGeM6Bu+s67WxS9nI/IqWuU0vY1RE3INDLLWY1n2fY/ex2C65MqzMdxcFgb3aShSh68qUEcKqr8A5xzJDyAyiMvwdkJtigj4LuDQltjoaodyuTPmOKp2VKrLg2KOrj/KJM1/8V3NblsUctAJ4kPXqqtbXv8xcSUjeDba5R458O1g+ERXdaWfLnVmiAMvdodScTCJgxPgCcp0GzKow3LrJfksv7BMe+V0H6Uo23s3aZ3M6lTeYIumluJss8lgal1fKCVgZRVzTVbaNj2NzgLft7D+OsWaaioTBnJgNsGiHFP2QXweFm/zRSTWpAq5WG2YfX5KeR8OEn+BooZPKpasoGlqO2M5mhrz1AO/wxD867rtk5kAdI7oZeSwTKOlVU+af8nHLveZLeQc0AAP77/52K6qzTenJN/wDrifvHrMxp6aUMcZsKK0BuMH5npsYvxwS74S/TBeMbbFXmvaE/fCDPyB3+/FJyZFpHcPuL4RDTRx4I1/QQ4IoJuTiiCNM3ZqtEbubc43KyKNW88W9zvU9e1qhgYpnukLmR9V3zbhH+UzHTuqV9ynRXTEL8thqOedsBeyzdmp5iP3FvLI3Km/0komuzSe9JQuTZA91yUyLIMSv6e/dqD9/cv9HtZa/BXFUKPPx2yUMhnehc7VnMDVrVby9wVayNXMEWoGSCQO0OetA9Tq/sKjCAs5RLp9+7T23idc2blcR+xNpIgGpg2vpbMVimqQ79952pFbcsGR7poNBuLFEcJ0iZpkHcfIsBhOpT/VzRlrR4SoWqq1P6Fiocsvi8OYTRHO6fUh3ndq/atj9c5aZ3nnp/rXpikeP6CAqkaNB6EvzzsYjriLzlZl2kJrsEcOmkBfFGdTTHvLWCvt3f1G5HckuoVsVwAY/Zoiu3ZLd59kp3URrFLx2TDZIb89ZFj8212WZHFYfwidw+pdiBIqhp0l+AStrpLEDenZ3Y/6GxdDZTiurxB0NeWrltXvHVEtzH5ZfTOhkv3QepwNkd12TiJatEjSOIyGWQME8iA1ITyD9X7bypEwvXC/K7zXKWQTT95jeMiD3Uy8feliRD8yDmTmJSVQYmDvP2LP96vrxKOZvFrye8xvA8uMb+1V0z6SlJpU7Rrk1v98uC0EkPyeauSVQ57yWTmhOIAzRQhM9LuavcPO9PqYPybv+KKv1MYJ76PdEFPh614BVjXynUtGfUEenxkYtpmk/RdgkmbKjCe2IqCYD0a/MSbH9ubMhotnmgxZcAYAkkMwUvR5PsS3FkIIBMxSA3ZyV0xB5pMeKdbD2b0WJ80i+HmsidwqRTCbgF05fooERdkFNgYqMofBeS6cy8f5uPW19hM9xgOc7oVxzEXC/NS4c0WcQmg4Nxyb64pUZkxP3WlTNGkeYPyuQPNi3ck91VTICx/CYqgA2H/baoNci694bzNm/7IuK89br7rLcRryrVmNUP/PdP2nc6rk/dGiWynX/yapP5+9jbRoY0DpDwul4/acryqvlDAk9enN8yYMVpoag8aiR0W/6jC12EVehVx4ClC9T/gZpbK2VCIHPL/NUU2sMQz7Ur+8BHnWtiwTVKH9GPHlmMuu5jGRZEb0E5qhzZMeUT80eismW/mHZ9zEdBVQfGsNWitsrpjm1NmJHPkhnfKeScq//8aktP0hYdnlHCGUcU+z0AcXNv69IzWUYe/XN5W+jJZ7pMN1/rB4flO3B0df/zIYDIbEYBwubHc+E4IZrb+Np7aQOMELT40McDnax1pjnCtZtkupv4b36iw5W1XO5lvfuiZM9dQPsTf2J7TVqv5HX78sXibyUkuNETjTpMBimolv+u4zxdp0Za30q8zHCCBEnQdhlMceh/89pWw5GH5U+pPhMVNAcGkxj1xOR0fIsM4bWLYz4eaViGTDH4ARQ/DHKblVRRGWHwAlqYYHx1//N8rzEr9nmRdlkpPItppJ7ZMu2ItRauBOTPA8L4u69PP1p2a4/Zcm5oTcNqMBzrmTUPX7AkP9OZXQZS3ThiAkdB4Yk893DaI08pbY781dwWHKS+eb3g3Uo73Uh+7w+sWE/vd+LzekLgDYYcQlB/jjQamesxhsT9XuD4HlVmgVMqErNXmx2pUJQBcDFW+kpDPu7kmPfmABqLqwgG2SdPXqcip5/qU9oXwfKxJqZqgzl8AuBM7iDAv9ugCQvlMYx63yxsJLpnaRkJ9E7Q3f+bO3AnKYNCXWitBAJabOkPZ9tKJwnxuHh3Mj5CLGCitiX08KfFzHvsRgSIwdkSuNQr22gcdrphu3cYdUhsNfvQZmGrUABY7FlEsptHDRe45zpQHEKnLbZnP4B/dycW/3EpWLqbU5wywj4J3t/Y9eMMACdtr0+u+Q3L5Pk7NyDwC/+RH/Ejev/RAb2ytFitIymSj+nVKnD51L5lRdhTJ3S/BtIIdLkDuaLOw4Mnh19Vh+YnQBVO4F2Bs/S9ph8Bbqhj0a3ZNj8SAoc3xAHNHo+zT5p7cbUIVavqYIbIA0LkdZyMinhK5vWgtjlJS5TJ6aPx/k5cCngeecVjPbef7ChWG9tgtLGQyrHOuLjsfQYZYiWSompVliJJpkqVXRXo18gpTh82bs3MIlFZyLzEy8SjMIQ6IWEZvqEZQK9DfTk5CtVR/MmElqd/IonjEAzwtywcqVvq+ZN4Ovjbgje82/8OY9iZKfynTWXw4ci+Iwr2Qzchf/8kkCRjyYg+zvWqem81/mnYnnR5A0pVSjixpFDCs3YqFdZwxfoXi4uFyG8VlM2RRMjL2GmKvB5jZbA3zJ4jKuFmf73Pjns8h8FGxZuhoAvQG6sM+0BGuf9R7iLF/1opemuMRZs6VSLrT54iQb7Ti6wuqs6K25adiW7lN+2ocya9jwp5CkjWFGhk37n6lsVU7r8KUZ13FGdXIKmPGST5eEQvvmFrVkVlP/acGY8Ki1yXxbC6K4gTcrShPIkoXUlC1UZvs2R0P2NePeUT3T8fHnXBV7VN/DxAluA37L/Ah1huQWpQuunOZHUtQs4CM2iZjrllqQ9N5xV2CIpEQweF81VKbaUl38tJG3L4ZDvlmj8C9aQEDztuu5xYHyvcM5KEu6lrPqwzmMY2em0L1sdWSZzYECyJ9oR7ePWtfDUsDoJkbTRwJCYcRYqXQ3R3w3FEJ9sEfuwjemxFhi/06XbhG5pQYtg+SEYgkAM9nc3JqEYdbnacF8iLmd3K8R8B/7P8AKaKa8HZwVZ3CreWzNIGwyFUpwRFdUpBkGIPacs6zBkYQ2HmyoQYHUrUzQFkssFUjwUVIkGV4ssgH3Qpj8r0J0O6OcYsYDXp0uP80vf/DTAKKTj9TvlO18MLH/ii1HR1b9bifuT3aWDPE3jAXW0/bJY4eK2W+ZORZwvoZiAfWO5aNeoVmXLZb+VFk4fISlNFvLbcNPaFE3UPTMYJQ5sWLJEuirwCDAXsKWZOH21e69LszP6z0UY61XrDKjQbnddi4Pk5sKu/85i40pmZBAt2jVloaGbRH9/Twj6eCh1umTtAdfUulequOQ9Mdx08tWAh3SbzaZc6QVBqx6JR8kaS6PtHVNH0uhwwcPimYp7o7RwfQkWjDPDwcBCZpQCvXniwGAH1FV4hnLvsffUeYX9g7LH0zEjl0A32JRJXjZy5vI1Y1InLzT3cs8DO7QFjgp4T1J7J68FJ67h52909zQbuny/kGM2nVbpxPNLU06R1aRPvgMny2XEWmKbV8vGD2p2hWRnWPi+SItm1zw1mQlZ6FBIDI6Vo+j9Evs2RxzWMOXsMsvJ9eWHukU72B/cT+jgM7FjRVl16bTZostgPwqWNZMixriKyToatiznCJS/rY3t+DGyT4U0HrX24iZURXwTKI/e7BYiCVLueZ1tb66j32tSgNI1NhjxiA0G3x8VqRbp1VTBI+TOz46/9jFMp8rjPS3TtFB3TOUWaCBn56FgyZp7viElZ5kOXwb/NqrkEDE49d2h3DNgaO3KfOSk96PFWYgcknCWjGjshx/KCG0ZyIEBwA5A7Y95nrhL0ADccnODzGyRVRxpYn9edMlvxkA7cDXms2CgeSumUGZ9l0Sh6zJud7Udfz379HpR0+IVxrtRV4L1Hs4v5RRCehP8s0AEsRoS6Zxda3FLo4fa0cajF+hL2TTAzqEdoZOXueZLQ8WBhchmPmGqJfY9J5ArfUnfD2WhYC4c2sc+/YI/p+aEVyFs6sHS9k4+nBo5h4kM7EYEs6+BAgZ+r2dBosYuE+cYlXw2Nv7+py8+dQKYbKHCy3pciL3j204lFqO8O97Hp9zhFpp4ZiauLRtOkpuPQFx+4TdK9s4sQorycVP2glDVHSFss5TdF778aJPjRl0a2wAEwnb9fmWqrW7FvhudSBIIk76U+TCbkAPhPtgH94aaKH87cuOng/F6d/lZ8GIERVDC+XrT0wAel8keq8bVhbUcWgkkNahPGt+7E2bUBf8awXFi1q/seYuaCVcRjDtuZgqnnpujh8fQDJUWHrg/91VsiZaJmvnTVNberScCgTJlSoZuPy7SMJtNqjTh/lhNjpsJ5Si1dmlGFVjFxi5p7kGcwtocJ+Ug9ts6suo1uDVBCAKspq1e09c+gRArvR+hNbdjlrZJggeqKKXyOTdlebU018WWRyNCOZkyS4ZXzVm5mfgaWXtdiYs1ed7cgg+QR0TRzz2z1Dj8RK5Dnsz9kTwHvA5vMYuvEtd95cYLOk9aH5nFX4bXvMkeCPwiIQGYtk2ggbM0ZTNhkCKe1+SCz0APaB8rJmGoaoj/g8hru2eKyJQ7Y+TE6ed7IDoVR/kW7tKIqSVwGAuHEoQvTfB+PfKWgpBTwhSzd/pQ1vMiBGntQZgQa4Kou5Iq9KW9ycsxIR7vnFtn0aGFbxe9XHqByFpn+E9iL1X4sjo6nIHvdGVzTPCa6w+bB21JzNJkthRaYZkSdxJfQJIFAKC2s6Rwi8ahBh4zL+4iJjha3iz+duDBX1h4H8dHTaDxVuex3p/4SbgK2cz7v5D1UNhEAhmCO8kvF3uPOsecqivDomlb8gysxuxPi2HYnNmfQDSwLQ/eL550fe96LbPSMdsgi7GXdBQYNjjHsC4K7PUGRur2u8nTro+CHoCV9Z57IgaAJdQDblh41yQgKi/WJshaEonhn6XSoTv/0UMQkKvxbCjYzbl4X1uIX4LELC4ztINxWb/k7R2sWRK4FGADIzJABdOo+tjg97iuvGBh2rVWZT+IpmFQROKTzQJQM97FA8x1pctz4qrYHuObOUy43ETTQYNODjO9STRJ2586obg9TiziI7XVjgqc3oVri1JHRNaPv2ErYInJF5mlY4YXt8f2TG58vb4eX9R4/aWnoXre/SXSszDqHuMIRcE5tUobEemVDxSKIKAtetWKhHO4GvROalEeGxr/hf9Hs/l4l4LCZ3cj/pNFDXIb8RcCMknvTnAo8dxKC0kUk7A614UcFqp5emKuiHu/u/XxAFFKTj6xN2z+RB3I0HoC19bKxUKPOrI4kS5uS/BeZiySaUWP7n6ipno94nTTHX9Wcl3ZUqU+N5rdw0Zw1sdVISP5R9zDw/dEDD3giaRrPCLHry3o7Y3Ov2rDWXAYFSFm5s/E2PC1FyPauQCnETM87RzSN9XHAYtJZickDllbrHTxaNPOlv44UqmmOviOJdmin9KF9nBmrq1GmGC5/3G90nZX9tOcJVJiIjyIeUQK2KViVGB+IQF8tt41TsVaTv6nJV25wX4mCjXKLpm6+c3r09TTGJlbUf9LhYE2UxfQtayk6Di6uCg+JX13y6UAxFU4S6IYobXWbi5aY7BageSQqtOTt5/NN0sLxr5NUKgIjn4PFwHrwKCQGFHxBJt4yjEdd5VfjeuaTQblOSrOSqC71dpZaV0NjEc8ivc3rBOxTfYWTP9zrK7zTiXJot8KmGA0//HFqxyFbr2h8tqzSyO5wTTOF85z9GP9qtVXf4tk21AxAsYktXfwMcn+y8ClgqllBR2rrFL9TdhZ632ylPHKxdC3GD8e3aKxzDtxPb9fvoTubT/3Vee6JAm0W9XhADd6zKqefQB+i9HpHQERY/ML3J9Xqb38fnaie6eh8qr26kSPV1r3hsy60reJtipxpitc32mCU1v+PyYct4/yy2m8XfCSTlUzBqhi4zGMx3zA86IILflAj2QFi1pXhBxYKEnptiKH+DbznnMVWyexfiqABhGHkY74zpaPI/PCqEN1Ex1DXgxM8aV8whoZH0OmPvI13QAHDS+URwCtrZx7wAZdLm3J+iymgjxTMfrktYmi9mLllXfeFcwNBOis/+8M1fHVt4Up/mIXEipO/Ye4rll9s66Zy7zaU3moJKlikNNOIaRvPVlMZu4psoL+NVbtDPNdHVHl4HWi1Gvx4PvNgMTK/xXI0kKUDNa7fOi/nUwZbnuPc6KSci6iL3GZxd5mQjtmJLjeORStJGWuBTSSRNtY2yKWCipDPR0ZsMbVnOD2ad6gL3rrzemhYACgYTPnN4lEwbCUvWWKhkCYM4lz5fkluERb+Ad3WqJtmWd+ePTkC89xaNBpc+kP4YrFg4Jqe552yNxoKeuJ+cfVAwEeGYFHTBVRwgTNLUNFwwMprS2dqO//yv57B6pDhUQKxQuv1KJSMCHZiIRnxyb++ED9vtmg8cuE8zA4EPt5oESsvGz0YhqnmzMSkG0pKt6P4S8vzAa5ekGWzZgxFkpL6Q0oOgd/h8xm+NmVXfDZ2zHsel4gFS9xwlblutX9yUDg8qRCc+B0AH2FEybcIzPNdeQZlkWAOIzQazJ14P+FXIci1MMhOpAFtfRaNMXwTNQH3JHzui0Rr5oo+G3dlxoC1CbuNHYY9hf0mB/KhGHt96J0PqEg71aL0dLtLGth0Z8KtvZNyoe6u37Lo15fscd+0YUqI3LFDmgyhsELRJHEH0ORgQ7+7Wsx7fn2/l1btFpxePsLky9Iqa1FY9IEo7EC3+MqozNSFL4Hl/6o4PST4CPbPBYhKe4xhIMB/l1m2ajA4KoraxDmyeHHs54kNQETjtlG7g/HRxZZRChjQ/Vcu+s1DfSDsbVzd7ieOrJx/oOHHsn8nGq/CbkhXizkRpO8J8Yq65XZxUjhO7/uAIkP8muU8ug+t9F/PR8Iu1RuoO5rEBHDHqi+9H+VdFTm4FKDmdcLVJs0qOD9L7Qpp1w4FVKslI/5Asvb5rRckxNAMLMv0mxBTpMPQ8PUAAA=='
};

function sampleData(){
 if(items.length)return;

 const dateDaysAgo=n=>{
   const d=new Date();
   d.setDate(d.getDate()-n);
   return d.toISOString().slice(0,10);
 };

 items=[
  // ---------------- RESELLER INVENTORY ----------------
  {
   key:uid(),recordType:'reseller',name:'DeWalt 20V MAX Cordless Drill Kit',
   itemId:'RS-001',category:'Tools',quantity:1,location:'Garage Shelf A2',
   cost:25,askingPrice:75,platform:'Facebook Marketplace',status:'Listed',
   acquiredDate:dateDaysAgo(6),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Drill, battery, charger and soft bag. Tested and working.',photo:DEMO_PHOTOS['drill-kit.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'KitchenAid Artisan 5-Qt Stand Mixer',
   itemId:'RS-002',category:'Small Appliances',quantity:1,location:'Kitchen Rack B1',
   cost:40,askingPrice:140,platform:'Facebook Marketplace',status:'Listed',
   acquiredDate:dateDaysAgo(11),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Includes bowl and paddle. Light cosmetic wear.',photo:DEMO_PHOTOS['stand-mixer.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Samsung 55-Inch 4K Smart TV',
   itemId:'RS-003',category:'Electronics',quantity:1,location:'Garage TV Area',
   cost:0,askingPrice:160,platform:'Facebook Marketplace',status:'Needs Attention',
   acquiredDate:dateDaysAgo(22),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Powers on. Missing original remote. Needs model number added to listing.',photo:DEMO_PHOTOS['smart-tv.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Ring Stick Up Cam Battery',
   itemId:'RS-004',category:'Electronics',quantity:2,location:'Bin E-4',
   cost:18,askingPrice:45,platform:'eBay',status:'Listed',
   acquiredDate:dateDaysAgo(9),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Two cameras. One sealed, one open-box.',photo:DEMO_PHOTOS['security-cameras.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Craftsman Rolling Tool Chest',
   itemId:'RS-005',category:'Tools',quantity:1,location:'Garage Floor C1',
   cost:35,askingPrice:110,platform:'Local',status:'Unlisted',
   acquiredDate:dateDaysAgo(3),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Drawer slides work. Needs wipe-down before photos.',photo:DEMO_PHOTOS['tool-chest.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Vintage Brass Table Lamp',
   itemId:'RS-006',category:'Home Decor',quantity:1,location:'Shelf D-2',
   cost:8,askingPrice:55,platform:'',status:'Unlisted',
   acquiredDate:dateDaysAgo(18),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Working. Shade not included.',photo:DEMO_PHOTOS['brass-lamp.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Dyson V8 Cordless Vacuum',
   itemId:'RS-007',category:'Home Appliances',quantity:1,location:'Closet Rack A',
   cost:30,askingPrice:95,platform:'Facebook Marketplace',status:'Hold',
   acquiredDate:dateDaysAgo(15),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Battery holds charge. Buyer scheduled for pickup Saturday.',photo:DEMO_PHOTOS['vacuum.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Sonos Play:5 Wireless Speaker',
   itemId:'RS-008',category:'Audio',quantity:1,location:'Shelf E-1',
   cost:35,askingPrice:90,platform:'eBay',status:'Sold',
   acquiredDate:dateDaysAgo(29),soldPrice:82,fees:11.50,shipping:14.25,soldDate:dateDaysAgo(2),
   notes:'Tested before shipping. Packed with foam corners.',photo:DEMO_PHOTOS['speaker.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Honda 2800 PSI Pressure Washer',
   itemId:'RS-009',category:'Outdoor Equipment',quantity:1,location:'Garage Bay 2',
   cost:60,askingPrice:185,platform:'Facebook Marketplace',status:'Listed',
   acquiredDate:dateDaysAgo(41),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Starts and runs. Includes hose and wand.',photo:DEMO_PHOTOS['pressure-washer.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Solid Wood Nightstand Pair',
   itemId:'RS-010',category:'Furniture',quantity:2,location:'Storage Unit Wall B',
   cost:20,askingPrice:95,platform:'Facebook Marketplace',status:'Listed',
   acquiredDate:dateDaysAgo(67),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Pair sold together. Minor scratches on tops.',photo:DEMO_PHOTOS['dresser.webp']
  },
  {
   key:uid(),recordType:'reseller',name:'Commercial Pressure Fryer',
   itemId:'RS-011',category:'Restaurant Equipment',quantity:1,location:'Storage Unit Rear',
   cost:40,askingPrice:325,platform:'Local',status:'Sold',
   acquiredDate:dateDaysAgo(35),soldPrice:275,fees:0,shipping:0,soldDate:dateDaysAgo(5),
   notes:'Local pickup. Buyer inspected before purchase.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Milwaukee Packout Organizer',
   itemId:'RS-012',category:'Tools',quantity:1,location:'Garage Shelf A4',
   cost:12,askingPrice:40,platform:'',status:'Unlisted',
   acquiredDate:dateDaysAgo(2),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Good condition. No cracked latches.',photo:DEMO_PHOTOS['tool-chest.webp']
  },

  // ---------------- ESTATE SALE INVENTORY ----------------
  {
   key:uid(),recordType:'estate',name:'Mid-Century Walnut Dresser',
   itemId:'ES-013',category:'Furniture',quantity:1,location:'Primary Bedroom',
   cost:0,askingPrice:225,platform:'Estate Sale',status:'For Sale',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Six drawers. Minor wear consistent with age.',photo:DEMO_PHOTOS['dresser.webp'],
   discountStage:'full',finalPrice:0
  },
  {
   key:uid(),recordType:'estate',name:'Lenox China Dinnerware Set',
   itemId:'ES-014',category:'Collectibles',quantity:1,location:'Dining Room',
   cost:0,askingPrice:120,platform:'Estate Sale',status:'For Sale',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Service for 8. Two cups have small chips.',photo:'',
   discountStage:'25',finalPrice:0
  },
  {
   key:uid(),recordType:'estate',name:'Brass Floor Lamp',
   itemId:'ES-015',category:'Home Decor',quantity:1,location:'Living Room',
   cost:0,askingPrice:60,platform:'Estate Sale',status:'For Sale',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Tested and working.',photo:DEMO_PHOTOS['brass-lamp.webp'],
   discountStage:'full',finalPrice:0
  },
  {
   key:uid(),recordType:'estate',name:'Framed Coastal Oil Painting',
   itemId:'ES-016',category:'Art',quantity:1,location:'Hallway',
   cost:0,askingPrice:150,platform:'Estate Sale',status:'Hold',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Family deciding whether to keep.',photo:'',
   discountStage:'full',finalPrice:0
  },
  {
   key:uid(),recordType:'estate',name:'Patio Table with 4 Chairs',
   itemId:'ES-017',category:'Outdoor Furniture',quantity:1,location:'Lanai',
   cost:0,askingPrice:180,platform:'Estate Sale',status:'Sold',
   acquiredDate:dateDaysAgo(4),soldPrice:135,fees:0,shipping:0,soldDate:dateDaysAgo(1),
   notes:'Sold during first sale day.',photo:'',
   discountStage:'25',finalPrice:0
  },
  {
   key:uid(),recordType:'estate',name:'Craftsman Hand Tool Lot',
   itemId:'ES-018',category:'Tools',quantity:1,location:'Garage Workbench',
   cost:0,askingPrice:75,platform:'Estate Sale',status:'For Sale',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Mixed sockets, wrenches and screwdrivers sold as one lot.',photo:DEMO_PHOTOS['drill-kit.webp'],
   discountStage:'50',finalPrice:0
  },
  {
   key:uid(),recordType:'estate',name:'Leather Recliner',
   itemId:'ES-019',category:'Furniture',quantity:1,location:'Family Room',
   cost:0,askingPrice:125,platform:'Estate Sale',status:'Donate',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Did not sell. Marked for donation pickup.',photo:'',
   discountStage:'final',finalPrice:50
  },
  {
   key:uid(),recordType:'estate',name:'Holiday Decor Storage Lot',
   itemId:'ES-020',category:'Seasonal',quantity:4,location:'Garage Shelving',
   cost:0,askingPrice:80,platform:'Estate Sale',status:'Bulk Buyer',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Four plastic totes of mixed Christmas decor.',photo:'',
   discountStage:'final',finalPrice:35
  }
 ];

 history=[
  {id:uid(),time:now(),actor:'demo@simplestock.app',action:'Sold',itemName:'Commercial Pressure Fryer',detail:'Sold for $275.00 · Local pickup'},
  {id:uid(),time:now(),actor:'demo@simplestock.app',action:'Sold',itemName:'Sonos Play:5 Wireless Speaker',detail:'Sold for $82.00 · eBay'},
  {id:uid(),time:now(),actor:'demo@simplestock.app',action:'Sold',itemName:'Patio Table with 4 Chairs',detail:'Estate sale item sold for $135.00'},
  {id:uid(),time:now(),actor:'demo@simplestock.app',action:'Updated',itemName:'Leather Recliner',detail:'Final disposition changed to Donate'}
 ];

 save();
}

function updateFilters(){
 const cur=$('categoryFilter').value;
 const cats=[...new Set(modeItems().map(i=>i.category).filter(Boolean))].sort();
 $('categoryFilter').innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join('');
 $('categoryFilter').value=cats.includes(cur)?cur:'';
}
function matchesQuick(i){
 if(quickFilter==='all')return true;
 if(quickFilter==='unlisted')return i.status==='Unlisted';
 if(quickFilter==='aged')return daysOld(i)>=60&& !['Sold','Donate / Bulk','Donated','Bulk Sale'].includes(i.status);
 if(quickFilter==='attention')return attention(i);
 return true;
}
function statusClass(status=''){
 return 'status-' + status.toLowerCase().replace(/\s+/g,'-');
}
function updateStatCardState(){}

function updateBulkBar(){
 const count=selectedKeys.size;
 $('bulkBar').classList.toggle('hidden',!bulkMode);
 $('bulkCount').textContent=`${count} selected`;
 ['bulkStatusBtn','bulkLocationBtn','bulkDeleteBtn'].forEach(id=>$(id).disabled=count===0 || !isAdmin);
}

function setBulkMode(on){
 bulkMode=Boolean(on);
 if(!bulkMode)selectedKeys.clear();
 $('bulkSelectBtn').textContent=bulkMode?'Selecting…':'Select';
 updateBulkBar();
 render();
}

function bulkChangeStatus(){
 if(!isAdmin || !selectedKeys.size)return;
 const statuses=currentMode==='estate'?ESTATE_STATUSES:RESELLER_STATUSES;
 const next=prompt(`Enter status:\n${statuses.join(' / ')}`,statuses[0]);
 if(!next || !statuses.includes(next))return;
 items.forEach(i=>{if(selectedKeys.has(i.key))i.status=next;});
 log('Bulk status',{name:`${selectedKeys.size} items`},`Changed to ${next}`);
 save();queueCloudSync();setBulkMode(false);render();
}

function bulkMoveLocation(){
 if(!isAdmin || !selectedKeys.size)return;
 const next=prompt(currentMode==='estate'?'Move selected items to room/location:':'Move selected items to location:');
 if(!next?.trim())return;
 items.forEach(i=>{if(selectedKeys.has(i.key))i.location=next.trim();});
 log('Bulk move',{name:`${selectedKeys.size} items`},`Moved to ${next.trim()}`);
 save();queueCloudSync();setBulkMode(false);render();
}

function bulkDelete(){
 if(!isAdmin || !selectedKeys.size)return;
 const count=selectedKeys.size;
 if(!confirm(`Delete ${count} selected item${count===1?'':'s'}?`))return;
 items=items.filter(i=>!selectedKeys.has(i.key));
 log('Bulk deleted',{name:`${count} items`},'Removed selected inventory');
 save();queueCloudSync();setBulkMode(false);render();
}

function render(){
 updateFilters();
 updateStatCardState();
 const q=$('searchInput').value.trim().toLowerCase(),cat=$('categoryFilter').value,status=$('statusFilter').value,platform=$('platformFilter').value;
 const filtered=modeItems().filter(i=>{
  const hay=[i.name,i.itemId,i.category,i.location,i.status,i.platform,i.notes,i.discountStage].join(' ').toLowerCase();
  return(!q||hay.includes(q))&&(!cat||i.category===cat)&&(!status||i.status===status)&&(!platform||i.platform===platform)&&matchesQuick(i);
 });
 $('inventorySummary').textContent=`${filtered.length} item${filtered.length===1?'':'s'}`;
 $('inventoryList').innerHTML='';
 $('emptyState').classList.toggle('hidden',!!filtered.length);
 if(!filtered.length){
   const noItems=modeItems().length===0;
   $('emptyTitle').textContent=noItems?'Your workspace is ready':'No matching inventory records';
   $('emptyCopy').textContent=noItems
     ?'Add your first item to start tracking inventory, sales, and locations.'
     :'Try a different search or filter.';
   $('emptyAddBtn').classList.toggle('hidden',!noItems || !isAdmin);
 }
 filtered.forEach(i=>{
  const node=$('itemTemplate').content.cloneNode(true),card=node.querySelector('.item-card');
  const bulkWrap=node.querySelector('.bulk-check-wrap');
  const bulkCheck=node.querySelector('.bulk-check');
  bulkWrap.classList.toggle('hidden',!bulkMode);
  bulkCheck.checked=selectedKeys.has(i.key);
  bulkCheck.addEventListener('click',e=>e.stopPropagation());
  bulkCheck.addEventListener('change',()=>{
    if(bulkCheck.checked)selectedKeys.add(i.key); else selectedKeys.delete(i.key);
    updateBulkBar();
  });
  card.classList.toggle('bulk-mode',bulkMode);
  node.querySelector('.item-name').textContent=i.name;
  node.querySelector('.asking').textContent=i.status==='Sold'
    ?`Sold ${money(i.soldPrice)}`
    :(currentMode==='estate'?`Price ${money(currentEstatePrice(i))}`:`Ask ${money(i.askingPrice)}`);
  node.querySelector('.cost').textContent=currentMode==='estate'
    ?(i.discountStage&&i.discountStage!=='full'?`Tag ${money(i.askingPrice)}`:'')
    :`Paid ${money(i.cost)}`;

  const p=node.querySelector('.profit');
  if(i.status==='Sold'){
    p.textContent=`Profit ${money(profit(i))}`;
    p.classList.add(profit(i)>=0?'positive':'negative');
  }else p.textContent='';

  node.querySelector('.platform-text').textContent=currentMode==='estate'
    ?(i.discountStage==='25'?'25% off':i.discountStage==='50'?'50% off':i.discountStage==='final'?'Final price':'Full price')
    :(i.platform||'Not listed');
  node.querySelector('.location-text').textContent=i.location||(currentMode==='estate'?'No room':'No location');

  const img=node.querySelector('.item-thumb'),ph=node.querySelector('.placeholder-thumb');
  if(i.photo){img.src=i.photo;img.style.display='block';ph.style.display='none';}

  const statusSelect=node.querySelector('.quick-status');
  const statusOptions=currentMode==='estate'?ESTATE_STATUSES:RESELLER_STATUSES;
  statusSelect.innerHTML=statusOptions.map(s=>`<option>${s}</option>`).join('');
  statusSelect.value=i.status;
  statusSelect.disabled=!isAdmin || bulkMode;
  statusSelect.classList.add(statusClass(i.status));
  statusSelect.addEventListener('click',e=>e.stopPropagation());
  statusSelect.addEventListener('change',e=>{
    e.stopPropagation();
    if(!isAdmin){
      const statusOptions=currentMode==='estate'?ESTATE_STATUSES:RESELLER_STATUSES;
  statusSelect.innerHTML=statusOptions.map(s=>`<option>${s}</option>`).join('');
  statusSelect.value=i.status;
      openAdmin();
      return;
    }
    const newStatus=e.target.value;
    if(newStatus==='Sold'){
      openEdit(i.key);
      $('status').value='Sold';
      toggleSaleFields();
      return;
    }
    const oldStatus=i.status;
    i.status=newStatus;
    log('Status changed',i,`${oldStatus} → ${newStatus}`);
    save();
    render();
  });

  const openCard=()=>{
    if(bulkMode){
      if(selectedKeys.has(i.key))selectedKeys.delete(i.key); else selectedKeys.add(i.key);
      bulkCheck.checked=selectedKeys.has(i.key);
      updateBulkBar();
      return;
    }
    openDetails(i.key);
  };
  card.addEventListener('click',openCard);
  card.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();openCard();}
  });

  $('inventoryList').appendChild(node);
 });
 const scoped=modeItems();
 const active=currentMode==='estate'
   ?scoped.filter(i=>!['Sold','Family Keep','Donate','Bulk Buyer','Dispose'].includes(i.status))
   :scoped.filter(i=>!['Sold','Donate / Bulk','Donated','Bulk Sale'].includes(i.status));
 $('statActive').textContent=active.length;
 $('statCost').textContent=`${money(active.reduce((s,i)=>s+(Number(i.cost)||0),0))} invested`;
 $('statUnlisted').textContent=active.filter(i=>i.status==='Unlisted').length;
 $('statAged').textContent=active.filter(i=>daysOld(i)>=60).length;
 $('statAttention').textContent=active.filter(attention).length;
 if($('summaryUnlisted')) $('summaryUnlisted').textContent=currentMode==='estate'
   ?active.filter(i=>i.status==='For Sale').length
   :active.filter(i=>i.status==='Unlisted').length;
 if($('summaryAged')) $('summaryAged').textContent=active.filter(i=>daysOld(i)>=60).length;
 const summarySpans=document.querySelectorAll('.simple-summary > span');
 if(summarySpans[2]){
   summarySpans[2].innerHTML=currentMode==='estate'
     ?`<strong id="summaryUnlisted">${active.filter(i=>i.status==='For Sale').length}</strong> for sale`
     :`<strong id="summaryUnlisted">${active.filter(i=>i.status==='Unlisted').length}</strong> ready to list`;
 }
 if(summarySpans[4]){
   summarySpans[4].innerHTML=currentMode==='estate'
     ?`<strong id="summaryAged">${scoped.filter(i=>i.status==='Sold').length}</strong> sold`
     :`<strong id="summaryAged">${active.filter(i=>daysOld(i)>=60).length}</strong> over 60 days`;
 }
 $('potentialRevenue').textContent=money(active.reduce((s,i)=>s+(Number(i.askingPrice)||0),0));
 const sold=modeItems().filter(i=>i.status==='Sold');
 $('soldRevenue').textContent=money(sold.reduce((s,i)=>s+(Number(i.soldPrice)||0),0));
 $('netProfit').textContent=money(sold.reduce((s,i)=>s+profit(i),0));
 renderHistory();
 if($('reportsSection')&&!$('reportsSection').classList.contains('hidden')) renderReports();
 updateBulkBar();
 updateOnboarding();
 setTimeout(updateNavScrollHint,30);
}
function renderHistory(){
 const sold=modeItems().filter(i=>i.status==='Sold');
 if($('salesCount')) $('salesCount').textContent=sold.length;
 if($('salesRevenue')) $('salesRevenue').textContent=money(sold.reduce((s,i)=>s+(Number(i.soldPrice)||0),0));
 if($('salesProfit')) $('salesProfit').textContent=money(sold.reduce((s,i)=>s+profit(i),0));

 if($('soldList')){
   $('soldList').innerHTML=sold.length?sold.map(i=>`
    <button class="sold-row" type="button" data-key="${esc(i.key)}">
      <div>
        <strong>${esc(i.name)}</strong>
        <span>${esc(i.platform||'No platform')}${i.soldDate?` · Sold ${esc(i.soldDate)}`:` · ${daysOld(i)} days held`}</span>
      </div>
      <div class="sold-money">
        <strong>${money(i.soldPrice)}</strong>
        <span class="${profit(i)>=0?'positive':'negative'}">${money(profit(i))} profit</span>
      </div>
    </button>`).join(''):'<div class="empty-state compact-empty">No sold items yet.</div>';

   $('soldList').querySelectorAll('.sold-row').forEach(row=>{
     row.addEventListener('click',()=>openDetails(row.dataset.key));
   });
 }

 $('historyList').innerHTML=history.length
  ?history.slice(0,30).map(h=>`<div class="history-entry"><strong>${esc(h.action)} — ${esc(h.itemName)}</strong><div>${esc(h.detail||'')}</div><small>${esc(h.actor||'Unknown user')} · ${esc(h.time)}</small></div>`).join('')
  :'<div class="empty-state compact-empty">No activity yet.</div>';
}



function findCode(code){
 const q=String(code||'').trim().toLowerCase();
 if(!q)return null;
 return items.find(i=>
   String(i.itemId||'').toLowerCase()===q ||
   String(i.barcode||'').toLowerCase()===q
 );
}

function searchScannedCode(code){
 const item=findCode(code);
 stopScanner();
 $('scannerDialog').close();
 if(item){
   if((item.recordType||'reseller')!==currentMode)setMode(item.recordType||'reseller');
   openDetails(item.key);
 }else{
   $('searchInput').value=code;
   setView('inventory');
   render();
   showToast('No exact match — showing search');
 }
}

async function openScanner(){
 $('scannerDialog').showModal();
 $('scannerStatus').textContent='Opening camera…';
 if(!('BarcodeDetector' in window)){
   $('scannerStatus').textContent='Camera scanning is not supported here. Enter the code below.';
   return;
 }
 try{
   const formats=await BarcodeDetector.getSupportedFormats();
   const detector=new BarcodeDetector({formats:formats.filter(f=>['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e'].includes(f))});
   scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
   $('scannerVideo').srcObject=scannerStream;
   $('scannerStatus').textContent='Camera ready. Point at a barcode or QR code.';
   await $('scannerVideo').play();

   const tick=async()=>{
     if(!scannerStream)return;
     try{
       const codes=await detector.detect($('scannerVideo'));
       if(codes.length){
         searchScannedCode(codes[0].rawValue);
         return;
       }
     }catch{}
     scannerTimer=setTimeout(tick,250);
   };
   tick();
 }catch(err){
   $('scannerStatus').textContent='Camera unavailable. Enter the code below.';
 }
}

function stopScanner(){
 clearTimeout(scannerTimer);
 scannerTimer=null;
 if(scannerStream){
   scannerStream.getTracks().forEach(t=>t.stop());
   scannerStream=null;
 }
 if($('scannerVideo'))$('scannerVideo').srcObject=null;
}

async function renderSettings(){
 const user=authState?.user;
 if(!user)return;
 $('settingsWorkspaceName').value=user.workspaceName||'';
 $('settingsDefaultMode').value=user.defaultMode==='estate'?'estate':'reseller';
 $('settingsEmail').textContent=user.email||'';
 $('settingsRole').textContent=user.role==='owner'?'Owner':(user.canEdit?'Staff · Can edit':'Staff · View only');
 const logo=localStorage.getItem(workspacePrefKey('logo'))||'';
 $('settingsLogoPreview').classList.toggle('hidden',!logo);
 if(logo)$('settingsLogoPreview').innerHTML=`<img src="${logo}" alt="Workspace logo preview" />`;
 $('staffSettingsCard').classList.toggle('hidden',user.role!=='owner');
 if(user.role==='owner')await loadStaff();
}

async function loadStaff(){
 try{
   const res=await fetch(`${AUTH_ENDPOINT}?action=staff`,{headers:authHeaders(),cache:'no-store'});
   const payload=await res.json();
   if(!res.ok)throw new Error(payload.error||'Could not load staff');
   const staff=payload.staff||[];
   $('staffList').innerHTML=staff.length?staff.map(s=>`
     <div class="staff-row">
       <div><strong>${esc(s.email)}</strong><span>${s.canEdit?'Can edit':'View only'}</span></div>
       <div>
         <button type="button" class="staff-reset" data-email="${esc(s.email)}">Reset Password</button>
         <button type="button" class="staff-remove" data-email="${esc(s.email)}">Remove</button>
       </div>
     </div>`).join(''):'<div class="settings-empty">No staff accounts yet.</div>';

   $('staffList').querySelectorAll('.staff-reset').forEach(btn=>btn.addEventListener('click',async()=>{
     const password=prompt(`New temporary password for ${btn.dataset.email}:`);
     if(!password)return;
     try{
       await authRequest('reset_staff_password',{email:btn.dataset.email,password},{authorized:true});
       showToast('Staff password reset ✓');
     }catch(err){showToast(err.message);}
   }));

   $('staffList').querySelectorAll('.staff-remove').forEach(btn=>btn.addEventListener('click',async()=>{
     if(!confirm(`Remove ${btn.dataset.email} from this workspace?`))return;
     try{
       await authRequest('remove_staff',{email:btn.dataset.email},{authorized:true});
       showToast('Staff removed ✓');
       await loadStaff();
     }catch(err){showToast(err.message);}
   }));
 }catch(err){
   $('staffList').innerHTML=`<div class="settings-empty">${esc(err.message)}</div>`;
 }
}

function downloadBackup(){
 const backup={
   version:22,
   checksum:`${items.length}:${history.length}:${todayISO()}`,
   workspace:{
     name:authState?.user?.workspaceName||'SimpleStock',
     defaultMode:authState?.user?.defaultMode||'reseller'
   },
   exportedAt:new Date().toISOString(),
   items,
   history
 };
 const a=document.createElement('a');
 a.href=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
 a.download=`simplestock-backup-${todayISO()}.json`;
 a.click();
 URL.revokeObjectURL(a.href);
}

async function restoreBackupFile(file){
 if(!isAdmin){showToast('Edit access required');return;}
 try{
   const text=await file.text();
   const data=JSON.parse(text);
   if(!Array.isArray(data.items)||!Array.isArray(data.history))throw new Error('Invalid SimpleStock backup');
   if(data.version && Number(data.version)<21)throw new Error('This backup is too old to restore safely');
   if(!confirm(`Restore ${data.items.length} items? This replaces the current workspace data.`))return;
   items=data.items.map(normalizeItemStatus);
   history=data.history;
   if(!save())throw new Error('Could not save backup on this device');
   await pushCloud({quiet:true});
   render();
   showToast('Backup restored ✓');
 }catch(err){
   alert(`Restore failed: ${err.message}`);
 }
}

function reportScopedItems(){
 return modeItems();
}

function runPermissionSelfCheck(){
 const user=authState?.user;
 const checks=[
   {name:'Signed in',ok:Boolean(user)},
   {name:'Workspace assigned',ok:Boolean(user?.workspaceId)},
   {name:'Role recognized',ok:['owner','staff'].includes(user?.role)||Boolean(authState?.demo)},
   {name:'Edit permission',ok:user?.role==='owner'||typeof user?.canEdit==='boolean'||Boolean(authState?.demo)}
 ];
 const failed=checks.filter(c=>!c.ok);
 return {checks,ok:failed.length===0,failed};
}

function renderReports(){
 const scoped=reportScopedItems();
 const estate=currentMode==='estate';

 const sold=scoped.filter(i=>i.status==='Sold');
 const active=estate
   ?scoped.filter(i=>!['Sold','Family Keep','Donate','Bulk Buyer','Dispose'].includes(i.status))
   :scoped.filter(i=>!['Sold','Donate / Bulk','Donated','Bulk Sale'].includes(i.status));

 const activeCost=active.reduce((s,i)=>s+(Number(i.cost)||0),0);
 const potential=active.reduce((s,i)=>s+(estate?currentEstatePrice(i):(Number(i.askingPrice)||0)),0);
 const revenue=sold.reduce((s,i)=>s+(Number(i.soldPrice)||0),0);
 const net=sold.reduce((s,i)=>s+profit(i),0);
 const avg=sold.length?net/sold.length:0;

 $('reportActiveCount').textContent=active.length;
 $('reportActiveCost').textContent=`${money(activeCost)} invested`;
 $('reportPotential').textContent=money(potential);
 $('reportSoldRevenue').textContent=money(revenue);
 $('reportSoldCount').textContent=`${sold.length} sold`;
 $('reportNetProfit').textContent=money(net);
 $('reportAverageProfit').textContent=`${money(avg)} avg per sale`;

 const ages=active.map(daysOld);
 $('age0to29').textContent=ages.filter(d=>d<30).length;
 $('age30to59').textContent=ages.filter(d=>d>=30&&d<60).length;
 $('age60to89').textContent=ages.filter(d=>d>=60&&d<90).length;
 $('age90plus').textContent=ages.filter(d=>d>=90).length;

 const counts={};
 scoped.forEach(i=>{
   const c=(i.category||'Uncategorized').trim()||'Uncategorized';
   counts[c]=(counts[c]||0)+1;
 });
 const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
 $('categoryReport').innerHTML=top.length
   ?top.map(([name,count])=>`<div><span>${esc(name)}</span><strong>${count}</strong></div>`).join('')
   :'<div class="report-empty">No categories yet.</div>';

 $('estateDispositionPanel').classList.toggle('hidden',!estate);
 if(estate){
   $('dispForSale').textContent=scoped.filter(i=>i.status==='For Sale').length;
   $('dispSold').textContent=sold.length;
   $('dispFamily').textContent=scoped.filter(i=>i.status==='Family Keep').length;
   $('dispDonate').textContent=scoped.filter(i=>i.status==='Donate').length;
   $('dispBulk').textContent=scoped.filter(i=>i.status==='Bulk Buyer').length;
   $('dispDispose').textContent=scoped.filter(i=>i.status==='Dispose').length;
 }
}

function downloadCsv(filename,headers,rows){
 const csv=[headers,...rows]
   .map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','))
   .join('\n');
 const a=document.createElement('a');
 a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
 a.download=filename;
 a.click();
 URL.revokeObjectURL(a.href);
}

function exportInventoryReport(){
 const scoped=modeItems();
 const headers=['Mode','Item','ID','Category','Location','Status','Cost','Asking/Tag Price','Current Price','Platform','Date Acquired','Days Held','Quantity','Notes'];
 const rows=scoped.map(i=>[
   (i.recordType||'reseller')==='estate'?'Estate Sale':'Reseller',
   i.name,
   i.itemId,
   i.category,
   i.location,
   i.status,
   i.cost,
   i.askingPrice,
   (i.recordType||'reseller')==='estate'?currentEstatePrice(i):i.askingPrice,
   i.platform,
   i.acquiredDate,
   daysOld(i),
   i.quantity,
   i.notes
 ]);
 downloadCsv(`simplestock-${currentMode}-inventory-${todayISO()}.csv`,headers,rows);
}

function exportSalesReport(){
 const scoped=modeItems().filter(i=>i.status==='Sold');
 const headers=['Mode','Item','ID','Category','Sold Price','Cost','Fees','Shipping','Net Profit','Date Sold','Platform','Location'];
 const rows=scoped.map(i=>[
   (i.recordType||'reseller')==='estate'?'Estate Sale':'Reseller',
   i.name,
   i.itemId,
   i.category,
   i.soldPrice,
   i.cost,
   i.fees,
   i.shipping,
   profit(i),
   i.soldDate||'',
   i.platform,
   i.location
 ]);
 downloadCsv(`simplestock-${currentMode}-sales-${todayISO()}.csv`,headers,rows);
}

let activeDetailKey=null;

function openDetails(key){
 const i=items.find(x=>x.key===key);
 if(!i)return;

 activeDetailKey=i.key;
 $('detailsName').textContent=i.name;
 $('inlineEditPanel').classList.add('hidden');
 $('detailsBody').classList.remove('hidden');
 $('detailsSaveBtn').classList.add('hidden');
 $('detailsCancelBtn').classList.add('hidden');
 $('detailsEditBtn').classList.toggle('hidden',!isAdmin);
 $('duplicateItemBtn').classList.toggle('hidden',!isAdmin);
 $('quickSellBtn').classList.toggle('hidden',i.status==='Sold'||!isAdmin);

 const age=daysOld(i);
 const estate=(i.recordType||'reseller')==='estate';

 $('detailsBody').innerHTML=`
   <div class="detail-hero">
     <strong>${i.status==='Sold'?`Sold ${money(i.soldPrice)}`:(estate?`Price ${money(currentEstatePrice(i))}`:`Ask ${money(i.askingPrice)}`)}</strong>
     ${estate?'':`<span>Paid ${money(i.cost)}</span>`}
     ${i.status==='Sold'?`<span class="${profit(i)>=0?'positive':'negative'}">${money(profit(i))} profit</span>`:''}
   </div>
   <div class="detail-list">
     <div><span>Status</span><strong>${esc(i.status)}</strong></div>
     <div><span>${estate?'Room':'Location'}</span><strong>${esc(i.location||(estate?'No room':'No location'))}</strong></div>
     ${estate
       ?`<div><span>Sale Stage</span><strong>${i.discountStage==='25'?'25% Off':i.discountStage==='50'?'50% Off':i.discountStage==='final'?'Final Price':'Full Price'}</strong></div>
          <div><span>Current Price</span><strong>${money(currentEstatePrice(i))}</strong></div>`
       :`<div><span>Platform</span><strong>${esc(i.platform||'Not listed')}</strong></div>`}
     <div><span>Category</span><strong>${esc(i.category||'—')}</strong></div>
     <div><span>Item ID</span><strong>${esc(i.itemId||'—')}</strong></div>
     <div><span>Age</span><strong>${age} day${age===1?'':'s'}</strong></div>
     <div><span>Quantity</span><strong>${Number(i.quantity)||1}</strong></div>
     ${i.status==='Sold'&&i.soldDate?`<div><span>Date Sold</span><strong>${esc(i.soldDate)}</strong></div>`:''}
   </div>
   ${i.notes?`<div class="detail-note"><span>Notes</span><p>${esc(i.notes)}</p></div>`:''}
 `;

 $('detailsDialog').showModal();
}

function beginInlineEdit(){
 const i=items.find(x=>x.key===activeDetailKey);
 if(!i||!isAdmin)return;

 const estate=(i.recordType||'reseller')==='estate';
 const statuses=estate?ESTATE_STATUSES:RESELLER_STATUSES;

 $('detailEditStatus').innerHTML=statuses.map(s=>`<option>${s}</option>`).join('');
 $('detailEditName').value=i.name||'';
 $('detailEditStatus').value=i.status||statuses[0];
 $('detailEditLocation').value=i.location||'';
 $('detailEditPlatform').value=i.platform||'';
 $('detailEditCategory').value=i.category||'';
 $('detailEditItemId').value=i.itemId||'';
 $('detailEditQuantity').value=Number(i.quantity)||1;
 $('detailEditAsking').value=Number(i.askingPrice)||0;
 $('detailEditCost').value=Number(i.cost)||0;
 $('detailEditDiscountStage').value=i.discountStage||'full';
 $('detailEditFinalPrice').value=Number(i.finalPrice)||0;
 $('detailEditNotes').value=i.notes||'';

 document.querySelectorAll('.detail-estate-only').forEach(el=>el.classList.toggle('hidden',!estate));
 document.querySelectorAll('.detail-reseller-only').forEach(el=>el.classList.toggle('hidden',estate));

 $('detailsBody').classList.add('hidden');
 $('inlineEditPanel').classList.remove('hidden');
 $('detailsEditBtn').classList.add('hidden');
 $('detailsSaveBtn').classList.remove('hidden');
 $('detailsCancelBtn').classList.remove('hidden');

 setTimeout(()=>$('detailEditName').focus(),60);
}

function cancelInlineEdit(){
 const i=items.find(x=>x.key===activeDetailKey);
 if(!i)return;
 openDetails(activeDetailKey);
}

async function saveInlineEdit(){
 const i=items.find(x=>x.key===activeDetailKey);
 if(!i||!isAdmin)return;

 const newName=$('detailEditName').value.trim();
 if(!newName){
   $('detailEditName').focus();
   showToast('Item name is required');
   return;
 }

 const oldStatus=i.status;
 const oldLocation=i.location;

 i.name=newName;
 i.status=$('detailEditStatus').value;
 i.location=$('detailEditLocation').value.trim();
 i.platform=(i.recordType||'reseller')==='estate'?'':$('detailEditPlatform').value;
 i.category=$('detailEditCategory').value.trim();
 i.itemId=$('detailEditItemId').value.trim();
 i.quantity=Math.max(1,Number($('detailEditQuantity').value)||1);
 i.askingPrice=Math.max(0,Number($('detailEditAsking').value)||0);
 i.cost=Math.max(0,Number($('detailEditCost').value)||0);
 i.notes=$('detailEditNotes').value.trim();

 if((i.recordType||'reseller')==='estate'){
   i.discountStage=$('detailEditDiscountStage').value;
   i.finalPrice=Math.max(0,Number($('detailEditFinalPrice').value)||0);
 }

 history.unshift({
   id:uid(),
   time:now(),
   actor:authState?.user?.email||'Unknown',
   action:'Corrected',
   itemName:i.name,
   detail:`${oldStatus} → ${i.status}; ${oldLocation||'No location'} → ${i.location||'No location'}`
 });
 history=history.slice(0,500);

 if(!save()){
   showToast('Could not save changes');
   return;
 }

 queueCloudSync();
 render();
 showToast(`${i.name} updated ✓`);
 openDetails(i.key);
}



function duplicateActiveItem(){
 const source=items.find(x=>x.key===activeDetailKey);
 if(!source || !isAdmin)return;

 const copy={
   ...source,
   key:uid(),
   itemId:nextItemId(),
   name:`${source.name} Copy`,
   acquiredDate:todayISO(),
   status:(source.recordType||'reseller')==='estate'?'For Sale':'Unlisted',
   soldPrice:0,
   fees:0,
   shipping:0,
   soldDate:''
 };

 items.unshift(copy);
 log('Duplicated',copy,`Copied from ${source.itemId||source.name}`);
 save();queueCloudSync();
 $('detailsDialog').close();
 render();
 showToast(`${copy.name} added ✓`);
}

function openQuickSell(){
 const i=items.find(x=>x.key===activeDetailKey);
 if(!i)return;

 if(!isAdmin){
   openAdmin();
   return;
 }

 $('quickSellName').textContent=`Sell ${i.name}`;
 $('quickSoldPrice').value=Number(i.soldPrice)||Number(i.askingPrice)||0;
 $('quickFees').value=Number(i.fees)||0;
 $('quickShipping').value=Number(i.shipping)||0;
 $('quickSoldDate').value=i.soldDate||todayISO();
 updateQuickProfitPreview();
 $('quickSellDialog').showModal();
 setTimeout(()=>$('quickSoldPrice').focus(),60);
}

function updateQuickProfitPreview(){
 const i=items.find(x=>x.key===activeDetailKey);
 if(!i)return;
 const sold=Number($('quickSoldPrice').value)||0;
 const fees=Number($('quickFees').value)||0;
 const shipping=Number($('quickShipping').value)||0;
 const p=sold-(Number(i.cost)||0)-fees-shipping;
 $('quickProfitPreview').textContent=`Estimated net profit: ${money(p)}`;
 $('quickProfitPreview').classList.toggle('negative',p<0);
}

async function completeQuickSell(){
 const i=items.find(x=>x.key===activeDetailKey);
 if(!i||!isAdmin)return;

 const soldPrice=Number($('quickSoldPrice').value)||0;
 const fees=Number($('quickFees').value)||0;
 const shipping=Number($('quickShipping').value)||0;
 const soldDate=$('quickSoldDate').value||todayISO();

 if(soldPrice<=0){
   $('quickSoldPrice').focus();
   showToast('Enter the sold price');
   return;
 }

 const oldStatus=i.status;
 i.status='Sold';
 i.soldPrice=soldPrice;
 i.fees=fees;
 i.shipping=shipping;
 i.soldDate=soldDate;

 history.unshift({
   id:uid(),
   time:now(),
   actor:authState?.user?.email||'Unknown',
   action:'Sold',
   itemName:i.name,
   detail:`${oldStatus} → Sold • ${money(soldPrice)} sale • ${money(profit(i))} profit`
 });
 history=history.slice(0,500);

 if(!save()){
   showToast('Could not save sale');
   return;
 }

 queueCloudSync();
 render();
 renderHistory();
 $('quickSellDialog').close();
 $('detailsDialog').close();
 setView('history');
 showToast(`${i.name} sold ✓`);
}

function setPhotoPreview(src=''){
 $('photo').value=src;
 $('photoPreview').src=src;
 $('photoPreview').style.display=src?'block':'none';
 $('photoPlaceholder').style.display=src?'none':'grid';
}
function setView(view){
 const inventory=view==='inventory';
 const sales=view==='history';
 const reports=view==='reports';
 const settings=view==='settings';

 $('inventorySection').classList.toggle('hidden',!inventory);
 $('historySection').classList.toggle('hidden',!sales);
 $('reportsSection').classList.toggle('hidden',!reports);
 $('settingsSection').classList.toggle('hidden',!settings);

 $('showInventoryBtn')?.classList.toggle('active-tab',inventory);
 $('showHistoryBtn')?.classList.toggle('active-tab',sales);
 $('showReportsBtn')?.classList.toggle('active-tab',reports);
 $('showSettingsBtn')?.classList.toggle('active-tab',settings);

 if($('viewLabel')) $('viewLabel').textContent=inventory?'Inventory':sales?'Sales':reports?'Reports':'Settings';

 if(sales) renderHistory();
 if(reports) renderReports();
 if(settings) renderSettings();
}
function openAdd(){
 if(!isAdmin){showToast('This account is view-only');return;}
 prepareFreshIntake({keepContext:false});
 $('itemDialog').showModal();
 setTimeout(()=>$('photoFile').click(),120);
}
function openEdit(key){
 if(!isAdmin)return;
 const i=items.find(x=>x.key===key);
 if(!i)return;
 if((i.recordType||'reseller')!==currentMode){
   currentMode=i.recordType||'reseller';
   prefs.mode=currentMode;
   savePrefs();
   applyModeUI();
 }
 setStatusOptions(i.status);
 for(const id of ['name','itemId','category','location','cost','askingPrice','platform','status','acquiredDate','quantity','soldPrice','fees','shipping','notes','discountStage','finalPrice']){
   if($(id))$(id).value=i[id]??(id==='discountStage'?'full':'');
 }
 $('itemKey').value=i.key;
 $('dialogTitle').textContent='Edit Item';
 $('deleteItemBtn').classList.remove('hidden');
 $('saveNextBtn').classList.add('hidden');
 $('moreDetailsPanel').classList.remove('hidden');
 $('moreDetailsBtn').setAttribute('aria-expanded','true');
 $('moreDetailsBtn').textContent='− Less Details';
 setPhotoPreview(i.photo||'');
 toggleSaleFields();
 $('itemDialog').showModal();
}
function openAdmin(){
 if(authState?.user?.role==='owner'||authState?.user?.canEdit){
   isAdmin=true;
   updateAdminButton();
   return;
 }
 showToast('This account is view-only');
}
function toggleSaleFields(){
 const sold=$('status').value==='Sold';
 document.querySelectorAll('.sale-only').forEach(el=>el.classList.toggle('hidden',!sold));
 updateProfitPreview();
}
function updateProfitPreview(){
 if($('status').value!=='Sold'){
   $('profitPreview').classList.add('hidden');
   return;
 }
 const p=(Number($('soldPrice').value)||0)-(Number($('cost').value)||0)-(Number($('fees').value)||0)-(Number($('shipping').value)||0);
 $('profitPreview').textContent=`Estimated net profit: ${money(p)}`;
 $('profitPreview').classList.remove('hidden');
}

$('photoFile').addEventListener('change',async e=>{
 const f=e.target.files?.[0];
 if(!f)return;

 try{
   showToast('Preparing photo…');
   const compressed=await compressPhoto(f);
   setPhotoPreview(compressed);
   showToast('Photo ready ✓');
 }catch(err){
   console.error(err);
   alert('That photo could not be prepared. Please try another photo.');
 }
});
$('status').addEventListener('change',toggleSaleFields);
['soldPrice','cost','fees','shipping'].forEach(id=>$(id).addEventListener('input',updateProfitPreview));
$('itemForm').addEventListener('submit',e=>e.preventDefault());
$('saveItemBtn').addEventListener('click',e=>{
 e.preventDefault();
 e.stopPropagation();
 saveCurrentItem({addAnother:false});
});
$('saveNextBtn').addEventListener('click',()=>saveCurrentItem({addAnother:true}));
$('deleteItemBtn').addEventListener('click',()=>{
 const key=$('itemKey').value,i=items.find(x=>x.key===key);
 if(!i||!confirm(`Delete ${i.name}?`))return;
 items=items.filter(x=>x.key!==key);
 log('Deleted',i,'Removed from inventory');
 save();
 queueCloudSync();
 $('itemDialog').close();
 render();
});
$('adminForm')?.addEventListener('submit',e=>e.preventDefault());
$('adminToggle')?.addEventListener('click',signOut);
$('headerSignOutBtn')?.addEventListener('click',signOut);
$('headerAdminBtn')?.addEventListener('click',toggleAdminControls);
['searchInput','categoryFilter','statusFilter','platformFilter'].forEach(id=>$(id).addEventListener(id==='searchInput'?'input':'change',()=>{quickFilter='all';render();}));
$('moreFiltersBtn').addEventListener('click',()=>{
 const panel=$('advancedFilters');
 const opening=panel.classList.contains('hidden');
 panel.classList.toggle('hidden',!opening);
 $('moreFiltersBtn').setAttribute('aria-expanded',opening?'true':'false');
});
$('clearFiltersBtn').addEventListener('click',()=>{
 $('searchInput').value='';
 $('categoryFilter').value='';
 $('statusFilter').value='';
 $('platformFilter').value='';
 quickFilter='all';
 render();
});
$('addItemBtn').addEventListener('click',openAdd);
$('closeDialog').addEventListener('click',()=>$('itemDialog').close());
$('cancelDialog').addEventListener('click',()=>$('itemDialog').close());
$('closeAdminDialog')?.addEventListener('click',()=>$('adminDialog')?.close());
$('moreDetailsBtn').addEventListener('click',()=>{
 const panel=$('moreDetailsPanel');
 const opening=panel.classList.contains('hidden');
 panel.classList.toggle('hidden',!opening);
 $('moreDetailsBtn').setAttribute('aria-expanded',opening?'true':'false');
 $('moreDetailsBtn').textContent=opening?'− Less Details':'＋ More Details';
});
$('closeDetailsDialog').addEventListener('click',()=>$('detailsDialog').close());
$('quickSellBtn').addEventListener('click',openQuickSell);
$('closeQuickSellDialog').addEventListener('click',()=>$('quickSellDialog').close());
$('cancelQuickSellBtn').addEventListener('click',()=>$('quickSellDialog').close());
['quickSoldPrice','quickFees','quickShipping'].forEach(id=>$(id).addEventListener('input',updateQuickProfitPreview));
$('quickSellForm').addEventListener('submit',e=>{
 e.preventDefault();
 completeQuickSell();
});
$('detailsEditBtn').addEventListener('click',beginInlineEdit);
$('detailsCancelBtn').addEventListener('click',cancelInlineEdit);
$('detailsSaveBtn').addEventListener('click',saveInlineEdit);
$('resellerModeBtn').addEventListener('click',()=>setMode('reseller'));
$('estateModeBtn').addEventListener('click',()=>setMode('estate'));
$('showSettingsBtn')?.addEventListener('click',()=>setView('settings'));
$('bulkSelectBtn')?.addEventListener('click',()=>setBulkMode(!bulkMode));
$('bulkCancelBtn')?.addEventListener('click',()=>setBulkMode(false));
$('bulkStatusBtn')?.addEventListener('click',bulkChangeStatus);
$('bulkLocationBtn')?.addEventListener('click',bulkMoveLocation);
$('bulkDeleteBtn')?.addEventListener('click',bulkDelete);
$('emptyAddBtn')?.addEventListener('click',openAdd);
$('duplicateItemBtn')?.addEventListener('click',duplicateActiveItem);
$('scanBtn')?.addEventListener('click',openScanner);
$('closeScannerBtn')?.addEventListener('click',()=>{stopScanner();$('scannerDialog').close();});
$('stopScannerBtn')?.addEventListener('click',()=>{stopScanner();$('scannerDialog').close();});
$('manualScanSearchBtn')?.addEventListener('click',()=>searchScannedCode($('manualScanCode').value));
$('scannerDialog')?.addEventListener('close',stopScanner);
$('showReportsBtn')?.addEventListener('click',()=>setView('reports'));
$('exportInventoryReportBtn')?.addEventListener('click',exportInventoryReport);
$('exportSalesReportBtn')?.addEventListener('click',exportSalesReport);
$('showHistoryBtn')?.addEventListener('click',()=>setView('history'));
$('showInventoryBtn')?.addEventListener('click',()=>setView('inventory'));
$('exportBtn').addEventListener('click',()=>{
 const headers=['Item','ID','Category','Location','Cost','Asking Price','Platform','Status','Date Acquired','Days Held','Sold Price','Fees','Shipping','Net Profit','Notes'];
 const rows=items.map(i=>[i.name,i.itemId,i.category,i.location,i.cost,i.askingPrice,i.platform,i.status,i.acquiredDate,daysOld(i),i.soldPrice,i.fees,i.shipping,i.status==='Sold'?profit(i):'',i.notes]);
 const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
 const a=document.createElement('a');
 a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
 a.download=`reseller-inventory-${todayISO()}.csv`;
 a.click();
 URL.revokeObjectURL(a.href);
});




$('onboardingActionBtn')?.addEventListener('click',openAdd);
$('dismissOnboardingBtn')?.addEventListener('click',()=>{
 localStorage.setItem(workspacePrefKey('onboardingDismissed'),'1');
 updateOnboarding();
});

$('saveWorkspaceSettingsBtn')?.addEventListener('click',async()=>{
 showLoading('Saving workspace…');
 try{
   const payload=await authRequest('update_workspace',{
     workspaceName:$('settingsWorkspaceName').value,
     defaultMode:$('settingsDefaultMode').value
   },{authorized:true});
   authState.user=payload.user;
   authState.workspace=payload.workspace;
   setAuthState(authState);
   updateWorkspaceUI();
   applyWorkspaceLogo();
   showToast('Workspace updated ✓');
 }catch(err){showToast(friendlyError(err));}
 finally{hideLoading();}
});


$('settingsLogoFile')?.addEventListener('change',async e=>{
 const file=e.target.files?.[0];
 if(!file)return;
 try{
   const data=await compressLogo(file);
   localStorage.setItem(workspacePrefKey('logo'),data);
   $('settingsLogoPreview').innerHTML=`<img src="${data}" alt="Workspace logo preview" />`;
   $('settingsLogoPreview').classList.remove('hidden');
   applyWorkspaceLogo();
   showToast('Logo updated ✓');
 }catch(err){showToast('Could not use that logo');}
 e.target.value='';
});
$('removeWorkspaceLogoBtn')?.addEventListener('click',()=>{
 localStorage.removeItem(workspacePrefKey('logo'));
 $('settingsLogoPreview').classList.add('hidden');
 $('settingsLogoPreview').innerHTML='';
 applyWorkspaceLogo();
 showToast('Logo removed');
});

$('changePasswordBtn')?.addEventListener('click',async()=>{
 try{
   await authRequest('change_password',{
     currentPassword:$('currentPassword').value,
     newPassword:$('newPassword').value
   },{authorized:true});
   $('currentPassword').value='';
   $('newPassword').value='';
   showToast('Password changed ✓');
 }catch(err){showToast(err.message);}
});

$('addStaffBtn')?.addEventListener('click',async()=>{
 try{
   const payload=await authRequest('add_staff',{
     email:$('staffEmail').value,
     password:$('staffPassword').value,
     canEdit:$('staffAccess').value==='editor'
   },{authorized:true});
   alert(`Staff account created.\n\nRecovery code (save this):\n${payload.recoveryCode}`);
   $('staffEmail').value='';
   $('staffPassword').value='';
   await loadStaff();
 }catch(err){showToast(err.message);}
});

$('downloadBackupBtn')?.addEventListener('click',downloadBackup);
$('restoreBackupFile')?.addEventListener('change',e=>{
 const file=e.target.files?.[0];
 if(file)restoreBackupFile(file);
 e.target.value='';
});

$('forgotPasswordBtn')?.addEventListener('click',()=>{
 $('recoveryEmail').value=$('loginEmail').value||'';
 $('recoveryDialog').showModal();
});
$('closeRecoveryDialog')?.addEventListener('click',()=>$('recoveryDialog').close());
$('recoveryForm')?.addEventListener('submit',async e=>{
 e.preventDefault();
 try{
   const payload=await authRequest('recover',{
     email:$('recoveryEmail').value,
     recoveryCode:$('recoveryCode').value,
     newPassword:$('recoveryNewPassword').value
   });
   $('recoveryDialog').close();
   showAuthError(payload.message||'Password reset. Sign in.');
 }catch(err){showToast(err.message);}
});

$('feedbackBtn')?.addEventListener('click',openFeedback);
$('closeFeedbackBtn')?.addEventListener('click',closeFeedback);
$('feedbackForm')?.addEventListener('submit',e=>{
 e.preventDefault();
 submitFeedback();
});
$('tryDemoBtn')?.addEventListener('click',startDemo);

$('loginTabBtn').addEventListener('click',()=>switchAuthTab('login'));
$('signupTabBtn').addEventListener('click',()=>switchAuthTab('signup'));

$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();
 showAuthError('');
 showLoading('Signing in…');
 const btn=e.submitter;
 if(btn)btn.disabled=true;
 try{
   const payload=await authRequest('login',{
     email:$('loginEmail').value,
     password:$('loginPassword').value
   });
   setAuthState({token:payload.token,user:payload.user});
   items=[];
   history=[];
   localStorage.removeItem(STORAGE_KEY);
   localStorage.removeItem(HISTORY_KEY);
   await startWorkspace();
 }catch(err){
   showAuthError(friendlyError(err));
 }finally{
   if(btn)btn.disabled=false;
   hideLoading();
 }
});

$('signupForm').addEventListener('submit',async e=>{
 e.preventDefault();
 showAuthError('');
 showLoading('Creating workspace…');
 const btn=e.submitter;
 if(btn)btn.disabled=true;
 try{
   const selected=document.querySelector('input[name="signupMode"]:checked');
   const payload=await authRequest('signup',{
     workspaceName:$('signupWorkspace').value,
     email:$('signupEmail').value,
     password:$('signupPassword').value,
     defaultMode:selected?.value||'reseller'
   });
   setAuthState({token:payload.token,user:payload.user});
   prefs.mode=payload.user.defaultMode||'reseller';
   savePrefs();
   items=[];
   history=[];
   localStorage.removeItem(STORAGE_KEY);
   localStorage.removeItem(HISTORY_KEY);
   await startWorkspace();
   alert(`Workspace created.\n\nSAVE THIS RECOVERY CODE:\n${payload.recoveryCode}\n\nYou will need it if you forget your password.`);
   showToast('Workspace created ✓');
 }catch(err){
   showAuthError(friendlyError(err));
 }finally{
   if(btn)btn.disabled=false;
   hideLoading();
 }
});




function updateNavScrollHint(){
 const nav=$('navInner');
 const hint=$('navScrollHint');
 if(!nav || !hint) return;

 const mobile=window.innerWidth<=760;
 const overflow=nav.scrollWidth-nav.clientWidth>18;
 const nearEnd=nav.scrollLeft >= (nav.scrollWidth-nav.clientWidth-18);

 hint.classList.toggle('hidden', !(mobile && overflow && !nearEnd));
}

let deferredInstallPrompt=null;

function setInstallButtonVisible(show){
 const btn=$('installAppBtn');
 if(btn)btn.classList.toggle('hidden',!show);
 setTimeout(updateNavScrollHint,50);
}

window.addEventListener('beforeinstallprompt',event=>{
 event.preventDefault();
 deferredInstallPrompt=event;
 setInstallButtonVisible(true);
});

window.addEventListener('appinstalled',()=>{
 deferredInstallPrompt=null;
 setInstallButtonVisible(false);
 showToast('SimpleStock installed ✓');
});

$('installAppBtn')?.addEventListener('click',async()=>{
 if(!deferredInstallPrompt){
   showToast('Use your browser menu to Add to Home Screen');
   return;
 }
 deferredInstallPrompt.prompt();
 const choice=await deferredInstallPrompt.userChoice;
 if(choice.outcome==='accepted')setInstallButtonVisible(false);
 deferredInstallPrompt=null;
});


window.addEventListener('resize',updateNavScrollHint);
$('navInner')?.addEventListener('scroll',updateNavScrollHint);
window.addEventListener('load',()=>setTimeout(updateNavScrollHint,120));

if('serviceWorker' in navigator){
 window.addEventListener('load',()=>{
   navigator.serviceWorker.register('/service-worker.js')
     .catch(err=>console.warn('Service worker registration failed:',err));
 });
}



function openFeedback(){
 $('feedbackDialog').showModal();
}
function closeFeedback(){
 $('feedbackDialog').close();
}
async function submitFeedback(){
 const payload={
   testerType:$('feedbackTesterType').value,
   useful:$('feedbackUseful').value.trim(),
   confusing:$('feedbackConfusing').value.trim(),
   remove:$('feedbackRemove').value.trim(),
   missing:$('feedbackMissing').value.trim(),
   wouldUse:$('feedbackWouldUse').value,
   contact:$('feedbackContact').value.trim()
 };

 try{
   showLoading('Sending feedback…');
   const res=await fetch(FEEDBACK_ENDPOINT,{
     method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify(payload)
   });
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(data.error||'Could not submit feedback.');

   $('feedbackDialog').close();
   $('feedbackForm').reset();
   showToast('Thank you — feedback sent ✓');
 }catch(err){
   showToast(friendlyError(err,'Could not send feedback.'));
 }finally{
   hideLoading();
 }
}

async function startDemo(){
 setAuthState({
   demo:true,
   user:{
     email:'demo@simplestock.app',
     role:'owner',
     canEdit:true,
     workspaceId:'demo',
     workspaceName:'SimpleStock Demo',
     defaultMode:'reseller'
   }
 });
 items=[];
 history=[];
 currentMode='reseller';
 prefs.mode='reseller';
 showAuthGate(false);
 updateWorkspaceUI();
 sampleData();
 setView('inventory');
 applyModeUI();
 render();
 $('feedbackBtn').textContent='Give Feedback';
 showToast('Demo mode — changes are not saved');
}

async function startWorkspace(){
 showLoading('Opening workspace…');
 showAuthGate(false);
 updateWorkspaceUI();

 // First login/setup chooses the starting mode.
 const preferred=authState?.user?.defaultMode==='estate'?'estate':'reseller';
 if(!prefs.mode)prefs.mode=preferred;
 currentMode=prefs.mode==='estate'?'estate':'reseller';

 setView('inventory');
 applyModeUI();
 renderRecentLocations();

 const connected=authState?.demo?false:await loadCloud();
 renderRecentLocations();
 render();

 const permissionCheck=runPermissionSelfCheck();
 if(!permissionCheck.ok)setSyncStatus('Account permission check needs attention','error');
 if(connected)showToast('Workspace synced ✓');
 hideLoading();
}

async function bootstrap(){
 showAuthGate(true);
 switchAuthTab('login');

 const health=await checkAuthService();
 if(!health.ok){
   showAuthError(health.message);
 }

 const valid=await verifySession();
 if(valid){
   await startWorkspace();
 }
}
bootstrap();
