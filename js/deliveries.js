let allDeliveries = [], allProducts = [], allStaff = [], allProfiles = [], allCustomers = [];
let filteredDeliveries = [];
let currentPage = 1;
const PAGE_SIZE = 50;
let isAdmin = false;
let dItemRows = [];

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  isAdmin = ['admin','temp_admin','supervisor'].includes(profile.role);

  if (!isAdmin) {
    document.getElementById('filter-crs').style.display = 'none';
    document.getElementById('d-crs-group').style.display = 'none';
  }

  await loadAll();
  bindEvents();
})();

async function loadAll() {
  document.getElementById('deliveries-body').innerHTML = '<tr><td colspan="9" class="empty-state"><em>Loading…</em></td></tr>';
  try {
    const [deliveries, products, staff, profiles, customers] = await Promise.all([
      // No relational joins — fetch flat and do client-side lookups
      fetchAll((from, to) => {
        let q = window._supabase.from('deliveries')
          .select('id,status,sale_price,delivery_fee,waybill_fee,created_at,notes,items,product_id,quantity,customer_id,agent_id,logged_by,delivery_staff_id')
          .order('id',{ascending:false}).range(from, to);
        if (!isAdmin) q = q.eq('agent_id', window._profile.id);
        return q;
      }),
      window._supabase.from('products').select('id,name,selling_price,cost_price').order('name'),
      window._supabase.from('delivery_staff').select('id,name,phone,active').order('name'),
      window._supabase.from('profiles').select('id,full_name,role').order('full_name'),
      fetchAll((from, to) =>
        window._supabase.from('customers').select('id,full_name,phone,state,order_date').order('full_name').range(from, to)
      ),
    ]);

    allDeliveries = deliveries;
    allProducts = products.data || [];
    allStaff = staff.data || [];
    allProfiles = profiles.data || [];
    allCustomers = customers;

    // Populate filter dropdowns
    const staffFilter = document.getElementById('filter-staff');
    staffFilter.innerHTML = '<option value="">All Delivery Staff</option>' + allStaff.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    const crsFilter = document.getElementById('filter-crs');
    crsFilter.innerHTML = '<option value="">All CRS</option>' + allProfiles.map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');
    // Modal dropdowns
    const dStaff = document.getElementById('d-staff');
    dStaff.innerHTML = '<option value="">— Select staff —</option>' + allStaff.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    const dCrs = document.getElementById('d-crs');
    dCrs.innerHTML = '<option value="">— Select agent —</option>' + allProfiles.map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');

    renderSummary();
    applyFilters();
  } catch (err) {
    console.error(err);
    showToast('Failed to load deliveries','error');
  }
}

function renderSummary() {
  const pending = allDeliveries.filter(d => d.status === 'pending');
  const delivered = allDeliveries.filter(d => d.status === 'delivered');
  const failed = allDeliveries.filter(d => ['failed','failed_delivery','returned'].includes(d.status));
  document.getElementById('sum-pending').textContent = pending.length;
  document.getElementById('sum-pending-val').textContent = fmtMoney(pending.reduce((s,d) => s+Number(d.sale_price||0),0)) + ' pipeline';
  document.getElementById('sum-delivered').textContent = delivered.length;
  document.getElementById('sum-delivered-val').textContent = fmtMoney(delivered.reduce((s,d) => s+Number(d.sale_price||0),0)) + ' realised';
  document.getElementById('sum-failed').textContent = failed.length;
  document.getElementById('sum-failed-val').textContent = fmtMoney(failed.reduce((s,d) => s+Number(d.sale_price||0),0)) + ' lost';
}

