const STORAGE_KEY='resellerEstateTrackerV1.items';
const HISTORY_KEY='resellerEstateTrackerV1.history';
const ADMIN_PIN='1234';
const PREF_KEY='simpleStockV9.preferences';
const CLOUD_ENDPOINT='/.netlify/functions/inventory';
let cloudEnabled=false;
let cloudSyncTimer=null;
let items=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
let history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
let prefs=JSON.parse(localStorage.getItem(PREF_KEY)||'{"recentLocations":[],"lastCategory":"","lastPlatform":"","mode":"reseller"}');
let currentMode=prefs.mode==='estate'?'estate':'reseller';
let isAdmin=false,quickFilter='all';
items=items.map(i=>({...i,status:i.status==='Reserved'?'Hold':(['Donated','Bulk Sale'].includes(i.status)?'Donate / Bulk':i.status)}));

const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const now=()=>new Date().toLocaleString();
const todayISO=()=>new Date().toISOString().slice(0,10);
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const save=()=>{
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
 if(!cloudEnabled)return false;
 try{
   const res=await fetch(CLOUD_ENDPOINT,{
     method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({items,history})
   });
   if(!res.ok)throw new Error(`Cloud save failed (${res.status})`);
   if(!quiet)showToast('Saved everywhere ✓');
   return true;
 }catch(err){
   console.error(err);
   if(!quiet)showToast('Saved on this device — cloud sync failed');
   return false;
 }
}
function queueCloudSync(){
 if(!cloudEnabled)return;
 clearTimeout(cloudSyncTimer);
 cloudSyncTimer=setTimeout(()=>pushCloud({quiet:true}),250);
}
async function loadCloud(){
 try{
   const res=await fetch(CLOUD_ENDPOINT,{cache:'no-store'});
   if(!res.ok)throw new Error(`Cloud load failed (${res.status})`);
   const payload=await res.json();
   cloudEnabled=true;

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

   return true;
 }catch(err){
   console.warn('Cloud sync unavailable; using device storage.',err);
   cloudEnabled=false;
   setTimeout(()=>showToast('Cloud sync offline — device only'),500);
   return false;
 }
}

const log=(action,item,detail='')=>{history.unshift({id:uid(),time:now(),action,itemName:item?.name||'Unknown item',detail});history=history.slice(0,500);save();queueCloudSync();};
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
     action:'Updated',
     itemName:record.name,
     detail:`${old?.status||'Unknown'} → ${record.status}; ${old?.location||'No location'} → ${record.location||'No location'}`
   });
 }else{
   items.unshift(record);
   history.unshift({
     id:uid(),
     time:now(),
     action:'Added',
     itemName:record.name,
     detail:`${money(record.cost)} paid • ${record.location||'No location'} • ${record.status}`
   });
 }
 history=history.slice(0,500);

 // Save inventory before changing UI. If mobile browser storage is full,
 // keep the intake screen open and show the user exactly what happened.
 if(!save()){
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
   pushCloud({quiet:true}).then(ok=>showToast(ok?`${record.name} saved everywhere ✓`:`${record.name} saved on this device`));
 }else{
   showToast(`${record.name} saved ✓`);
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
 const dateDaysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10)};
 items=[
  {key:uid(),recordType:'reseller',name:'DeWalt 20V MAX Drill',itemId:'RS-001',category:'Tools',quantity:1,location:'Garage Shelf A3',cost:20,askingPrice:70,platform:'Facebook Marketplace',status:'Listed',acquiredDate:dateDaysAgo(9),soldPrice:0,fees:0,shipping:0,notes:'Battery + charger included',photo:''},
  {key:uid(),recordType:'reseller',name:'Vintage Brass Table Lamp',itemId:'RS-002',category:'Home Decor',quantity:1,location:'Storage Rack B1',cost:8,askingPrice:65,platform:'',status:'Unlisted',acquiredDate:dateDaysAgo(18),soldPrice:0,fees:0,shipping:0,notes:'Needs shade measurements',photo:''},
  {key:uid(),recordType:'reseller',name:'Samsung 55-inch Frame TV',itemId:'RS-003',category:'Electronics',quantity:1,location:'Garage Floor TV Area',cost:0,askingPrice:180,platform:'Facebook Marketplace',status:'Listed',acquiredDate:dateDaysAgo(67),soldPrice:0,fees:0,shipping:0,notes:'Missing One Connect box',photo:''},
  {key:uid(),recordType:'reseller',name:'Commercial Pressure Fryer',itemId:'RS-004',category:'Restaurant Equipment',quantity:1,location:'Storage Unit',cost:40,askingPrice:325,platform:'Local',status:'Sold',acquiredDate:dateDaysAgo(31),soldPrice:275,fees:0,shipping:0,notes:'Local pickup',photo:''}
 ];
 log('Demo data created',{name:'Reseller Tracker'},'4 starter records added');save();
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
 filtered.forEach(i=>{
  const node=$('itemTemplate').content.cloneNode(true),card=node.querySelector('.item-card');
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

  const openCard=()=>openDetails(i.key);
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
  ?history.slice(0,20).map(h=>`<div class="history-entry"><strong>${esc(h.action)} — ${esc(h.itemName)}</strong><div>${esc(h.detail||'')}</div><small>${esc(h.time)}</small></div>`).join('')
  :'<div class="empty-state compact-empty">No activity yet.</div>';
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
 $('detailsEditBtn').classList.remove('hidden');
 $('quickSellBtn').classList.toggle('hidden',i.status==='Sold');

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
 $('inventorySection').classList.toggle('hidden',!inventory);
 $('historySection').classList.toggle('hidden',inventory);
 $('showInventoryBtn').classList.toggle('active-tab',inventory);
 $('showHistoryBtn').classList.toggle('active-tab',!inventory);
 $('viewLabel').textContent=inventory?'Inventory':'Sales';
 if(!inventory) renderHistory();
}
function openAdd(){
 if(!isAdmin){openAdmin();return;}
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
 $('adminPin').value='';
 $('adminDialog').showModal();
 setTimeout(()=>$('adminPin').focus(),50);
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
$('adminForm').addEventListener('submit',e=>{
 e.preventDefault();
 if($('adminPin').value===ADMIN_PIN){
   isAdmin=true;
   $('adminToggle').textContent='🔓 Admin';
   $('adminDialog').close();
   render();
 }else alert('Incorrect PIN');
});
$('adminToggle').addEventListener('click',()=>{
 if(isAdmin){
   isAdmin=false;
   $('adminToggle').textContent='🔒 Admin';
   render();
 }else openAdmin();
});
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
$('closeAdminDialog').addEventListener('click',()=>$('adminDialog').close());
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
$('showHistoryBtn').addEventListener('click',()=>setView('history'));
$('showInventoryBtn').addEventListener('click',()=>setView('inventory'));
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

async function bootstrap(){
 setView('inventory');
 applyModeUI();
 renderRecentLocations();

 const connected=await loadCloud();

 if(!items.length){
   sampleData();
   if(connected)await pushCloud({quiet:true});
 }

 renderRecentLocations();
 render();

 if(connected)showToast('Cloud sync on ✓');
}
bootstrap();
