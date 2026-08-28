const STORAGE_KEY='resellerEstateTrackerV1.items';
const HISTORY_KEY='resellerEstateTrackerV1.history';
const ADMIN_PIN='1234';
const PREF_KEY='simpleStockV9.preferences';
let items=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
let history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
let prefs=JSON.parse(localStorage.getItem(PREF_KEY)||'{"recentLocations":[],"lastCategory":"","lastPlatform":""}');
let isAdmin=false,quickFilter='all';
items=items.map(i=>({...i,status:i.status==='Reserved'?'Hold':(['Donated','Bulk Sale'].includes(i.status)?'Donate / Bulk':i.status)}));

const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const now=()=>new Date().toLocaleString();
const todayISO=()=>new Date().toISOString().slice(0,10);
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const save=()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(items));localStorage.setItem(HISTORY_KEY,JSON.stringify(history));};
const savePrefs=()=>localStorage.setItem(PREF_KEY,JSON.stringify(prefs));
const log=(action,item,detail='')=>{history.unshift({id:uid(),time:now(),action,itemName:item?.name||'Unknown item',detail});history=history.slice(0,500);save();};
const daysOld=i=>{const d=new Date((i.acquiredDate||todayISO())+'T12:00:00');return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));};
const profit=i=>(Number(i.soldPrice)||0)-(Number(i.cost)||0)-(Number(i.fees)||0)-(Number(i.shipping)||0);
const attention=i=>i.status==='Needs Attention'||!i.name||!i.location||(!i.askingPrice&&i.status!=='Sold'&&i.status!=='Donated')||((i.status==='Listed')&&!i.platform)||daysOld(i)>=90;


function nextItemId(){
 const nums=items.map(i=>String(i.itemId||'').match(/(\d+)$/)).filter(Boolean).map(m=>Number(m[1])).filter(Number.isFinite);
 const next=(nums.length?Math.max(...nums):0)+1;
 return `RS-${String(next).padStart(3,'0')}`;
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
 prefs.recentLocations=[value,...prefs.recentLocations.filter(x=>x!==value)].slice(0,6);
 savePrefs();
}
function renderRecentLocations(){
 const wrap=$('recentLocations');
 if(!wrap)return;
 if(!prefs.recentLocations.length){
   wrap.innerHTML='<span class="quick-pick-empty">No recent locations yet</span>';
   return;
 }
 wrap.innerHTML=prefs.recentLocations.map(loc=>`<button type="button" class="quick-pick" data-location="${esc(loc)}">${esc(loc)}</button>`).join('');
 wrap.querySelectorAll('.quick-pick').forEach(btn=>btn.addEventListener('click',()=>{$('location').value=btn.dataset.location;}));
}
function prepareFreshIntake({keepContext=true}={}){
 const keepLocation=keepContext?$('location').value:'';
 $('itemForm').reset();
 $('itemKey').value='';
 $('quantity').value=1;
 $('status').value='Unlisted';
 $('acquiredDate').value=todayISO();
 $('itemId').value=nextItemId();
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
  notes:$('notes').value.trim()
 };
}
function saveCurrentItem({addAnother=false}={}){
 if(!isAdmin)return false;
 if(!$('name').value.trim()){
   $('name').focus();
   $('name').reportValidity();
   return false;
 }
 const key=$('itemKey').value;
 const record=buildRecord();
 if(key){
   const old=items.find(i=>i.key===key);
   items=items.map(i=>i.key===key?record:i);
   log('Updated',record,`${old.status} → ${record.status}; ${old.location||'No location'} → ${record.location||'No location'}`);
 }else{
   items.unshift(record);
   log('Added',record,`${money(record.cost)} paid • ${record.location||'No location'} • ${record.status}`);
 }
 rememberLocation(record.location);
 if(record.category)prefs.lastCategory=record.category;
 if(record.platform)prefs.lastPlatform=record.platform;
 savePrefs();
 save();
 render();
 showToast(`${record.name} saved ✓`);
 if(addAnother){
   const lastLocation=record.location;
   prepareFreshIntake({keepContext:true});
   $('location').value=lastLocation;
   setTimeout(()=>$('photoFile').click(),120);
 }else{
   $('itemDialog').close();
   setView('inventory');
   setTimeout(()=>$('inventorySection').scrollIntoView({behavior:'smooth',block:'start'}),80);
 }
 return true;
}

