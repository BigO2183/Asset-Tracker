const STORAGE_KEY='resellerEstateTrackerV1.items';
const HISTORY_KEY='resellerEstateTrackerV1.history';
const ADMIN_PIN='1234';
let items=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
let history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
let isAdmin=false,quickFilter='all';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const now=()=>new Date().toLocaleString();
const todayISO=()=>new Date().toISOString().slice(0,10);
const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const save=()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(items));localStorage.setItem(HISTORY_KEY,JSON.stringify(history));};
const log=(action,item,detail='')=>{history.unshift({id:uid(),time:now(),action,itemName:item?.name||'Unknown item',detail});history=history.slice(0,500);save();};
const daysOld=i=>{const d=new Date((i.acquiredDate||todayISO())+'T12:00:00');return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));};
const profit=i=>(Number(i.soldPrice)||0)-(Number(i.cost)||0)-(Number(i.fees)||0)-(Number(i.shipping)||0);
const attention=i=>i.status==='Needs Attention'||!i.name||!i.location||(!i.askingPrice&&i.status!=='Sold'&&i.status!=='Donated')||((i.status==='Listed')&&!i.platform)||daysOld(i)>=90;

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
 if(quickFilter==='aged')return daysOld(i)>=60&& !['Sold','Donated'].includes(i.status);
 if(quickFilter==='attention')return attention(i);
 return true;
}
function statusClass(status=''){
 return 'status-' + status.toLowerCase().replace(/\s+/g,'-');
}
function updateStatCardState(){
 document.querySelectorAll('.stat-card').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===quickFilter));
}
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
  node.querySelector('.item-meta').textContent=[i.itemId&&`ID: ${i.itemId}`,i.category, i.quantity>1?`Qty ${i.quantity}`:''].filter(Boolean).join(' • ');
  const statusEl=node.querySelector('.status-pill');
  statusEl.textContent=i.status;
  statusEl.classList.add(statusClass(i.status));
  node.querySelector('.asking').textContent=i.status==='Sold'?`Sold ${money(i.soldPrice)}`:`Ask ${money(i.askingPrice)}`;
  node.querySelector('.cost').textContent=`Paid ${money(i.cost)}`;
  const p=node.querySelector('.profit');
  if(i.status==='Sold'){
    p.textContent=`Profit ${money(profit(i))}`;
    p.classList.add(profit(i)>=0?'positive':'negative');
  }else p.textContent='';
  node.querySelector('.item-notes').textContent=i.notes||'No notes yet.';
  const age=daysOld(i);
  const ageChip=node.querySelector('.age-chip');
  ageChip.textContent=`${age} day${age===1?'':'s'} old`;
  if(age>=90) ageChip.classList.add('stale');
  else if(age>=60) ageChip.classList.add('aged');
  node.querySelector('.platform-chip').textContent=i.platform||'Not listed';
  node.querySelector('.location-chip').textContent=i.location||'No location';
  const img=node.querySelector('.item-thumb'),ph=node.querySelector('.placeholder-thumb');
  if(i.photo){img.src=i.photo;img.style.display='block';ph.style.display='none';}
  const edit=node.querySelector('.edit-btn');
  edit.classList.toggle('hidden',!isAdmin);
  edit.addEventListener('click',()=>openEdit(i.key));
  card.addEventListener('dblclick',()=>{if(isAdmin)openEdit(i.key)});
  $('inventoryList').appendChild(node);
 });
 const active=items.filter(i=>!['Sold','Donated'].includes(i.status));
 $('statActive').textContent=active.length;
 $('statCost').textContent=`${money(active.reduce((s,i)=>s+(Number(i.cost)||0),0))} invested`;
 $('statUnlisted').textContent=active.filter(i=>i.status==='Unlisted').length;
 $('statAged').textContent=active.filter(i=>daysOld(i)>=60).length;
 $('statAttention').textContent=active.filter(attention).length;
 $('potentialRevenue').textContent=money(active.reduce((s,i)=>s+(Number(i.askingPrice)||0),0));
 const sold=items.filter(i=>i.status==='Sold');
 $('soldRevenue').textContent=money(sold.reduce((s,i)=>s+(Number(i.soldPrice)||0),0));
 $('netProfit').textContent=money(sold.reduce((s,i)=>s+profit(i),0));
 renderHistory();
}
function renderHistory(){
 $('historyList').innerHTML=history.length
  ?history.map(h=>`<div class="history-entry"><strong>${esc(h.action)} — ${esc(h.itemName)}</strong><div>${esc(h.detail||'')}</div><small>${esc(h.time)}</small></div>`).join('')
  :'<div class="empty-state"><div class="empty-illustration">🕘</div><h3>No history yet</h3><p>Once you start adding or editing items, your activity log will show up here.</p></div>';
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
 $('viewLabel').textContent=inventory?'Inventory':'History';
 if(!inventory) renderHistory();
}
function openAdd(){
 if(!isAdmin){openAdmin();return;}
 $('itemForm').reset();
 $('itemKey').value='';
 $('quantity').value=1;
 $('status').value='Unlisted';
 $('acquiredDate').value=todayISO();
 $('dialogTitle').textContent='Fast Intake';
 $('deleteItemBtn').classList.add('hidden');
 setPhotoPreview('');
 toggleSaleFields();
 $('itemDialog').showModal();
 setTimeout(()=>$('name').focus(),80);
}
function openEdit(key){
 if(!isAdmin)return;
 const i=items.find(x=>x.key===key);
 if(!i)return;
 for(const id of ['name','itemId','category','location','cost','askingPrice','platform','status','acquiredDate','quantity','soldPrice','fees','shipping','notes']) $(id).value=i[id]??'';
 $('itemKey').value=i.key;
 $('dialogTitle').textContent='Edit Item';
 $('deleteItemBtn').classList.remove('hidden');
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
$('itemForm').addEventListener('submit',e=>{
 e.preventDefault();
 if(!isAdmin)return;
 const key=$('itemKey').value;
 const record={
  key:key||uid(),
  photo:$('photo').value,
  name:$('name').value.trim(),
  itemId:$('itemId').value.trim(),
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
 if(key){
   const old=items.find(i=>i.key===key);
   items=items.map(i=>i.key===key?record:i);
   log('Updated',record,`${old.status} → ${record.status}; ${old.location||'No location'} → ${record.location||'No location'}`);
 }else{
   items.unshift(record);
   log('Added',record,`${money(record.cost)} paid • ${record.location||'No location'} • ${record.status}`);
 }
 save();
 $('itemDialog').close();
 render();
});
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
   $('adminToggle').textContent='🔓 Admin On';
   $('adminDialog').close();
   render();
 }else alert('Incorrect PIN');
});
$('adminToggle').addEventListener('click',()=>{
 if(isAdmin){
   isAdmin=false;
   $('adminToggle').textContent='🔒 Admin Mode';
   render();
 }else openAdmin();
});
['searchInput','categoryFilter','statusFilter','platformFilter'].forEach(id=>$(id).addEventListener(id==='searchInput'?'input':'change',()=>{quickFilter='all';render();}));
document.querySelectorAll('.stat-card').forEach(btn=>btn.addEventListener('click',()=>{
 quickFilter=btn.dataset.filter;
 setView('inventory');
 render();
 $('inventorySection').scrollIntoView({behavior:'smooth'});
}));
$('addItemBtn').addEventListener('click',openAdd);
$('closeDialog').addEventListener('click',()=>$('itemDialog').close());
$('cancelDialog').addEventListener('click',()=>$('itemDialog').close());
$('closeAdminDialog').addEventListener('click',()=>$('adminDialog').close());
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
setView('inventory');
render();
