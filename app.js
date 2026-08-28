const STORAGE_KEY='inventoryTrackerBaseV1.items';
const HISTORY_KEY='inventoryTrackerBaseV1.history';
const ADMIN_PIN='1234'; // Change before deploying for a customer.

let items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
let isAdmin = false;
let quickFilter = 'all';

const $ = (id)=>document.getElementById(id);
const inventoryList=$('inventoryList'), itemDialog=$('itemDialog'), itemForm=$('itemForm');

function uid(){return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));}
function now(){return new Date().toLocaleString();}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(items));localStorage.setItem(HISTORY_KEY,JSON.stringify(history));}
function log(action,item,detail=''){history.unshift({id:uid(),time:now(),action,itemName:item?.name||'Unknown item',detail});history=history.slice(0,500);save();}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function sampleData(){
 if(items.length) return;
 items=[
  {key:uid(),name:'DeWalt 20V Drill',itemId:'DW-001',category:'Tools',quantity:4,lowStockAt:1,location:'Shelf A3',status:'In Stock',notes:'Battery + charger included',photo:''},
  {key:uid(),name:'Samsung 55-inch TV',itemId:'TV-014',category:'Electronics',quantity:1,lowStockAt:1,location:'Back Room B',status:'Needs Attention',notes:'Missing remote; needs testing',photo:''},
  {key:uid(),name:'Extension Ladder 28 ft',itemId:'EQ-028',category:'Equipment',quantity:1,lowStockAt:0,location:'Assigned - Crew 2',status:'Checked Out',notes:'Return inspection required',photo:''}
 ];
 log('Demo data created',{name:'Inventory Tracker Base'},'3 starter records added');
 save();
}

function updateCategories(){
 const current=$('categoryFilter').value;
 const cats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort();
 $('categoryFilter').innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join('');
 $('categoryFilter').value=cats.includes(current)?current:'';
}

function matchesQuick(i){
 if(quickFilter==='all') return true;
 if(quickFilter==='checked-out') return i.status==='Checked Out';
 if(quickFilter==='low-stock') return Number(i.quantity)<=Number(i.lowStockAt||0);
 if(quickFilter==='attention') return i.status==='Needs Attention' || Number(i.quantity)<=Number(i.lowStockAt||0);
 return true;
}

function render(){
 updateCategories();
 const q=$('searchInput').value.trim().toLowerCase();
 const cat=$('categoryFilter').value, status=$('statusFilter').value;
 const filtered=items.filter(i=>{
  const hay=[i.name,i.itemId,i.category,i.location,i.status,i.notes].join(' ').toLowerCase();
  return (!q||hay.includes(q)) && (!cat||i.category===cat) && (!status||i.status===status) && matchesQuick(i);
 });
 inventoryList.innerHTML='';
 $('emptyState').classList.toggle('hidden',filtered.length!==0);
 const tpl=$('itemTemplate');
 filtered.forEach(i=>{
  const node=tpl.content.cloneNode(true);
  const card=node.querySelector('.item-card');
  node.querySelector('.item-name').textContent=i.name;
  node.querySelector('.item-meta').textContent=[i.itemId&&`ID: ${i.itemId}`,i.category].filter(Boolean).join(' • ');
  node.querySelector('.item-notes').textContent=i.notes||'';
  node.querySelector('.status-pill').textContent=i.status;
  node.querySelector('.qty-chip').textContent=`Qty ${i.quantity}`;
  node.querySelector('.location-chip').textContent=i.location||'No location';
  const img=node.querySelector('.item-thumb'), ph=node.querySelector('.placeholder-thumb');
  if(i.photo){img.src=i.photo;img.style.display='block';ph.style.display='none';img.onerror=()=>{img.style.display='none';ph.style.display='grid';};}
  const edit=node.querySelector('.edit-btn');
  edit.classList.toggle('hidden',!isAdmin); edit.addEventListener('click',()=>openEdit(i.key));
  card.addEventListener('dblclick',()=>{if(isAdmin)openEdit(i.key)});
  inventoryList.appendChild(node);
 });
 $('statInStock').textContent=items.filter(i=>i.status==='In Stock').length;
 $('statCheckedOut').textContent=items.filter(i=>i.status==='Checked Out').length;
 $('statLowStock').textContent=items.filter(i=>Number(i.quantity)<=Number(i.lowStockAt||0)).length;
 $('statAttention').textContent=items.filter(i=>i.status==='Needs Attention'||Number(i.quantity)<=Number(i.lowStockAt||0)).length;
 renderHistory();
}

