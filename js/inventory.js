let allProducts = [], allStaff = [], allAgentInventory = [], allDispatches = [], allDeliveries = [];

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML = '<div class="empty-state" style="padding:60px;"><em>Admin access only.</em></div>';
    return;
  }
  await loadAll();
  bindEvents();
})();

async function loadAll() {
  try {
    const [products, staff, agentInv, dispatches, deliveries] = await Promise.all([
      window._supabase.from('products').select('id,name,sku,total_stock,dispatched_stock,cost_price,selling_price').order('name'),
      window._supabase.from('delivery_staff').select('id,name,active').order('name'),
      window._supabase.from('agent_inventory').select('id,staff_id,product_id,sent,delivered').order('id'),
      window._supabase.from('inventory_dispatches')
        .select('id,quantity,notes,created_at,product_id,staff_id,products(name),delivery_staff(name),profiles(full_name)')
        .order('created_at', { ascending: false }).limit(200),
      fetchAll((from, to) =>
        window._supabase.from('deliveries')
          .select('id,status,sale_price,product_id,quantity,items,delivery_staff_id').order('id').range(from, to)
      ),
    ]);

    allProducts       = products.data || [];
    allStaff          = staff.data || [];
    allAgentInventory = agentInv.data || [];
    allDispatches     = dispatches.data || [];
    allDeliveries     = deliveries;

    populateDropdowns();
    renderProducts();
    renderStockTable();
    renderDispatchHistory();
  } catch (err) {
    console.error(err);
    showToast('Failed to load inventory data', 'error');
  }
}

function populateDropdowns() {
  const staffSel = document.getElementById('dispatch-staff');
  staffSel.innerHTML = '<option value="">— Select staff —</option>' +
    allStaff.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  const prodSel = document.getElementById('dispatch-product');
  prodSel.innerHTML = '<option value="">— Select product —</option>' +
    allProducts.map(p => `<option value="${p.id}">${p.name} (Stock: ${p.total_stock || 0})</option>`).join('');
}

function getProductStats(p) {
  let unitsOrdered = 0, unitsDelivered = 0;
  let revenueDelivered = 0;
  allDeliveries.forEach(d => {
    const items = Array.isArray(d.items) && d.items.length > 0 ? d.items : [{ product_id: d.product_id, qty: d.quantity || 1 }];
    items.forEach(it => {
      if (it.product_id === p.id) {
        unitsOrdered += Number(it.qty || 1);
        if (d.status === 'delivered') {
          unitsDelivered += Number(it.qty || 1);
        }
      }
    });
    if (d.status === 'delivered') {
      const hasProduct = (Array.isArray(d.items) && d.items.some(it => it.product_id === p.id)) || d.product_id === p.id;
      if (hasProduct) revenueDelivered += Number(d.sale_price || 0);
    }
  });
  return {
    unitsOrdered,
    unitsDelivered,
    pending: unitsOrdered - unitsDelivered,
    revenue: revenueDelivered,
  };
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (allProducts.length === 0) {
    grid.innerHTML = '<div class="empty-state"><em>No products yet.</em></div>';
    return;
  }
  grid.innerHTML = allProducts.map(p => {
    const stats = getProductStats(p);
    return `<div class="product-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-family:var(--ff-display);font-size:22px;font-weight:300;">${p.name}</div>
          <div style="font-size:11px;color:var(--ml-muted);">${p.sku || ''}</div>
        </div>
      </div>
      <div class="product-card-row">
        <span class="label">Selling Price</span>
        <span class="value">${fmtMoney(p.selling_price)}</span>
      </div>
      <div class="product-card-row">
        <span class="label">Cost per Unit</span>
        <span class="value">${fmtMoney(p.cost_price)}</span>
      </div>
      <div class="product-card-row">
        <span class="label">Units Ordered</span>
        <span class="value">${stats.unitsOrdered}</span>
      </div>
      <div class="product-card-row">
        <span class="label">Units Delivered</span>
        <span class="value">${stats.unitsDelivered}</span>
      </div>
      <div class="product-card-row">
        <span class="label">Pending Delivery</span>
        <span class="value">${stats.pending}</span>
      </div>
      <div class="product-card-row">
        <span class="label">Revenue</span>
        <span class="value gold">${fmtMoney(stats.revenue)}</span>
      </div>
      <div style="margin-top:16px;text-align:center;">
        <button class="btn-outline" style="width:100%;" onclick="editProduct('${p.id}')">Edit Product</button>
      </div>
    </div>`;
  }).join('');
}

