let allCalls = [];
let filteredCalls = [];
let allProducts = [];
let allStaff = [];
let currentPage = 1;
const PAGE_SIZE = 50;
let isAdmin = false;
let selectedCustomer = null;
let itemRows = [];

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  isAdmin = profile.role === 'admin';

  // Populate outcome dropdown
  const outcomeSelect = document.getElementById('call-outcome');
  const filterOutcome = document.getElementById('filter-outcome');
  OUTCOMES.forEach(o => {
    outcomeSelect.innerHTML += `<option value="${o.value}">${o.label}</option>`;
    filterOutcome.innerHTML += `<option value="${o.value}">${o.label}</option>`;
  });

  // Load agents for filter
  if (isAdmin) {
    const { data: agents } = await window._supabase
      .from('profiles').select('id, full_name').order('full_name');
    const agentFilter = document.getElementById('filter-agent');
    (agents || []).forEach(a => {
      agentFilter.innerHTML += `<option value="${a.id}">${a.full_name}</option>`;
    });
  } else {
    document.getElementById('filter-agent').style.display = 'none';
  }

  // Load products and delivery staff
  await Promise.all([loadProducts(), loadDeliveryStaff()]);

  await loadCalls();
  bindEvents();
})();

async function loadProducts() {
  const { data } = await window._supabase
    .from('products').select('id, name, selling_price, cost_price').order('name');
  allProducts = data || [];
}

async function loadDeliveryStaff() {
  const { data } = await window._supabase
    .from('profiles').select('id, full_name').eq('role', 'delivery_staff').order('full_name');
  allStaff = data || [];
  const staffSelect = document.getElementById('delivery-staff');
  staffSelect.innerHTML = '<option value="">— Select staff —</option>';
  allStaff.forEach(s => {
    staffSelect.innerHTML += `<option value="${s.id}">${s.full_name}</option>`;
  });
  // fallback: if no delivery_staff role, load all profiles
  if (allStaff.length === 0) {
    const { data: all } = await window._supabase
      .from('profiles').select('id, full_name').order('full_name');
    allStaff = all || [];
    staffSelect.innerHTML = '<option value="">— Select staff —</option>';
    allStaff.forEach(s => {
      staffSelect.innerHTML += `<option value="${s.id}">${s.full_name}</option>`;
    });
  }
}

async function loadCalls() {
  document.getElementById('calls-body').innerHTML =
    `<tr class="loading-row"><td colspan="7"><span class="spinner"></span></td></tr>`;

  try {
    allCalls = await fetchAll((from, to) => {
      let q = window._supabase
        .from('call_logs')
        .select('id, outcome, channel, notes, call_date, customer_id, agent_id, customers(full_name, phone), profiles(full_name)')
        .order('call_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
      if (!isAdmin) q = q.eq('agent_id', window._profile.id);
      return q;
    });

    applyFilters();
  } catch (err) {
    console.error(err);
    showToast('Failed to load calls', 'error');
  }
}

function applyFilters() {
  const search  = document.getElementById('search-input').value.toLowerCase();
  const outcome = document.getElementById('filter-outcome').value;
  const agent   = document.getElementById('filter-agent').value;
  const from    = document.getElementById('filter-date-from').value;
  const to      = document.getElementById('filter-date-to').value;

  filteredCalls = allCalls.filter(c => {
    const matchSearch  = !search  || (c.customers?.full_name || '').toLowerCase().includes(search) || (c.customers?.phone || '').includes(search);
    const matchOutcome = !outcome || c.outcome === outcome;
    const matchAgent   = !agent   || c.agent_id === agent;
    const callDate     = c.call_date ? c.call_date.split('T')[0] : '';
    const matchFrom    = !from    || callDate >= from;
    const matchTo      = !to      || callDate <= to;
    return matchSearch && matchOutcome && matchAgent && matchFrom && matchTo;
  });

  currentPage = 1;
  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById('calls-body');
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredCalls.slice(start, start + PAGE_SIZE);

  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><span class="empty-icon">📞</span>No calls found</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows.map(c => `
    <tr>
      <td><strong>${c.customers?.full_name || '—'}</strong></td>
      <td>${c.customers?.phone || '—'}</td>
      <td>${c.profiles?.full_name || '—'}</td>
      <td>${c.channel === 'whatsapp' ? '💬 WhatsApp' : '📞 Call'}</td>
      <td>${statusBadge(c.outcome)}</td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${(c.notes||'').replace(/"/g,'&quot;')}">${c.notes || '—'}</td>
      <td>${fmtDate(c.call_date)}</td>
    </tr>
  `).join('');
}

function renderPagination() {
  const total = filteredCalls.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }

  let html = `<span class="page-info">Showing ${Math.min((currentPage-1)*PAGE_SIZE+1,total)}–${Math.min(currentPage*PAGE_SIZE,total)} of ${total}</span>`;
  html += `<button class="btn btn-secondary btn-sm" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== pages) {
      if (i === 2 || i === pages - 1) html += `<span style="padding:0 4px">…</span>`;
      continue;
    }
    html += `<button class="btn btn-sm ${i===currentPage?'btn-primary':'btn-secondary'}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="btn btn-secondary btn-sm" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

function goPage(p) {
  const pages = Math.ceil(filteredCalls.length / PAGE_SIZE);
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
  renderPagination();
}

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-outcome').addEventListener('change', applyFilters);
  document.getElementById('filter-agent').addEventListener('change', applyFilters);
  document.getElementById('filter-date-from').addEventListener('change', applyFilters);
  document.getElementById('filter-date-to').addEventListener('change', applyFilters);

  document.getElementById('btn-log-call').addEventListener('click', openCallModal);
  document.getElementById('call-outcome').addEventListener('change', onOutcomeChange);
  document.getElementById('btn-add-item').addEventListener('click', addItemRow);
  document.getElementById('submit-call-btn').addEventListener('click', submitCall);

  // Customer typeahead
  const searchEl = document.getElementById('customer-search');
  let debounceTimer;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchCustomers(searchEl.value), 250);
  });

  searchEl.addEventListener('blur', () => {
    setTimeout(() => {
      document.getElementById('customer-list').style.display = 'none';
    }, 200);
  });
}

