let allCustomers = [], allCallLogs = [], allDeliveries = [], allProducts = [], allStaff = [], allProfiles = [];
let filteredQueue = [];
let selectedCustomer = null;
let itemRows = [];
let isAdmin = false;
let currentChannel = 'call';

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  isAdmin = profile.role === 'admin';

  // Remove duplicate sidebar
  const placeholder = document.getElementById('sidebar-nav-placeholder');
  if (placeholder) placeholder.closest('aside').remove();

  // Populate outcome dropdown
  const outcomeEl = document.getElementById('call-outcome');
  OUTCOMES.forEach(o => { outcomeEl.innerHTML += `<option value="${o.value}">${o.label}</option>`; });

  if (isAdmin) {
    document.getElementById('q-agent').style.display = '';
    document.getElementById('call-rate-section').style.display = '';
  }

  await loadAll();
  bindEvents();
})();

async function loadAll() {
  const queries = [
    fetchAll((from, to) => {
      let q = window._supabase.from('customers')
        .select('id,full_name,phone,state,order_date,original_product,assigned_to').order('full_name').range(from, to);
      if (!isAdmin) q = q.eq('assigned_to', window._profile.id);
      return q;
    }),
    fetchAll((from, to) =>
      window._supabase.from('call_logs')
        .select('id,customer_id,agent_id,outcome,channel,notes,call_date,profiles(full_name)')
        .order('call_date',{ascending:false}).order('id',{ascending:false}).range(from, to)
    ),
    fetchAll((from, to) =>
      window._supabase.from('deliveries')
        .select('id,customer_id,status').order('id').range(from, to)
    ),
    window._supabase.from('products').select('id,name,selling_price,cost_price').order('name'),
    window._supabase.from('delivery_staff').select('id,name,active').eq('active',true).order('name'),
  ];

  if (isAdmin) {
    queries.push(window._supabase.from('profiles').select('id,full_name,role').in('role',['admin','crs_agent']).order('full_name'));
  }

  const results = await Promise.all(queries);
  allCustomers = results[0];
  allCallLogs = results[1];
  allDeliveries = results[2];
  allProducts = results[3].data || [];
  allStaff = results[4].data || [];

  if (isAdmin) {
    allProfiles = results[5]?.data || [];
    populateAgentFilter();
    renderCallRate();
  }

  const staffSel = document.getElementById('delivery-staff');
  staffSel.innerHTML = '<option value="">— Select staff —</option>';
  allStaff.forEach(s => { staffSel.innerHTML += `<option value="${s.id}">${s.name}</option>`; });

  applyQueueFilter();
  await renderMyActivity();
}

function populateAgentFilter() {
  const sel = document.getElementById('q-agent');
  sel.innerHTML = '<option value="">All Agents</option>' + allProfiles.map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');
}

function renderCallRate() {
  const bar = document.getElementById('call-rate-bar');
  const today = new Date().toISOString().split('T')[0];
  bar.innerHTML = allProfiles.filter(p => p.role === 'crs_agent').map(p => {
    const todayCalls = allCallLogs.filter(c => c.agent_id === p.id && c.call_date && c.call_date.startsWith(today)).length;
    const totalCalls = allCallLogs.filter(c => c.agent_id === p.id).length;
    return `<div class="call-rate-pill"><strong>${p.full_name}</strong>: ${todayCalls} today · ${totalCalls} total</div>`;
  }).join('');
}

function getCampaignStatus(cust) {
  const calls = allCallLogs.filter(c => c.customer_id === cust.id).sort((a,b)=>new Date(b.call_date)-new Date(a.call_date));
  const delivs = allDeliveries.filter(d => d.customer_id === cust.id);
  if (delivs.some(d => d.status === 'delivered')) return 'delivered';
  if (delivs.some(d => ['failed','failed_delivery','returned'].includes(d.status))) return 'failed';
  if (delivs.some(d => d.status === 'pending')) return 'ordered_pending';
  if (calls.length === 0) return 'not_contacted';
  if (calls[0]?.outcome === 'interested') return 'interested';
  return 'contacted';
}