function sampleData(){
 if(items.length)return;
 const dateDaysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10)};
 items=[
  {key:uid(),name:'DeWalt 20V MAX Drill',itemId:'RS-001',category:'Tools',quantity:1,location:'Garage Shelf A3',cost:20,askingPrice:70,platform:'Facebook Marketplace',status:'Listed',acquiredDate:dateDaysAgo(9),soldPrice:0,fees:0,shipping:0,notes:'Battery + charger included',photo:''},
  {key:uid(),name:'Vintage Brass Table Lamp',itemId:'RS-002',category:'Home Decor',quantity:1,location:'Storage Rack B1',cost:8,askingPrice:65,platform:'',status:'Unlisted',acquiredDate:dateDaysAgo(18),soldPrice:0,fees:0,shipping:0,notes:'Needs shade measurements',photo:''},
  {key:uid(),name:'Samsung 55-inch Frame TV',itemId:'RS-003',category:'Electronics',quantity:1,location:'Garage Floor TV Area',cost:0,askingPrice:180,platform:'Facebook Marketplace',status:'Listed',acquiredDate:dateDaysAgo(67),soldPrice:0,fees:0,shipping:0,notes:'Missing One Connect box',photo:''},
  {key:uid(),name:'Commercial Pressure Fryer',itemId:'RS-004',category:'Restaurant Equipment',quantity:1,location:'Storage Unit',cost:40,askingPrice:325,platform:'Local',status:'Sold',acquiredDate:dateDaysAgo(31),soldPrice:275,fees:0,shipping:0,notes:'Local pickup',photo:''}
 ];
 log('Demo data created',{name:'Reseller Tracker'},'4 starter records added');save();
}