function openCallModal() {
  selectedCustomer = null;
  itemRows = [];
  document.getElementById('customer-search').value = '';
  document.getElementById('selected-customer-id').value = '';
  document.getElementById('selected-customer-info').textContent = '';
  document.getElementById('customer-list').style.display = 'none';
  document.getElementById('call-outcome').value = OUTCOMES[0].value;
  document.getElementById('call-channel').value = 'call';
  document.getElementById('call-notes').value = '';
  document.getElementById('order-section').style.display = 'none';
  document.getElementById('items-container').innerHTML = '';
  document.getElementById('running-total').textContent = 'Total: ₦0';
  document.getElementById('delivery-fee').value = '0';
  document.getElementById('waybill-fee').value = '0';
  document.getElementById('waybill-group').style.display = 'none';
  openModal('modal-call');
}

async function searchCustomers(query) {
  const list = document.getElementById('customer-list');
  if (!query || query.length < 2) { list.style.display = 'none'; return; }

  const { data } = await window._supabase
    .from('customers')
    .select('id, full_name, phone, state, order_date')
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(8);

  if (!data || data.length === 0) { list.style.display = 'none'; return; }

  list.innerHTML = data.map(c => {
    const tier = calcTier(c.order_date);
    return `<div class="autocomplete-item" data-id="${c.id}" data-name="${c.full_name}" data-phone="${c.phone||''}" data-state="${c.state||''}" data-order-date="${c.order_date||''}">
      <div>
        <div class="ac-name">${c.full_name}</div>
        <div class="ac-phone">${c.phone || ''}</div>
      </div>
      ${tierBadge(tier)}
    </div>`;
  }).join('');

  list.style.display = 'block';

  list.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', () => selectCustomer({
      id:         el.dataset.id,
      full_name:  el.dataset.name,
      phone:      el.dataset.phone,
      state:      el.dataset.state,
      order_date: el.dataset.orderDate,
    }));
  });
}

function selectCustomer(c) {
  selectedCustomer = c;
  document.getElementById('customer-search').value = c.full_name;
  document.getElementById('selected-customer-id').value = c.id;
  document.getElementById('customer-list').style.display = 'none';
  const tier = calcTier(c.order_date);
  document.getElementById('selected-customer-info').innerHTML =
    `${c.phone} &nbsp;|&nbsp; ${c.state || 'N/A'} &nbsp;|&nbsp; ${tierBadge(tier)}`;
  // Show/hide waybill fee based on state
  checkWaybill(c.state);
}

function checkWaybill(state) {
  const show = state && state.toLowerCase() !== 'lagos';
  document.getElementById('waybill-group').style.display = show ? 'block' : 'none';
}

function onOutcomeChange() {
  const val = document.getElementById('call-outcome').value;
  const orderSection = document.getElementById('order-section');
  if (val === 'ordered') {
    orderSection.style.display = 'block';
    if (itemRows.length === 0) addItemRow();
  } else {
    orderSection.style.display = 'none';
  }
}