function applyQueueFilter() {
  const search = (document.getElementById('q-search').value || '').toLowerCase();
  const tier = document.getElementById('q-tier').value;
  const status = document.getElementById('q-status').value;
  const agent = document.getElementById('q-agent').value;

  filteredQueue = allCustomers.filter(c => {
    const matchSearch = !search || (c.full_name||'').toLowerCase().includes(search) || (c.phone||'').includes(search);
    const matchTier = !tier || calcTier(c.order_date) === tier;
    const matchStatus = !status || getCampaignStatus(c) === status;
    const matchAgent = !agent || c.assigned_to === agent;
    return matchSearch && matchTier && matchStatus && matchAgent;
  });

  document.getElementById('q-count').textContent = `${filteredQueue.length} customers`;
  renderQueueList();
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function renderQueueList() {
  const list = document.getElementById('queue-list');
  if (filteredQueue.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:16px;"><em>No records found.</em></div>';
    return;
  }
  list.innerHTML = filteredQueue.map(c => {
    const tier = calcTier(c.order_date);
    const calls = allCallLogs.filter(cl => cl.customer_id === c.id).sort((a,b)=>new Date(b.call_date)-new Date(a.call_date));
    const lastCall = calls[0];
    const lastOutcome = lastCall?.outcome || 'not_contacted';
    const days = lastCall ? daysSince(lastCall.call_date) : null;
    const isSelected = selectedCustomer && selectedCustomer.id === c.id;
    return `<div class="queue-item${isSelected?' selected':''}" data-id="${c.id}">
      <div class="queue-item-name">${c.full_name||'—'}</div>
      <div class="queue-item-sub">${c.phone||''} · ${c.state||''} ${days !== null ? '· '+days+'d ago' : ''}</div>
      <div style="margin-top:4px;display:flex;gap:4px;">${tierBadge(tier)}${statusBadge(lastOutcome)}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.queue-item').forEach(el => {
    el.addEventListener('click', () => {
      const c = filteredQueue.find(x => x.id === el.dataset.id);
      if (c) selectQueueCustomer(c);
    });
  });
}

function selectQueueCustomer(c) {
  selectedCustomer = c;
  renderQueueList();
  renderRecordPanel(c);
}

function renderRecordPanel(c) {
  const panel = document.getElementById('record-panel');
  const calls = allCallLogs.filter(cl => cl.customer_id === c.id).sort((a,b)=>new Date(b.call_date)-new Date(a.call_date));
  const tier = calcTier(c.order_date);
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div>
        <div class="record-name">${c.full_name||'—'}</div>
        <div class="record-phone">${c.phone||'—'}</div>
      </div>
      <button class="btn-primary btn-sm" onclick="openCallModal()">+ Log New Call</button>
    </div>
    <div class="record-grid">
      <div class="record-field"><label>STATE</label><span>${c.state||'—'}</span></div>
      <div class="record-field"><label>ORDER DATE</label><span>${fmtDate(c.order_date)}</span></div>
      <div class="record-field"><label>ORIGINAL PRODUCT</label><span>${c.original_product||'—'}</span></div>
      <div class="record-field"><label>TIER</label><span>${tierBadge(tier)}</span></div>
    </div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:var(--ml-gold-dim);margin-bottom:10px;">Call History (${calls.length})</div>
    ${calls.length === 0
      ? '<div class="empty-state"><em>No calls logged for this customer.</em></div>'
      : calls.map(cl => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--ml-border);">
          ${statusBadge(cl.outcome)}
          <span style="font-size:12px;color:var(--ml-muted);">by ${cl.profiles?.full_name||'—'} · ${fmtDate(cl.call_date)}</span>
          <button class="btn-ghost btn-sm" style="margin-left:auto;" onclick="openEditCall('${cl.id}')">Edit</button>
        </div>`).join('')
    }`;
}

async function renderMyActivity() {
  const tbody = document.getElementById('activity-body');
  const myCalls = allCallLogs.filter(c => c.agent_id === window._profile.id).slice(0, 200);
  if (myCalls.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }
  const custMap = {};
  allCustomers.forEach(c => { custMap[c.id] = c; });
  tbody.innerHTML = myCalls.map(c => {
    const cust = custMap[c.customer_id] || {};
    return `<tr>
      <td>${fmtDate(c.call_date)}</td>
      <td>${cust.full_name||'—'}</td>
      <td>${statusBadge(c.outcome)}</td>
      <td>${c.channel === 'whatsapp' ? 'WhatsApp' : 'Call'}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.notes||'—'}</td>
      <td><button class="btn-ghost btn-sm" onclick="openEditCall('${c.id}')">Edit</button></td>
    </tr>`;
  }).join('');
}

function setChannel(ch) {
  currentChannel = ch;
  document.getElementById('call-channel').value = ch;
  document.getElementById('ch-call').className = ch === 'call' ? 'btn-primary btn-sm' : 'btn-outline btn-sm';
  document.getElementById('ch-whatsapp').className = ch === 'whatsapp' ? 'btn-primary btn-sm' : 'btn-outline btn-sm';
}

function openCallModal(prefillCustomer) {
  document.getElementById('edit-call-id').value = '';
  document.getElementById('call-modal-title').textContent = 'Log New Call';
  itemRows = [];
  document.getElementById('call-outcome').value = OUTCOMES[0].value;
  setChannel('call');
  document.getElementById('call-notes').value = '';
  document.getElementById('order-section').style.display = 'none';
  document.getElementById('items-container').innerHTML = '';
  document.getElementById('running-total').textContent = 'Total: ₦0';
  document.getElementById('delivery-fee').value = '0';
  document.getElementById('waybill-fee').value = '0';
  document.getElementById('waybill-group').style.display = 'none';
  document.getElementById('customer-list').style.display = 'none';

  const cust = prefillCustomer || selectedCustomer;
  if (cust) {
    document.getElementById('customer-search').value = cust.full_name;
    document.getElementById('selected-customer-id').value = cust.id;
    document.getElementById('selected-customer-info').innerHTML =
      `${cust.phone||''} | ${cust.state||''} | ${tierBadge(calcTier(cust.order_date))}`;
    checkWaybill(cust.state);
  } else {
    document.getElementById('customer-search').value = '';
    document.getElementById('selected-customer-id').value = '';
    document.getElementById('selected-customer-info').textContent = '';
  }
  openModal('modal-call');
}

async function openEditCall(callId) {
  const cl = allCallLogs.find(c => c.id === callId);
  if (!cl) return;
  document.getElementById('edit-call-id').value = cl.id;
  document.getElementById('call-modal-title').textContent = 'Edit Call';
  const cust = allCustomers.find(c => c.id === cl.customer_id);
  if (cust) {
    document.getElementById('customer-search').value = cust.full_name;
    document.getElementById('selected-customer-id').value = cust.id;
    document.getElementById('selected-customer-info').innerHTML = `${cust.phone||''} | ${cust.state||''} | ${tierBadge(calcTier(cust.order_date))}`;
    checkWaybill(cust.state);
  }
  document.getElementById('call-outcome').value = cl.outcome||OUTCOMES[0].value;
  setChannel(cl.channel||'call');
  document.getElementById('call-notes').value = cl.notes||'';
  document.getElementById('order-section').style.display = 'none';
  itemRows = [];
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
  const { data } = await window._supabase.from('customers')
    .select('id,full_name,phone,state,order_date')
    .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(8);
  if (!data || data.length === 0) { list.style.display = 'none'; return; }
  list.innerHTML = data.map(c =>
    `<div class="autocomplete-item" data-id="${c.id}" data-name="${(c.full_name||'').replace(/"/g,'&quot;')}" data-phone="${c.phone||''}" data-state="${c.state||''}" data-order-date="${c.order_date||''}">
      <div><div class="ac-name">${c.full_name}</div><div class="ac-phone">${c.phone||''}</div></div>
      ${tierBadge(calcTier(c.order_date))}
    </div>`
  ).join('');
  list.style.display = 'block';
  list.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', () => {
      selectModalCustomer({ id: el.dataset.id, full_name: el.dataset.name, phone: el.dataset.phone, state: el.dataset.state, order_date: el.dataset.orderDate });
    });
  });
}

function selectModalCustomer(c) {
  selectedCustomer = c;
  document.getElementById('customer-search').value = c.full_name;
  document.getElementById('selected-customer-id').value = c.id;
  document.getElementById('customer-list').style.display = 'none';
  document.getElementById('selected-customer-info').innerHTML = `${c.phone||''} | ${c.state||''} | ${tierBadge(calcTier(c.order_date))}`;
  checkWaybill(c.state);
}

function checkWaybill(state) {
  const show = state && state.toLowerCase() !== 'lagos';
  document.getElementById('waybill-group').style.display = show ? '' : 'none';
}

function onOutcomeChange() {
  const val = document.getElementById('call-outcome').value;
  document.getElementById('order-section').style.display = val === 'ordered' ? '' : 'none';
  if (val === 'ordered' && itemRows.length === 0) addItemRow();
}

function addItemRow() {
  const container = document.getElementById('items-container');
  const idx = itemRows.length;
  itemRows.push({ product_id:'', qty:1, sale_price:0 });
  const productOptions = allProducts.map(p => `<option value="${p.id}" data-price="${p.selling_price||0}">${p.name}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'item-row'; row.dataset.idx = idx;
  row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 120px 32px;gap:8px;align-items:end;margin-bottom:8px;';
  row.innerHTML = `
    <div class="form-group" style="margin:0;">
      <label style="font-size:10px;">Product</label>
      <select class="item-product" data-idx="${idx}"><option value="">— Select —</option>${productOptions}</select>
    </div>
    <div class="form-group" style="margin:0;">
      <label style="font-size:10px;">Qty</label>
      <input type="number" class="item-qty" data-idx="${idx}" value="1" min="1" />
    </div>
    <div class="form-group" style="margin:0;">
      <label style="font-size:10px;">Sale Price (₦)</label>
      <input type="number" class="item-price" data-idx="${idx}" value="0" min="0" />
    </div>
    <button type="button" class="btn-ghost btn-sm item-remove-btn" data-idx="${idx}" style="padding:4px 6px;">✕</button>`;
  row.querySelector('.item-product').addEventListener('change', e => {
    const price = e.target.selectedOptions[0]?.dataset?.price || 0;
    row.querySelector('.item-price').value = price;
    syncItem(idx); recalcTotal();
  });
  row.querySelector('.item-qty').addEventListener('input', () => { syncItem(idx); recalcTotal(); });
  row.querySelector('.item-price').addEventListener('input', () => { syncItem(idx); recalcTotal(); });
  row.querySelector('.item-remove-btn').addEventListener('click', () => { row.remove(); itemRows[idx] = null; recalcTotal(); });
  container.appendChild(row);
  recalcTotal();
}

