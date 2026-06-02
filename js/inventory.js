let allProducts = [];
let allStaff = [];

(async () => {
  const profile = await requireAuth();
  if (!profile) return;

  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML =
      `<div class="empty-state" style="padding:60px;"><span class="empty-icon">🔒</span>Admin access only</div>`;
    return;
  }

  await Promise.all([loadProducts(), loadStaff()]);
  await loadDispatchHistory();
  bindEvents();
})();

async function loadProducts() {
  const { data, error } = await window._supabase
    .from('products')
    .select('id, name, sku, total_stock, dispatched_stock, cost_price, selling_price')
    .order('name');

  if (error) { showToast('Failed to load products', 'error'); return; }
  allProducts = data || [];
  renderProducts();
  populateProductDropdown();
}

async function loadStaff() {
  // Try delivery_staff role first, fallback to all profiles
  let { data } = await window._supabase
    .from('profiles').select('id, full_name').eq('role', 'delivery_staff').order('full_name');
  if (!data || data.length === 0) {
    const res = await window._supabase.from('profiles').select('id, full_name').order('full_name');
    data = res.data || [];
  }
  allStaff = data;

  const staffSelect = document.getElementById('dispatch-staff');
  staffSelect.innerHTML = '<option value="">— Select staff —</option>';
  allStaff.forEach(s => {
    staffSelect.innerHTML += `<option value="${s.id}">${s.full_name}</option>`;
  });
}

function renderProducts() {
  const tbody = document.getElementById('products-body');
  if (!allProducts.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><span class="empty-icon">🏭</span>No products yet</td></tr>`;
    return;
  }

  tbody.innerHTML = allProducts.map(p => {
    const available = (p.total_stock || 0) - (p.dispatched_stock || 0);
    const availClass = available < 5 ? 'style="color:var(--danger);font-weight:700;"' : '';
    return `<tr>
      <td><strong>${p.name}</strong></td>
      <td><code>${p.sku || '—'}</code></td>
      <td>${p.total_stock || 0}</td>
      <td>${p.dispatched_stock || 0}</td>
      <td>—</td>
      <td ${availClass}>${available}</td>
      <td>${fmtMoney(p.cost_price)}</td>
      <td>${fmtMoney(p.selling_price)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editProduct('${p.id}')">Edit</button>
      </td>
    </tr>`;
  }).join('');
}

function populateProductDropdown() {
  const sel = document.getElementById('dispatch-product');
  sel.innerHTML = '<option value="">— Select product —</option>';
  allProducts.forEach(p => {
    sel.innerHTML += `<option value="${p.id}">${p.name} (Stock: ${p.total_stock || 0})</option>`;
  });
}

async function loadDispatchHistory() {
  const tbody = document.getElementById('dispatch-history-body');
  try {
    const { data, error } = await window._supabase
      .from('inventory_dispatches')
      .select('id, quantity, notes, created_at, products(name), profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="empty-icon">📋</span>No dispatches yet</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(d => `
      <tr>
        <td>${d.products?.name || '—'}</td>
        <td>${d.profiles?.full_name || '—'}</td>
        <td>${d.quantity}</td>
        <td>${d.notes || '—'}</td>
        <td>${fmtDate(d.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Failed to load dispatch history</td></tr>`;
  }
}

function editProduct(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('product-id').value = p.id;
  document.getElementById('p-name').value = p.name || '';
  document.getElementById('p-sku').value = p.sku || '';
  document.getElementById('p-stock').value = p.total_stock || 0;
  document.getElementById('p-dispatched').value = p.dispatched_stock || 0;
  document.getElementById('p-cost').value = p.cost_price || 0;
  document.getElementById('p-sell').value = p.selling_price || 0;
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  openModal('modal-product');
}

function bindEvents() {
  document.getElementById('btn-add-product').addEventListener('click', () => {
    document.getElementById('product-id').value = '';
    document.getElementById('p-name').value = '';
    document.getElementById('p-sku').value = '';
    document.getElementById('p-stock').value = 0;
    document.getElementById('p-dispatched').value = 0;
    document.getElementById('p-cost').value = 0;
    document.getElementById('p-sell').value = 0;
    document.getElementById('product-modal-title').textContent = 'Add Product';
    openModal('modal-product');
  });

  document.getElementById('save-product-btn').addEventListener('click', saveProduct);

  document.getElementById('dispatch-form').addEventListener('submit', async e => {
    e.preventDefault();
    await dispatchInventory();
  });
}

async function saveProduct() {
  const id       = document.getElementById('product-id').value;
  const name     = document.getElementById('p-name').value.trim();
  const sku      = document.getElementById('p-sku').value.trim();
  const total_stock      = Number(document.getElementById('p-stock').value) || 0;
  const dispatched_stock = Number(document.getElementById('p-dispatched').value) || 0;
  const cost_price       = Number(document.getElementById('p-cost').value) || 0;
  const selling_price    = Number(document.getElementById('p-sell').value) || 0;

  if (!name) { showToast('Product name is required', 'error'); return; }

  const btn = document.getElementById('save-product-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = { name, sku, total_stock, dispatched_stock, cost_price, selling_price };

  let error;
  if (id) {
    const res = await window._supabase.from('products').update(payload).eq('id', id).select();
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) {
      showToast('Update failed — RLS may have blocked it', 'error');
      btn.disabled = false; btn.textContent = 'Save Product';
      return;
    }
  } else {
    const res = await window._supabase.from('products').insert(payload).select();
    error = res.error;
  }

  btn.disabled = false; btn.textContent = 'Save Product';
  if (error) { showToast(error.message, 'error'); return; }

  showToast(id ? 'Product updated' : 'Product added');
  closeModal('modal-product');
  await loadProducts();
}

async function dispatchInventory() {
  const productId = document.getElementById('dispatch-product').value;
  const staffId   = document.getElementById('dispatch-staff').value;
  const qty       = Number(document.getElementById('dispatch-qty').value) || 0;
  const notes     = document.getElementById('dispatch-notes').value.trim();

  if (!productId) { showToast('Please select a product', 'error'); return; }
  if (!staffId)   { showToast('Please select delivery staff', 'error'); return; }
  if (qty < 1)    { showToast('Quantity must be at least 1', 'error'); return; }

  const product = allProducts.find(p => p.id === productId);
  const available = (product?.total_stock || 0) - (product?.dispatched_stock || 0);
  if (qty > available) {
    showToast(`Only ${available} units available to dispatch`, 'error');
    return;
  }

  const btn = document.getElementById('dispatch-btn');
  btn.disabled = true; btn.textContent = 'Dispatching…';

  try {
    // Insert dispatch record
    const { error: dispErr } = await window._supabase
      .from('inventory_dispatches')
      .insert({ product_id: productId, staff_id: staffId, quantity: qty, notes });
    if (dispErr) throw dispErr;

    // Update product dispatched_stock
    const newDispatched = (product.dispatched_stock || 0) + qty;
    const { data: updated, error: updErr } = await window._supabase
      .from('products')
      .update({ dispatched_stock: newDispatched })
      .eq('id', productId)
      .select();
    if (updErr) throw updErr;
    if (!updated || updated.length === 0) throw new Error('Stock update failed — RLS blocked it');

    showToast(`Dispatched ${qty} unit(s) of ${product.name}`);
    document.getElementById('dispatch-form').reset();
    await loadProducts();
    await loadDispatchHistory();
  } catch (err) {
    showToast(err.message || 'Dispatch failed', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Dispatch';
  }
}