function renderStockTable() {
  const thead = document.getElementById('stock-thead');
  const tbody = document.getElementById('stock-body');
  if (allStaff.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-state"><em>No delivery staff found.</em></td></tr>';
    return;
  }
  thead.innerHTML = '<tr><th>STAFF</th>' + allProducts.map(p => `<th>${p.name.toUpperCase()}</th>`).join('') + '</tr>';
  tbody.innerHTML = allStaff.map(s => {
    const cells = allProducts.map(p => {
      const inv = allAgentInventory.find(a => a.staff_id === s.id && a.product_id === p.id);
      const sent = inv?.sent || 0;
      const delivered = inv?.delivered || 0;
      const onHand = sent - delivered;
      return `<td style="font-size:12px;">
        <div style="color:var(--ml-muted);font-size:11px;">Sent: ${sent}</div>
        <div style="color:var(--ml-muted);font-size:11px;">Delivered: ${delivered}</div>
        <div style="font-weight:500;">On Hand: ${onHand}</div>
      </td>`;
    }).join('');
    return `<tr>
      <td><strong>${s.name}</strong>${s.active ? '' : ' <span style="color:var(--ml-muted);font-size:11px;">(inactive)</span>'}</td>
      ${cells}
    </tr>`;
  }).join('');
}

function renderDispatchHistory() {
  const tbody = document.getElementById('dispatch-body');
  if (allDispatches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }
  tbody.innerHTML = allDispatches.map(d => `<tr>
    <td>${fmtDate(d.created_at)}</td>
    <td>${d.profiles?.full_name || '—'}</td>
    <td>${d.delivery_staff?.name || '—'}</td>
    <td>${d.products?.name || '—'}</td>
    <td>${d.quantity}</td>
    <td>${d.notes || '—'}</td>
    <td style="display:flex;gap:4px;">
      <button class="btn-ghost btn-sm" onclick="openEditDispatch('${d.id}')">Edit</button>
      <button class="btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteDispatch('${d.id}')">Delete</button>
    </td>
  </tr>`).join('');
}

function editProduct(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('product-id').value = p.id;
  document.getElementById('p-name').value = p.name || '';
  document.getElementById('p-sku').value = p.sku || '';
  document.getElementById('p-sell').value = p.selling_price || 0;
  document.getElementById('p-cost').value = p.cost_price || 0;
  document.getElementById('p-stock').value = p.total_stock || 0;
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  openModal('modal-product');
}

async function saveProduct() {
  const id   = document.getElementById('product-id').value;
  const name = document.getElementById('p-name').value.trim();
  const sku   = document.getElementById('p-sku').value.trim();
  const selling_price = Number(document.getElementById('p-sell').value) || 0;
  const cost_price    = Number(document.getElementById('p-cost').value) || 0;
  const total_stock   = Number(document.getElementById('p-stock').value) || 0;
  if (!name) { showToast('Product name is required', 'error'); return; }
  const btn = document.getElementById('save-product-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const payload = { name, sku, selling_price, cost_price, total_stock };
  let error;
  if (id) {
    const res = await window._supabase.from('products').update(payload).eq('id', id).select();
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) { showToast('Update failed', 'error'); btn.disabled = false; btn.textContent = 'Save Product'; return; }
  } else {
    const res = await window._supabase.from('products').insert(payload).select();
    error = res.error;
  }
  btn.disabled = false; btn.textContent = 'Save Product';
  if (error) { showToast(error.message, 'error'); return; }
  showToast(id ? 'Product updated' : 'Product added');
  closeModal('modal-product');
  await loadAll();
}