function syncItem(idx) {
  const row = document.querySelector(`.item-row[data-idx="${idx}"]`);
  if (!row) return;
  itemRows[idx] = {
    product_id: row.querySelector('.item-product').value,
    qty: Number(row.querySelector('.item-qty').value)||1,
    sale_price: Number(row.querySelector('.item-price').value)||0,
  };
}

function recalcTotal() {
  const total = itemRows.filter(Boolean).reduce((s,r) => s + r.sale_price * r.qty, 0);
  document.getElementById('running-total').textContent = 'Total: ' + fmtMoney(total);
}

async function submitCall() {
  const editId = document.getElementById('edit-call-id').value;
  const customerId = document.getElementById('selected-customer-id').value;
  if (!customerId) { showToast('Please select a customer','error'); return; }
  const outcome = document.getElementById('call-outcome').value;
  const channel = document.getElementById('call-channel').value;
  const notes = document.getElementById('call-notes').value.trim();
  const agentId = window._session.user.id;
  const btn = document.getElementById('submit-call-btn');
  btn.disabled=true; btn.textContent='Saving…';
  try {
    if (editId) {
      const { error } = await window._supabase.from('call_logs').update({ outcome, channel, notes }).eq('id', editId).select();
      if (error) throw error;
    } else {
      const { error } = await window._supabase.from('call_logs').insert({ customer_id: customerId, agent_id: agentId, outcome, channel, notes, call_date: new Date().toISOString() });
      if (error) throw error;
    }

    if (outcome === 'ordered') {
      const validItems = itemRows.filter(Boolean).filter(r => r.product_id);
      if (validItems.length === 0) { showToast('Please add at least one product item','error'); btn.disabled=false; btn.textContent='Save'; return; }
      const deliveryFee = Number(document.getElementById('delivery-fee').value)||0;
      const waybillFee = Number(document.getElementById('waybill-fee').value)||0;
      const staffId = document.getElementById('delivery-staff').value||null;
      const totalSale = validItems.reduce((s,r) => s + r.sale_price * r.qty, 0);
      const firstP = allProducts.find(p => p.id === validItems[0].product_id);
      const delivPayload = {
        customer_id: customerId, agent_id: agentId, logged_by: agentId,
        product_id: validItems[0].product_id, quantity: validItems[0].qty,
        sale_price: totalSale, cost_price: firstP ? Number(firstP.cost_price||0) * validItems[0].qty : 0,
        delivery_fee: deliveryFee, waybill_fee: waybillFee,
        delivery_staff_id: staffId, items: validItems, status: 'pending',
      };
      const { data: existing } = await window._supabase.from('deliveries').select('id').eq('customer_id',customerId).eq('status','pending').limit(1);
      if (existing && existing.length > 0) {
        const { data: upd, error } = await window._supabase.from('deliveries').update(delivPayload).eq('id',existing[0].id).select();
        if (error) throw error;
        if (!upd||upd.length===0) throw new Error('Delivery update failed');
      } else {
        const { error } = await window._supabase.from('deliveries').insert(delivPayload);
        if (error) throw error;
      }
    }

    showToast(outcome==='ordered' ? 'Call logged and order created!' : 'Call logged');
    closeModal('modal-call');
    await loadAll();
    if (selectedCustomer) {
      const c = allCustomers.find(x => x.id === selectedCustomer.id);
      if (c) renderRecordPanel(c);
    }
  } catch (err) {
    console.error(err);
    showToast(err.message||'Failed to save','error');
  } finally {
    btn.disabled=false; btn.textContent='Save';
  }
}

function bindEvents() {
  document.getElementById('q-search').addEventListener('input', applyQueueFilter);
  document.getElementById('q-tier').addEventListener('change', applyQueueFilter);
  document.getElementById('q-status').addEventListener('change', applyQueueFilter);
  document.getElementById('q-agent').addEventListener('change', applyQueueFilter);
  document.getElementById('call-outcome').addEventListener('change', onOutcomeChange);
  document.getElementById('btn-add-item').addEventListener('click', addItemRow);
  document.getElementById('submit-call-btn').addEventListener('click', submitCall);
  document.getElementById('btn-log-call-activity').addEventListener('click', () => { selectedCustomer = null; openCallModal(); });

  const searchEl = document.getElementById('customer-search');
  let debounce;
  searchEl.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => searchCustomers(searchEl.value), 250); });
  searchEl.addEventListener('blur', () => { setTimeout(() => { document.getElementById('customer-list').style.display = 'none'; }, 200); });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}
