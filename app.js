const STORAGE_KEY='resellerEstateTrackerV1.items';
const HISTORY_KEY='resellerEstateTrackerV1.history';
const ADMIN_PIN='1234';
const PREF_KEY='simpleStockV9.preferences';
const CLOUD_ENDPOINT='/.netlify/functions/inventory';
const AUTH_ENDPOINT='/.netlify/functions/auth';
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
   notes:'Drill, battery, charger and soft bag. Tested and working.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'KitchenAid Artisan 5-Qt Stand Mixer',
   itemId:'RS-002',category:'Small Appliances',quantity:1,location:'Kitchen Rack B1',
   cost:40,askingPrice:140,platform:'Facebook Marketplace',status:'Listed',
   acquiredDate:dateDaysAgo(11),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Includes bowl and paddle. Light cosmetic wear.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Samsung 55-Inch 4K Smart TV',
   itemId:'RS-003',category:'Electronics',quantity:1,location:'Garage TV Area',
   cost:0,askingPrice:160,platform:'Facebook Marketplace',status:'Needs Attention',
   acquiredDate:dateDaysAgo(22),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Powers on. Missing original remote. Needs model number added to listing.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Ring Stick Up Cam Battery',
   itemId:'RS-004',category:'Electronics',quantity:2,location:'Bin E-4',
   cost:18,askingPrice:45,platform:'eBay',status:'Listed',
   acquiredDate:dateDaysAgo(9),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Two cameras. One sealed, one open-box.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Craftsman Rolling Tool Chest',
   itemId:'RS-005',category:'Tools',quantity:1,location:'Garage Floor C1',
   cost:35,askingPrice:110,platform:'Local',status:'Unlisted',
   acquiredDate:dateDaysAgo(3),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Drawer slides work. Needs wipe-down before photos.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Vintage Brass Table Lamp',
   itemId:'RS-006',category:'Home Decor',quantity:1,location:'Shelf D-2',
   cost:8,askingPrice:55,platform:'',status:'Unlisted',
   acquiredDate:dateDaysAgo(18),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Working. Shade not included.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Dyson V8 Cordless Vacuum',
   itemId:'RS-007',category:'Home Appliances',quantity:1,location:'Closet Rack A',
   cost:30,askingPrice:95,platform:'Facebook Marketplace',status:'Hold',
   acquiredDate:dateDaysAgo(15),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Battery holds charge. Buyer scheduled for pickup Saturday.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Sonos Play:5 Wireless Speaker',
   itemId:'RS-008',category:'Audio',quantity:1,location:'Shelf E-1',
   cost:35,askingPrice:90,platform:'eBay',status:'Sold',
   acquiredDate:dateDaysAgo(29),soldPrice:82,fees:11.50,shipping:14.25,soldDate:dateDaysAgo(2),
   notes:'Tested before shipping. Packed with foam corners.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Honda 2800 PSI Pressure Washer',
   itemId:'RS-009',category:'Outdoor Equipment',quantity:1,location:'Garage Bay 2',
   cost:60,askingPrice:185,platform:'Facebook Marketplace',status:'Listed',
   acquiredDate:dateDaysAgo(41),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Starts and runs. Includes hose and wand.',photo:''
  },
  {
   key:uid(),recordType:'reseller',name:'Solid Wood Nightstand Pair',
   itemId:'RS-010',category:'Furniture',quantity:2,location:'Storage Unit Wall B',
   cost:20,askingPrice:95,platform:'Facebook Marketplace',status:'Listed',
   acquiredDate:dateDaysAgo(67),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Pair sold together. Minor scratches on tops.',photo:''
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
   notes:'Good condition. No cracked latches.',photo:''
  },

  // ---------------- ESTATE SALE INVENTORY ----------------
  {
   key:uid(),recordType:'estate',name:'Mid-Century Walnut Dresser',
   itemId:'ES-013',category:'Furniture',quantity:1,location:'Primary Bedroom',
   cost:0,askingPrice:225,platform:'Estate Sale',status:'For Sale',
   acquiredDate:dateDaysAgo(4),soldPrice:0,fees:0,shipping:0,soldDate:'',
   notes:'Six drawers. Minor wear consistent with age.',photo:'',
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
   notes:'Tested and working.',photo:'',
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
   notes:'Mixed sockets, wrenches and screwdrivers sold as one lot.',photo:'',
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