function getItemsDesc(d) {
  if (Array.isArray(d.items) && d.items.length > 0) {
    return d.items.map(it => {
      const p = allProducts.find(x => x.id === it.product_id);
      return `${p ? p.name : '?'} x${it.qty||1}`;
    }).join(', ');
  }
  const p = allProducts.find(x => x.id === d.product_id);
  return p ? `${p.name} x${d.quantity||1}` : '—';
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const status = document.getElementById('filter-status').value;
  const staff = document.getElementById('filter-staff').value;
  const crs = document.getElementById('filter-crs').value;

  filteredDeliveries = allDeliveries.filter(d => {
    const cust = allCustomers.find(c => c.id === d.customer_id);
    const matchSearch = !search ||
      (cust?.full_name||'').toLowerCase().includes(search) ||
      (cust?.phone||'').includes(search);
    const matchStatus = !status || d.status === status || (status==='failed' && ['failed','failed_delivery'].includes(d.status));
    const matchStaff = !staff || d.delivery_staff_id === staff;
    const matchCrs = !crs || d.agent_id === crs;
    return matchSearch && matchStatus && matchStaff && matchCrs;
  });

  currentPage = 1;
  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById('deliveries-body');
  const start = (currentPage-1)*PAGE_SIZE;
  const pageRows = filteredDeliveries.slice(start, start+PAGE_SIZE);
  document.getElementById('row-count').textContent = `${filteredDeliveries.length} entries`;

  if (pageRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }

  const profileMap = {};
  allProfiles.forEach(p => { profileMap[p.id] = p; });

  const custMap  = {};  allCustomers.forEach(c => { custMap[c.id]  = c; });
  const staffMap = {};  allStaff.forEach(s     => { staffMap[s.id] = s; });

  tbody.innerHTML = pageRows.map(d => {
    const cust  = custMap[d.customer_id]  || {};
    const staff = staffMap[d.delivery_staff_id] || {};
    const isPending   = d.status === 'pending';
    const isDelivered = d.status === 'delivered';
    let actions = `<button class="btn-ghost btn-sm" onclick="openEditDelivery('${d.id}')">Edit</button>`;
    if (isPending) {
      actions = `<button class="btn-primary btn-sm" style="background:var(--success);border-color:var(--success);" onclick="updateStatus('${d.id}','delivered')">✓ Delivered</button>
        <button class="btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);margin-top:4px;" onclick="updateStatus('${d.id}','failed')">✗ Failed</button>
        <button class="btn-ghost btn-sm" style="margin-top:4px;" onclick="openEditDelivery('${d.id}')">Edit</button>`;
    } else if (isDelivered) {
      actions = `<button class="btn-ghost btn-sm" onclick="updateStatus('${d.id}','returned')">↩ Returned</button>
        <button class="btn-ghost btn-sm" style="margin-top:4px;" onclick="openEditDelivery('${d.id}')">Edit</button>`;
    }
    const crsName = profileMap[d.agent_id]?.full_name || profileMap[d.logged_by]?.full_name || '—';
    return `<tr>
      <td>${fmtDate(d.created_at)}</td>
      <td><strong>${cust.full_name||'—'}</strong><br/><span style="font-size:11px;color:var(--ml-muted);">${cust.phone||''}</span></td>
      <td>${cust.state||'—'}</td>
      <td style="max-width:180px;font-size:12px;">${getItemsDesc(d)}</td>
      <td class="cell-amount">${fmtMoney(d.sale_price)}</td>
      <td>${statusBadge(d.status)}</td>
      <td>${staff.name||'—'}</td>
      <td>${crsName}</td>
      <td style="min-width:100px;display:flex;flex-direction:column;gap:2px;">${actions}</td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const total = filteredDeliveries.length;
  const pages = Math.ceil(total/PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML=''; return; }
  let html = `<span class="page-info">${Math.min((currentPage-1)*PAGE_SIZE+1,total)}–${Math.min(currentPage*PAGE_SIZE,total)} of ${total}</span>`;
  html += `<button class="btn-outline btn-sm" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  for (let i=1;i<=pages;i++) {
    if (pages>7&&Math.abs(i-currentPage)>2&&i!==1&&i!==pages) { if(i===2||i===pages-1) html+=`<span style="padding:0 4px">…</span>`; continue; }
    html += `<button class="btn-sm ${i===currentPage?'btn-primary':'btn-outline'}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="btn-outline btn-sm" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

function goPage(p) {
  const pages = Math.ceil(filteredDeliveries.length/PAGE_SIZE);
  if (p<1||p>pages) return;
  currentPage = p;
  renderTable();
  renderPagination();
}

async function updateStatus(id, status) {
  const labels = { delivered:'Mark as Delivered', failed:'Mark as Failed', returned:'Mark as Returned' };
  if (!confirm(labels[status]+'?')) return;
  const upd = { status };
  const { data, error } = await window._supabase.from('deliveries').update(upd).eq('id',id).select();
  if (error) { showToast(error.message,'error'); return; }
  if (!data||data.length===0) { showToast('Update failed — RLS may have blocked it','error'); return; }
  showToast(`Delivery marked as ${status}`);
  const idx = allDeliveries.findIndex(d => d.id===id);
  if (idx!==-1) allDeliveries[idx] = {...allDeliveries[idx], ...data[0]};
  renderSummary();
  applyFilters();
}

// --- Delivery Modal ---
function resetDeliveryModal() {
  document.getElementById('delivery-id').value = '';
  document.getElementById('delivery-modal-title').textContent = 'New Pending Delivery';
  document.getElementById('d-cust-search').value = '';
  document.getElementById('d-cust-id').value = '';
  document.getElementById('d-cust-info').textContent = '';
  document.getElementById('d-cust-list').style.display = 'none';
  document.getElementById('d-items-container').innerHTML = '';
  dItemRows = [];
  document.getElementById('d-running-total').textContent = 'Total: ₦0';
  document.getElementById('d-delivery-fee').value = '0';
  document.getElementById('d-waybill-fee').value = '0';
  document.getElementById('d-waybill-group').style.display = 'none';
  document.getElementById('d-status').value = 'pending';
  document.getElementById('d-notes').value = '';
  document.getElementById('d-crs').value = '';
  document.getElementById('d-staff').value = '';
}

function openEditDelivery(id) {
  const d = allDeliveries.find(x => x.id === id);
  if (!d) return;
  resetDeliveryModal();
  document.getElementById('delivery-id').value = d.id;
  document.getElementById('delivery-modal-title').textContent = 'Edit Delivery';
  // Client-side customer lookup (no join)
  const cust = allCustomers.find(c => c.id === d.customer_id);
  if (cust) {
    document.getElementById('d-cust-search').value = cust.full_name||'';
    document.getElementById('d-cust-id').value = d.customer_id;
    document.getElementById('d-cust-info').textContent = `${cust.phone||''} · ${cust.state||''}`;
    const show = cust.state && cust.state.toLowerCase() !== 'lagos';
    document.getElementById('d-waybill-group').style.display = show ? '' : 'none';
  }
  document.getElementById('d-status').value = d.status||'pending';
  document.getElementById('d-delivery-fee').value = d.delivery_fee||0;
  document.getElementById('d-waybill-fee').value = d.waybill_fee||0;
  document.getElementById('d-notes').value = d.notes||'';
  document.getElementById('d-staff').value = d.delivery_staff_id||'';
  document.getElementById('d-crs').value = d.agent_id||d.logged_by||'';

  // Populate items — sale_price here is the line total
  const items = Array.isArray(d.items) && d.items.length > 0
    ? d.items
    : [{ product_id: d.product_id, qty: d.quantity||1, sale_price: d.sale_price||0 }];
  items.forEach(it => addDItemRow(it));
  openModal('modal-delivery');
}

function addDItemRow(prefill) {
  const container = document.getElementById('d-items-container');
  const idx = dItemRows.length;
  dItemRows.push({ product_id:'', qty:1, sale_price:0 });
  const productOptions = allProducts.map(p => `<option value="${p.id}" data-price="${p.selling_price||0}">${p.name}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'd-item-row'; row.dataset.idx = idx;
  row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 120px 32px;gap:8px;align-items:end;margin-bottom:8px;';
  row.innerHTML = `
    <div class="form-group" style="margin:0;"><label style="font-size:10px;">Product</label><select class="d-item-product" data-idx="${idx}"><option value="">— Select —</option>${productOptions}</select></div>
    <div class="form-group" style="margin:0;"><label style="font-size:10px;">Qty</label><input type="number" class="d-item-qty" data-idx="${idx}" value="${prefill?.qty||1}" min="1" /></div>
    <div class="form-group" style="margin:0;"><label style="font-size:10px;">Sale Price (₦)</label><input type="number" class="d-item-price" data-idx="${idx}" value="${prefill?.sale_price||0}" min="0" /></div>
    <button type="button" class="btn-ghost btn-sm" data-idx="${idx}" style="padding:4px 6px;" onclick="this.closest('.d-item-row').remove();dItemRows[${idx}]=null;recalcDTotal();">✕</button>`;
  if (prefill?.product_id) row.querySelector('.d-item-product').value = prefill.product_id;
  row.querySelector('.d-item-product').addEventListener('change', e => {
    const price = e.target.selectedOptions[0]?.dataset?.price||0;
    row.querySelector('.d-item-price').value = price;
    syncDItem(idx); recalcDTotal();
  });
  row.querySelector('.d-item-qty').addEventListener('input', () => { syncDItem(idx); recalcDTotal(); });
  row.querySelector('.d-item-price').addEventListener('input', () => { syncDItem(idx); recalcDTotal(); });
  container.appendChild(row);
  recalcDTotal();
}

function syncDItem(idx) {
  const row = document.querySelector(`.d-item-row[data-idx="${idx}"]`);
  if (!row) return;
  dItemRows[idx] = { product_id: row.querySelector('.d-item-product').value, qty: Number(row.querySelector('.d-item-qty').value)||1, sale_price: Number(row.querySelector('.d-item-price').value)||0 };
}

function recalcDTotal() {
  // sale_price is the line total (not unit price), so don't multiply by qty again
  const total = dItemRows.filter(Boolean).reduce((s,r) => s + Number(r.sale_price||0), 0);
  document.getElementById('d-running-total').textContent = 'Total: ' + fmtMoney(total);
}

async function searchDCustomers(query) {
  const list = document.getElementById('d-cust-list');
  if (!query||query.length<2) { list.style.display='none'; return; }
  const { data } = await window._supabase.from('customers').select('id,full_name,phone,state,order_date').or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`).limit(8);
  if (!data||data.length===0) { list.style.display='none'; return; }
  list.innerHTML = data.map(c =>
    `<div class="autocomplete-item" data-id="${c.id}" data-name="${(c.full_name||'').replace(/"/g,'&quot;')}" data-phone="${c.phone||''}" data-state="${c.state||''}" data-order-date="${c.order_date||''}">
      <div><div class="ac-name">${c.full_name}</div><div class="ac-phone">${c.phone||''}</div></div>
      ${tierBadge(calcTier(c.order_date))}
    </div>`
  ).join('');
  list.style.display='block';
  list.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', () => {
      document.getElementById('d-cust-search').value = el.dataset.name;
      document.getElementById('d-cust-id').value = el.dataset.id;
      document.getElementById('d-cust-list').style.display='none';
      document.getElementById('d-cust-info').textContent = `${el.dataset.phone} · ${el.dataset.state}`;
      const show = el.dataset.state && el.dataset.state.toLowerCase()!=='lagos';
      document.getElementById('d-waybill-group').style.display = show ? '' : 'none';
    });
  });
}

async function saveDelivery() {
  const id = document.getElementById('delivery-id').value;
  const custId = document.getElementById('d-cust-id').value;
  if (!custId) { showToast('Please select a customer','error'); return; }
  const validItems = dItemRows.filter(Boolean).filter(r => r.product_id);
  if (validItems.length === 0) { showToast('Please add at least one item','error'); return; }
  const btn = document.getElementById('save-delivery-btn');
  btn.disabled=true; btn.textContent='Saving…';
  // sale_price per item is the line total (already includes qty)
  const totalSale = validItems.reduce((s,r) => s + Number(r.sale_price||0), 0);
  const status = document.getElementById('d-status').value;
  const payload = {
    customer_id: custId,
    agent_id: document.getElementById('d-crs').value || window._session.user.id,
    logged_by: window._session.user.id,
    product_id: validItems[0].product_id,
    quantity: validItems[0].qty,
    sale_price: totalSale,
    delivery_fee: Number(document.getElementById('d-delivery-fee').value)||0,
    waybill_fee: Number(document.getElementById('d-waybill-fee').value)||0,
    delivery_staff_id: document.getElementById('d-staff').value||null,
    items: validItems,
    status,
    notes: document.getElementById('d-notes').value.trim(),
  };
  let error;
  if (id) {
    const res = await window._supabase.from('deliveries').update(payload).eq('id',id).select();
    error = res.error;
    if (!error&&(!res.data||res.data.length===0)) { showToast('Update failed — RLS blocked it','error'); btn.disabled=false; btn.textContent='Save'; return; }
  } else {
    const res = await window._supabase.from('deliveries').insert(payload).select();
    error = res.error;
  }
  btn.disabled=false; btn.textContent='Save';
  if (error) { showToast(error.message,'error'); return; }
  showToast(id ? 'Delivery updated' : 'Delivery created');
  closeModal('modal-delivery');
  await loadAll();
}

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-staff').addEventListener('change', applyFilters);
  document.getElementById('filter-crs').addEventListener('change', applyFilters);
  document.getElementById('btn-new-delivery').addEventListener('click', () => { resetDeliveryModal(); addDItemRow(); openModal('modal-delivery'); });
  document.getElementById('d-add-item').addEventListener('click', () => addDItemRow());
  document.getElementById('save-delivery-btn').addEventListener('click', saveDelivery);
  let debounce;
  document.getElementById('d-cust-search').addEventListener('input', e => { clearTimeout(debounce); debounce = setTimeout(() => searchDCustomers(e.target.value), 250); });
  document.getElementById('d-cust-search').addEventListener('blur', () => { setTimeout(() => { document.getElementById('d-cust-list').style.display='none'; }, 200); });
}