async function dispatchInventory(e) {
  e.preventDefault();
  const staffId   = document.getElementById('dispatch-staff').value;
  const productId = document.getElementById('dispatch-product').value;
  const qty       = Number(document.getElementById('dispatch-qty').value) || 0;
  const notes     = document.getElementById('dispatch-notes').value.trim();
  if (!staffId)   { showToast('Please select delivery staff', 'error'); return; }
  if (!productId) { showToast('Please select a product', 'error'); return; }
  if (qty < 1)    { showToast('Quantity must be at least 1', 'error'); return; }
  const product   = allProducts.find(p => p.id === productId);
  const available = (product?.total_stock || 0) - (product?.dispatched_stock || 0);
  if (qty > available) { showToast(`Only ${available} units available`, 'error'); return; }
  const btn = document.getElementById('dispatch-btn');
  btn.disabled = true; btn.textContent = 'Recording…';
  try {
    const { error: dispErr } = await window._supabase.from('inventory_dispatches').insert({
      product_id: productId, staff_id: staffId, quantity: qty, notes,
      dispatched_by: window._session.user.id,
    });
    if (dispErr) throw dispErr;
    const newDispatched = (product.dispatched_stock || 0) + qty;
    const { data: upd, error: updErr } = await window._supabase.from('products')
      .update({ dispatched_stock: newDispatched }).eq('id', productId).select();
    if (updErr) throw updErr;
    if (!upd || upd.length === 0) throw new Error('Stock update failed');
    const existing = allAgentInventory.find(a => a.staff_id === staffId && a.product_id === productId);
    if (existing) {
      await window._supabase.from('agent_inventory').update({ sent: (existing.sent || 0) + qty }).eq('id', existing.id);
    } else {
      await window._supabase.from('agent_inventory').insert({ staff_id: staffId, product_id: productId, sent: qty, delivered: 0 });
    }
    showToast(`Dispatched ${qty} unit(s) of ${product.name}`);
    document.getElementById('dispatch-form').reset();
    await loadAll();
  } catch (err) {
    showToast(err.message || 'Dispatch failed', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Record Dispatch';
  }
}

function openEditDispatch(id) {
  const d = allDispatches.find(x => x.id === id);
  if (!d) return;
  document.getElementById('edit-dispatch-id').value   = d.id;
  document.getElementById('edit-dispatch-qty').value  = d.quantity;
  document.getElementById('edit-dispatch-notes').value = d.notes || '';
  openModal('modal-dispatch-edit');
}

async function saveDispatch() {
  const id    = document.getElementById('edit-dispatch-id').value;
  const qty   = Number(document.getElementById('edit-dispatch-qty').value) || 0;
  const notes = document.getElementById('edit-dispatch-notes').value.trim();
  const btn   = document.getElementById('save-dispatch-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const { data, error } = await window._supabase.from('inventory_dispatches')
    .update({ quantity: qty, notes }).eq('id', id).select();
  btn.disabled = false; btn.textContent = 'Save';
  if (error) { showToast(error.message, 'error'); return; }
  if (!data || data.length === 0) { showToast('Update failed', 'error'); return; }
  showToast('Dispatch updated');
  closeModal('modal-dispatch-edit');
  await loadAll();
}

async function deleteDispatch(id) {
  if (!confirm('Delete this dispatch record?')) return;
  const { error } = await window._supabase.from('inventory_dispatches').delete().eq('id', id);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Dispatch deleted');
  await loadAll();
}

function bindEvents() {
  document.getElementById('btn-add-product').addEventListener('click', () => {
    document.getElementById('product-id').value = '';
    document.getElementById('p-name').value = '';
    document.getElementById('p-sku').value = '';
    document.getElementById('p-sell').value = 0;
    document.getElementById('p-cost').value = 0;
    document.getElementById('p-stock').value = 0;
    document.getElementById('product-modal-title').textContent = 'Add Product';
    openModal('modal-product');
  });
  document.getElementById('save-product-btn').addEventListener('click', saveProduct);
  document.getElementById('dispatch-form').addEventListener('submit', dispatchInventory);
  document.getElementById('save-dispatch-btn').addEventListener('click', saveDispatch);
}