function updateFilters(){
 const cur=$('categoryFilter').value;
 const cats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort();
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
 const filtered=items.filter(i=>{
  const hay=[i.name,i.itemId,i.category,i.location,i.status,i.platform,i.notes].join(' ').toLowerCase();
  return(!q||hay.includes(q))&&(!cat||i.category===cat)&&(!status||i.status===status)&&(!platform||i.platform===platform)&&matchesQuick(i);
 });
 $('inventorySummary').textContent=`${filtered.length} item${filtered.length===1?'':'s'}`;
 $('inventoryList').innerHTML='';
 $('emptyState').classList.toggle('hidden',!!filtered.length);
 filtered.forEach(i=>{
  const node=$('itemTemplate').content.cloneNode(true),card=node.querySelector('.item-card');
  node.querySelector('.item-name').textContent=i.name;
  node.querySelector('.asking').textContent=i.status==='Sold'?`Sold ${money(i.soldPrice)}`:`Ask ${money(i.askingPrice)}`;
  node.querySelector('.cost').textContent=`Paid ${money(i.cost)}`;

  const p=node.querySelector('.profit');
  if(i.status==='Sold'){
    p.textContent=`Profit ${money(profit(i))}`;
    p.classList.add(profit(i)>=0?'positive':'negative');
  }else p.textContent='';

  node.querySelector('.platform-text').textContent=i.platform||'Not listed';
  node.querySelector('.location-text').textContent=i.location||'No location';

  const img=node.querySelector('.item-thumb'),ph=node.querySelector('.placeholder-thumb');
  if(i.photo){img.src=i.photo;img.style.display='block';ph.style.display='none';}

  const statusSelect=node.querySelector('.quick-status');
  statusSelect.value=i.status;
  statusSelect.classList.add(statusClass(i.status));
  statusSelect.addEventListener('click',e=>e.stopPropagation());
  statusSelect.addEventListener('change',e=>{
    e.stopPropagation();
    if(!isAdmin){
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
 const active=items.filter(i=>!['Sold','Donate / Bulk','Donated','Bulk Sale'].includes(i.status));
 $('statActive').textContent=active.length;
 $('statCost').textContent=`${money(active.reduce((s,i)=>s+(Number(i.cost)||0),0))} invested`;
 $('statUnlisted').textContent=active.filter(i=>i.status==='Unlisted').length;
 $('statAged').textContent=active.filter(i=>daysOld(i)>=60).length;
 $('statAttention').textContent=active.filter(attention).length;
 if($('summaryUnlisted')) $('summaryUnlisted').textContent=active.filter(i=>i.status==='Unlisted').length;
 if($('summaryAged')) $('summaryAged').textContent=active.filter(i=>daysOld(i)>=60).length;
 $('potentialRevenue').textContent=money(active.reduce((s,i)=>s+(Number(i.askingPrice)||0),0));
 const sold=items.filter(i=>i.status==='Sold');
 $('soldRevenue').textContent=money(sold.reduce((s,i)=>s+(Number(i.soldPrice)||0),0));
 $('netProfit').textContent=money(sold.reduce((s,i)=>s+profit(i),0));
 renderHistory();
}
function renderHistory(){
 const sold=items.filter(i=>i.status==='Sold');
 if($('salesCount')) $('salesCount').textContent=sold.length;
 if($('salesRevenue')) $('salesRevenue').textContent=money(sold.reduce((s,i)=>s+(Number(i.soldPrice)||0),0));
 if($('salesProfit')) $('salesProfit').textContent=money(sold.reduce((s,i)=>s+profit(i),0));

 if($('soldList')){
   $('soldList').innerHTML=sold.length?sold.map(i=>`
    <button class="sold-row" type="button" data-key="${esc(i.key)}">
      <div>
        <strong>${esc(i.name)}</strong>
        <span>${esc(i.platform||'No platform')} · ${daysOld(i)} days held</span>
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
function openDetails(key){
 const i=items.find(x=>x.key===key);
 if(!i)return;
 $('detailsName').textContent=i.name;
 const age=daysOld(i);
 $('detailsBody').innerHTML=`
   <div class="detail-hero">
     <strong>${i.status==='Sold'?`Sold ${money(i.soldPrice)}`:`Ask ${money(i.askingPrice)}`}</strong>
     <span>Paid ${money(i.cost)}</span>
     ${i.status==='Sold'?`<span class="${profit(i)>=0?'positive':'negative'}">${money(profit(i))} profit</span>`:''}
   </div>
   <div class="detail-list">
     <div><span>Status</span><strong>${esc(i.status)}</strong></div>
     <div><span>Location</span><strong>${esc(i.location||'No location')}</strong></div>
     <div><span>Platform</span><strong>${esc(i.platform||'Not listed')}</strong></div>
     <div><span>Category</span><strong>${esc(i.category||'—')}</strong></div>
     <div><span>Item ID</span><strong>${esc(i.itemId||'—')}</strong></div>
     <div><span>Age</span><strong>${age} day${age===1?'':'s'}</strong></div>
     <div><span>Quantity</span><strong>${Number(i.quantity)||1}</strong></div>
   </div>
   ${i.notes?`<div class="detail-note"><span>Notes</span><p>${esc(i.notes)}</p></div>`:''}
 `;
 $('detailsEditBtn').classList.toggle('hidden',!isAdmin);
 $('detailsEditBtn').dataset.key=i.key;
 $('detailsDialog').showModal();
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
 for(const id of ['name','itemId','category','location','cost','askingPrice','platform','status','acquiredDate','quantity','soldPrice','fees','shipping','notes']) $(id).value=i[id]??'';
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

$('photoFile').addEventListener('change',e=>{
 const f=e.target.files?.[0];
 if(!f)return;
 const r=new FileReader();
 r.onload=()=>setPhotoPreview(r.result);
 r.readAsDataURL(f);
});
$('status').addEventListener('change',toggleSaleFields);
['soldPrice','cost','fees','shipping'].forEach(id=>$(id).addEventListener('input',updateProfitPreview));
$('itemForm').addEventListener('submit',e=>e.preventDefault());
$('saveItemBtn').addEventListener('click',()=>saveCurrentItem({addAnother:false}));
$('saveNextBtn').addEventListener('click',()=>saveCurrentItem({addAnother:true}));
$('deleteItemBtn').addEventListener('click',()=>{
 const key=$('itemKey').value,i=items.find(x=>x.key===key);
 if(!i||!confirm(`Delete ${i.name}?`))return;
 items=items.filter(x=>x.key!==key);
 log('Deleted',i,'Removed from inventory');
 save();
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
$('detailsEditBtn').addEventListener('click',()=>{
 const key=$('detailsEditBtn').dataset.key;
 $('detailsDialog').close();
 openEdit(key);
});
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

sampleData();
renderRecentLocations();
setView('inventory');
render();