function addItemRow() {
  const container = document.getElementById('items-container');
  const idx = itemRows.length;
  itemRows.push({ product_id: '', qty: 1, sale_price: 0 });

  const productOptions = allProducts.map(p =>
    `<option value="${p.id}" data-price="${p.selling_price || 0}">${p.name}</option>`
  ).join('');

  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <div class="form-group">
      <label>Product</label>
      <select class="item-product" data-idx="${idx}">
        <option value="">— Select —</option>
        ${productOptions}
      </select>
    </div>
    <div class="form-group">
      <label>Qty</label>
      <input type="number" class="item-qty" data-idx="${idx}" value="1" min="1" />
    </div>
    <div class="form-group">
      <label>Sale Price (₦)</label>
      <input type="number" class="item-price" data-idx="${idx}" value="0" min="0" />
    </div>
    <button type="button" class="item-remove-btn" data-idx="${idx}" title="Remove item">✕</button>
  `;

  row.querySelector('.item-product').addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    const price = opt?.dataset?.price || 0;
    row.querySelector('.item-price').value = price;
    syncItem(idx);
    recalcTotal();
  });
  row.querySelector('.item-qty').addEventListener('input', () => { syncItem(idx); recalcTotal(); });
  row.querySelector('.item-price').addEventListener('input', () => { syncItem(idx); recalcTotal(); });
  row.querySelector('.item-remove-btn').addEventListener('click', () => {
    row.remove();
    itemRows[idx] = null;
    recalcTotal();
  });

  container.appendChild(row);
  recalcTotal();
}

function syncItem(idx) {
  const row = document.querySelector(`.item-row[data-idx="${idx}"]`);
  if (!row) return;
  itemRows[idx] = {
    product_id: row.querySelector('.item-product').value,
    qty:        Number(row.querySelector('.item-qty').value) || 1,
    sale_price: Number(row.querySelector('.item-price').value) || 0,
  };
}

function recalcTotal() {
  const total = itemRows.filter(Boolean).reduce((s, r) => s + (r.sale_price * r.qty), 0);
  document.getElementById('running-total').textContent = 'Total: ' + fmtMoney(total);
}

async function submitCall() {
  const customerId = document.getElementById('selected-customer-id').value;
  if (!customerId) { showToast('Please select a customer', 'error'); return; }

  const outcome  = document.getElementById('call-outcome').value;
  const channel  = document.getElementById('call-channel').value;
  const notes    = document.getElementById('call-notes').value.trim();
  const agentId  = window._session.user.id;

  const btn = document.getElementById('submit-call-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    // 1. Insert call log
    const { error: callErr } = await window._supabase
      .from('call_logs')
      .insert({ customer_id: customerId, agent_id: agentId, outcome, channel, notes, call_date: new Date().toISOString() });
    if (callErr) throw callErr;

    // 2. If ordered — upsert delivery
    if (outcome === 'ordered') {
      const validItems = itemRows.filter(Boolean).filter(r => r.product_id);
      if (validItems.length === 0) {
        showToast('Please add at least one product item', 'error');
        btn.disabled = false; btn.textContent = 'Save';
        return;
      }

      const deliveryFee = Number(document.getElementById('delivery-fee').value) || 0;
      const waybillFee  = Number(document.getElementById('waybill-fee').value)  || 0;
      const staffId     = document.getElementById('delivery-staff').value || null;
      const totalSale   = validItems.reduce((s, r) => s + r.sale_price * r.qty, 0);

      // Get cost price for first product
      const firstProduct = allProducts.find(p => p.id === validItems[0].product_id);
      const costPrice = firstProduct ? Number(firstProduct.cost_price || 0) * validItems[0].qty : 0;

      const deliveryPayload = {
        customer_id:        customerId,
        agent_id:           agentId,
        logged_by:          agentId,
        product_id:         validItems[0].product_id,
        quantity:           validItems[0].qty,
        sale_price:         totalSale,
        cost_price:         costPrice,
        delivery_fee:       deliveryFee,
        waybill_fee:        waybillFee,
        delivery_staff_id:  staffId,
        items:              validItems,
        status:             'pending',
      };

      // Check for existing pending delivery
      const { data: existing } = await window._supabase
        .from('deliveries')
        .select('id')
        .eq('customer_id', customerId)
        .eq('status', 'pending')
        .limit(1);

      if (existing && existing.length > 0) {
        // Update existing
        const { data: updated, error: updErr } = await window._supabase
          .from('deliveries')
          .update(deliveryPayload)
          .eq('id', existing[0].id)
          .select();
        if (updErr) throw updErr;
        if (!updated || updated.length === 0) throw new Error('Delivery update failed — RLS blocked it');
      } else {
        // Insert new
        const { error: insErr } = await window._supabase
          .from('deliveries')
          .insert(deliveryPayload);
        if (insErr) throw insErr;
      }
    }

    showToast(outcome === 'ordered' ? 'Call logged and order created!' : 'Call logged successfully');
    closeModal('modal-call');
    await loadCalls();

  } catch (err) {
    console.error(err);
    showToast(err.message || 'Failed to save', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}