function renderHistory(){
 $('historyList').innerHTML=history.length?history.map(h=>`<div class="history-entry"><strong>${esc(h.action)} — ${esc(h.itemName)}</strong><div>${esc(h.detail||'')}</div><small>${esc(h.time)}</small></div>`).join(''):'<div class="empty-state">No history yet.</div>';
}

function openAdd(){
 if(!isAdmin){openAdmin();return;}
 itemForm.reset(); $('itemKey').value=''; $('quantity').value=1; $('lowStockAt').value=1; $('status').value='In Stock'; $('dialogTitle').textContent='Add Item'; $('deleteItemBtn').classList.add('hidden'); itemDialog.showModal();
}
function openEdit(key){
 if(!isAdmin) return;
 const i=items.find(x=>x.key===key); if(!i)return;
 $('itemKey').value=i.key; $('photo').value=i.photo||''; $('name').value=i.name||''; $('itemId').value=i.itemId||''; $('category').value=i.category||''; $('quantity').value=i.quantity??1; $('lowStockAt').value=i.lowStockAt??1; $('location').value=i.location||''; $('status').value=i.status||'In Stock'; $('notes').value=i.notes||''; $('dialogTitle').textContent='Edit Item'; $('deleteItemBtn').classList.remove('hidden'); itemDialog.showModal();
}
function openAdmin(){ $('adminPin').value=''; $('adminDialog').showModal(); setTimeout(()=>$('adminPin').focus(),50); }
function toggleAdmin(){ if(isAdmin){isAdmin=false;$('adminToggle').textContent='🔒 Admin Mode';render();} else openAdmin(); }

itemForm.addEventListener('submit',(e)=>{
 e.preventDefault(); if(!isAdmin)return;
 const key=$('itemKey').value;
 const record={key:key||uid(),photo:$('photo').value.trim(),name:$('name').value.trim(),itemId:$('itemId').value.trim(),category:$('category').value.trim(),quantity:Number($('quantity').value),lowStockAt:Number($('lowStockAt').value||0),location:$('location').value.trim(),status:$('status').value,notes:$('notes').value.trim()};
 if(key){const old=items.find(i=>i.key===key);items=items.map(i=>i.key===key?record:i);log('Updated',record,`Qty ${old.quantity} → ${record.quantity}; Status ${old.status} → ${record.status}; Location ${old.location||'—'} → ${record.location||'—'}`);} else {items.unshift(record);log('Added',record,`Qty ${record.quantity}; ${record.location||'No location'}`);} save();itemDialog.close();render();
});

$('deleteItemBtn').addEventListener('click',()=>{const key=$('itemKey').value;const i=items.find(x=>x.key===key);if(!i||!confirm(`Delete ${i.name}?`))return;items=items.filter(x=>x.key!==key);log('Deleted',i,`Removed from inventory`);save();itemDialog.close();render();});
$('adminForm').addEventListener('submit',(e)=>{e.preventDefault();if($('adminPin').value===ADMIN_PIN){isAdmin=true;$('adminToggle').textContent='🔓 Admin On';$('adminDialog').close();render();}else{alert('Incorrect PIN');}});
['searchInput','categoryFilter','statusFilter'].forEach(id=>$(id).addEventListener(id==='searchInput'?'input':'change',()=>{quickFilter='all';render();}));
document.querySelectorAll('.stat-card').forEach(btn=>btn.addEventListener('click',()=>{quickFilter=btn.dataset.filter;render();$('inventorySection').scrollIntoView({behavior:'smooth'});}));
$('addItemBtn').addEventListener('click',openAdd);$('adminToggle').addEventListener('click',toggleAdmin);$('closeDialog').addEventListener('click',()=>itemDialog.close());$('cancelDialog').addEventListener('click',()=>itemDialog.close());$('closeAdminDialog').addEventListener('click',()=> $('adminDialog').close());
$('showHistoryBtn').addEventListener('click',()=>{$('historySection').classList.remove('hidden');$('inventorySection').classList.add('hidden');renderHistory();});
$('showInventoryBtn').addEventListener('click',()=>{$('historySection').classList.add('hidden');$('inventorySection').classList.remove('hidden');});

sampleData();render();
