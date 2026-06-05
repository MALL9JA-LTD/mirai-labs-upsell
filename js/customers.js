let allCustomers = [], allAgents = [], filteredCustomers = [];
let allCallLogs = [], allDeliveries = [];
let currentPage = 1;
const PAGE_SIZE = 50;
let isAdmin = false;
let csvRows = [];
let selectedIds = new Set();
let selectAllMatching = false;

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  isAdmin = ['admin','temp_admin','supervisor'].includes(profile.role);

  if (!isAdmin) {
    document.getElementById('header-actions').style.display = 'none';
    document.getElementById('filter-agent').style.display = 'none';
    document.getElementById('assign-group').style.display = 'none';
    document.getElementById('bulk-bar').style.display = 'none';
  }

  await loadAll();
  bindEvents();
})();

async function loadAll() {
  document.getElementById('customers-body').innerHTML = '<tr><td colspan="10" class="empty-state"><em>Loading…</em></td></tr>';

  const queries = [
    fetchAll((from, to) => {
      let q = window._supabase.from('customers')
        .select('id,full_name,phone,state,order_date,original_product,assigned_to,created_at,profiles!customers_assigned_to_fkey(id,full_name)')
        .order('id').range(from, to);
      if (!isAdmin) q = q.eq('assigned_to', window._profile.id);
      return q;
    }),
    fetchAll((from, to) =>
      window._supabase.from('call_logs')
        .select('id,customer_id,agent_id,outcome,call_date').order('call_date',{ascending:false}).range(from, to)
    ),
    fetchAll((from, to) =>
      window._supabase.from('deliveries')
        .select('id,customer_id,status,sale_price,agent_id,delivery_fee,waybill_fee').order('id').range(from, to)
    ),
  ];

  if (isAdmin) {
    queries.push(
      window._supabase.from('profiles').select('id,full_name,role').order('full_name')
    );
  }

  try {
    const results = await Promise.all(queries);
    allCustomers = results[0];
    allCallLogs = results[1];
    allDeliveries = results[2];

    if (isAdmin) {
      allAgents = results[3].data || [];
      populateAgentDropdowns();
      renderCrsPerformance();
      document.getElementById('crs-perf-section').style.display = 'block';
    }

    applyFilters();
  } catch (err) {
    console.error(err);
    const msg = err?.message || err?.error_description || JSON.stringify(err) || 'Unknown error';
    showToast('Failed to load data: ' + msg, 'error');
    document.getElementById('customers-body').innerHTML = `<tr><td colspan="10" class="empty-state" style="color:#E24B4A;">${msg}</td></tr>`;
  }
}

function populateAgentDropdowns() {
  const selectors = ['filter-agent','c-agent','assign-agent-select','bulk-agent-select'];
  selectors.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const extras = id === 'c-agent' || id === 'assign-agent-select' ? '<option value="">— Unassigned —</option>' : '<option value="">All Agents</option>';
    el.innerHTML = extras + allAgents.map(a => `<option value="${a.id}">${a.full_name}</option>`).join('');
  });
  // distribute modal
  const distList = document.getElementById('distribute-agents-list');
  if (distList) {
    distList.innerHTML = allAgents.filter(a => a.role === 'crs_agent').map(a =>
      `<label style="display:flex;align-items:center;gap:8px;font-size:13px;">
        <input type="checkbox" class="dist-agent-chk" value="${a.id}" /> ${a.full_name}
      </label>`
    ).join('');
  }
}

function renderCrsPerformance() {
  const tbody = document.getElementById('perf-body');
  const custCallMap = {};
  allCallLogs.forEach(c => { if (!custCallMap[c.customer_id]) custCallMap[c.customer_id] = []; custCallMap[c.customer_id].push(c); });
  const custDelMap = {};
  allDeliveries.forEach(d => { if (!custDelMap[d.customer_id]) custDelMap[d.customer_id] = []; custDelMap[d.customer_id].push(d); });

  const rows = allAgents.filter(a => a.role === 'crs_agent').map(a => {
    const myCust = allCustomers.filter(c => c.assigned_to === a.id);
    let notContacted=0, contactedNoOrder=0, interested=0, orderedPending=0, delivered=0, failedRet=0;
    myCust.forEach(c => {
      const calls = custCallMap[c.id] || [];
      const delivs = custDelMap[c.id] || [];
      const hasCalls = calls.length > 0;
      const hasDelvd = delivs.some(d => d.status === 'delivered');
      const hasPending = delivs.some(d => d.status === 'pending');
      const hasFailed = delivs.some(d => ['failed','failed_delivery','returned'].includes(d.status));
      const lastOutcome = calls[0]?.outcome;
      if (!hasCalls) { notContacted++; }
      else if (hasDelvd) { delivered++; }
      else if (hasPending) { orderedPending++; }
      else if (hasFailed) { failedRet++; }
      else if (lastOutcome === 'interested') { interested++; }
      else { contactedNoOrder++; }
    });
    const conv = myCust.length > 0 ? (delivered/myCust.length*100).toFixed(1)+'%' : '—';
    return { name: a.full_name, total: myCust.length, notContacted, contactedNoOrder, interested, orderedPending, delivered, failedRet, conv };
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }

  const totals = { total:0,notContacted:0,contactedNoOrder:0,interested:0,orderedPending:0,delivered:0,failedRet:0 };
  rows.forEach(r => { Object.keys(totals).forEach(k => { totals[k] += r[k] || 0; }); });
  const totalConv = totals.total > 0 ? (totals.delivered/totals.total*100).toFixed(1)+'%' : '—';

  tbody.innerHTML = rows.map(r =>
    `<tr><td>${r.name}</td><td>${r.total}</td><td>${r.notContacted}</td><td>${r.contactedNoOrder}</td>
     <td>${r.interested}</td><td>${r.orderedPending}</td><td>${r.delivered}</td><td>${r.failedRet}</td><td>${r.conv}</td></tr>`
  ).join('') +
  `<tr style="font-weight:500;border-top:0.5px solid var(--ml-border-strong);">
    <td>All CRS</td><td>${totals.total}</td><td>${totals.notContacted}</td><td>${totals.contactedNoOrder}</td>
    <td>${totals.interested}</td><td>${totals.orderedPending}</td><td>${totals.delivered}</td><td>${totals.failedRet}</td><td>${totalConv}</td>
  </tr>`;
}

function getCampaignStatus(cust) {
  const calls = allCallLogs.filter(c => c.customer_id === cust.id).sort((a,b)=>new Date(b.call_date)-new Date(a.call_date));
  const delivs = allDeliveries.filter(d => d.customer_id === cust.id);
  if (delivs.some(d => d.status === 'delivered')) return 'delivered';
  if (delivs.some(d => ['failed','failed_delivery','returned'].includes(d.status))) return 'failed';
  if (delivs.some(d => d.status === 'pending')) return 'ordered_pending';
  if (calls.length === 0) return 'not_contacted';
  const last = calls[0]?.outcome;
  if (last === 'interested') return 'interested';
  return 'contacted';
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const tier = document.getElementById('filter-tier').value;
  const status = document.getElementById('filter-status').value;
  const agent = document.getElementById('filter-agent').value;

  filteredCustomers = allCustomers.filter(c => {
    const matchSearch = !search || (c.full_name||'').toLowerCase().includes(search) || (c.phone||'').includes(search);
    const matchTier = !tier || calcTier(c.order_date) === tier;
    const matchStatus = !status || getCampaignStatus(c) === status;
    const matchAgent = !agent || c.assigned_to === agent;
    return matchSearch && matchTier && matchStatus && matchAgent;
  });

  currentPage = 1;
  selectAllMatching = false;
  selectedIds.clear();
  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById('customers-body');
  const start = (currentPage-1)*PAGE_SIZE;
  const pageRows = filteredCustomers.slice(start, start+PAGE_SIZE);

  document.getElementById('row-count').textContent = `${filteredCustomers.length} entries`;

  if (pageRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }

  tbody.innerHTML = pageRows.map(c => {
    const tier = calcTier(c.order_date);
    const calls = allCallLogs.filter(cl => cl.customer_id === c.id).sort((a,b)=>new Date(b.call_date)-new Date(a.call_date));
    const lastCall = calls[0];
    const campStatus = getCampaignStatus(c);
    const agentName = c.profiles?.full_name || '—';
    const checked = selectedIds.has(c.id) || selectAllMatching ? 'checked' : '';
    return `<tr>
      <td><input type="checkbox" class="row-chk" data-id="${c.id}" ${checked} /></td>
      <td><strong>${c.full_name||'—'}</strong></td>
      <td>${c.phone||'—'}</td>
      <td>${c.state||'—'}</td>
      <td>${fmtDate(c.order_date)}</td>
      <td>${tierBadge(tier)}</td>
      <td>${agentName}</td>
      <td>${lastCall ? fmtDate(lastCall.call_date) : '—'}</td>
      <td>${statusBadge(campStatus)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        <button class="btn-outline btn-sm" onclick="openCallHistory('${c.id}','${(c.full_name||'').replace(/'/g,"\\'")}')">History</button>
        ${isAdmin ? `<button class="btn-ghost btn-sm" onclick="openAssignModal('${c.id}')">Assign</button>` : ''}
        <button class="btn-ghost btn-sm" onclick="editCustomer('${c.id}')">Edit</button>
        ${campStatus === 'ordered_pending' ? `<button class="btn-ghost btn-sm" style="color:var(--ml-gold);border-color:var(--ml-gold-dim);" onclick="openEditFees('${c.id}','${(c.full_name||'').replace(/'/g,"\\'")}')">₦ Fees</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  document.querySelectorAll('.row-chk').forEach(chk => {
    chk.addEventListener('change', e => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      selectAllMatching = false;
      updateBulkBar();
    });
  });
}

function updateBulkBar() {
  const count = selectAllMatching ? filteredCustomers.length : selectedIds.size;
  const bar = document.getElementById('bulk-bar');
  if (count > 0) {
    bar.classList.add('visible');
    document.getElementById('bulk-count').textContent = `${count} selected`;
  } else {
    bar.classList.remove('visible');
  }
}

function renderPagination() {
  const total = filteredCustomers.length;
  const pages = Math.ceil(total/PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = `<span class="page-info">${Math.min((currentPage-1)*PAGE_SIZE+1,total)}–${Math.min(currentPage*PAGE_SIZE,total)} of ${total}</span>`;
  html += `<button class="btn-outline btn-sm" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  for (let i=1;i<=pages;i++) {
    if (pages>7 && Math.abs(i-currentPage)>2 && i!==1 && i!==pages) { if(i===2||i===pages-1) html+=`<span style="padding:0 4px">…</span>`; continue; }
    html += `<button class="btn-sm ${i===currentPage?'btn-primary':'btn-outline'}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="btn-outline btn-sm" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

function goPage(p) {
  const pages = Math.ceil(filteredCustomers.length/PAGE_SIZE);
  if (p<1||p>pages) return;
  currentPage = p;
  renderTable();
  renderPagination();
}

function editCustomer(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('cust-id').value = c.id;
  document.getElementById('c-name').value = c.full_name||'';
  document.getElementById('c-phone').value = c.phone||'';
  document.getElementById('c-state').value = c.state||'';
  document.getElementById('c-order-date').value = c.order_date ? c.order_date.split('T')[0] : '';
  document.getElementById('c-product').value = c.original_product||'';
  if (isAdmin) document.getElementById('c-agent').value = c.assigned_to||'';
  openModal('modal-customer');
}

async function saveCustomer() {
  const id = document.getElementById('cust-id').value;
  const full_name = document.getElementById('c-name').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  const state = document.getElementById('c-state').value;
  const order_date = document.getElementById('c-order-date').value || null;
  const original_product = document.getElementById('c-product').value.trim();
  const assigned_to = isAdmin ? (document.getElementById('c-agent').value||null) : null;
  if (!full_name||!phone) { showToast('Name and phone are required','error'); return; }
  const btn = document.getElementById('save-cust-btn');
  btn.disabled=true; btn.textContent='Saving…';
  const payload = { full_name, phone, state, order_date, original_product, ...(isAdmin ? {assigned_to} : {}) };
  let error;
  if (id) {
    const res = await window._supabase.from('customers').update(payload).eq('id',id).select();
    error = res.error;
    if (!error && (!res.data||res.data.length===0)) { showToast('Update failed — RLS may have blocked it','error'); btn.disabled=false; btn.textContent='Save Customer'; return; }
  } else {
    const res = await window._supabase.from('customers').insert(payload).select();
    error = res.error;
  }
  btn.disabled=false; btn.textContent='Save Customer';
  if (error) { showToast(error.message,'error'); return; }
  showToast(id ? 'Customer updated' : 'Customer added');
  closeModal('modal-customer');
  await loadAll();
}

async function openEditFees(custId, custName) {
  // Find this customer's pending delivery
  const delivery = allDeliveries.find(d => d.customer_id === custId && d.status === 'pending');
  if (!delivery) {
    showToast('No pending delivery found for this customer.', 'error');
    return;
  }
  document.getElementById('fees-delivery-id').value = delivery.id;
  document.getElementById('fees-customer-name').textContent = `Customer: ${custName}`;
  document.getElementById('fees-delivery-fee').value = delivery.delivery_fee || 0;
  document.getElementById('fees-waybill-fee').value  = delivery.waybill_fee  || 0;
  document.getElementById('fees-error').textContent  = '';
  openModal('modal-edit-fees');
}

async function saveFees() {
  const deliveryId  = document.getElementById('fees-delivery-id').value;
  const delivFee    = Number(document.getElementById('fees-delivery-fee').value) || 0;
  const waybillFee  = Number(document.getElementById('fees-waybill-fee').value) || 0;
  const errEl       = document.getElementById('fees-error');
  const btn         = document.getElementById('save-fees-btn');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Saving…';

  const { data, error } = await window._supabase
    .from('deliveries')
    .update({ delivery_fee: delivFee, waybill_fee: waybillFee })
    .eq('id', deliveryId)
    .select();

  btn.disabled = false; btn.textContent = 'Save Fees';
  if (error) { errEl.textContent = error.message; return; }
  if (!data || data.length === 0) { errEl.textContent = 'Update failed — check permissions.'; return; }

  showToast('Delivery fees updated');
  closeModal('modal-edit-fees');
  await loadAll(); // refresh so dashboard/reports pick up new values
}

async function openCallHistory(custId, name) {
  document.getElementById('call-hist-title').textContent = `Call History — ${name}`;
  const calls = allCallLogs.filter(c => c.customer_id === custId).sort((a,b)=>new Date(b.call_date)-new Date(a.call_date));
  const el = document.getElementById('call-hist-body');
  if (calls.length === 0) {
    el.innerHTML = '<div class="empty-state"><em>No calls logged for this customer.</em></div>';
  } else {
    el.innerHTML = calls.map(c => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--ml-border);">
        ${statusBadge(c.outcome)}
        <span style="color:var(--ml-muted);font-size:12px;">· ${fmtDate(c.call_date)}</span>
      </div>`).join('');
  }
  openModal('modal-call-history');
}

function openAssignModal(custId) {
  document.getElementById('assign-cust-id').value = custId;
  const c = allCustomers.find(x => x.id === custId);
  document.getElementById('assign-agent-select').value = c?.assigned_to || '';
  openModal('modal-assign');
}

async function confirmAssign() {
  const custId = document.getElementById('assign-cust-id').value;
  const agentId = document.getElementById('assign-agent-select').value || null;
  const btn = document.getElementById('confirm-assign-btn');
  btn.disabled=true; btn.textContent='Assigning…';
  const { data, error } = await window._supabase.from('customers').update({assigned_to: agentId}).eq('id',custId).select();
  btn.disabled=false; btn.textContent='Assign';
  if (error) { showToast(error.message,'error'); return; }
  if (!data||data.length===0) { showToast('Update failed','error'); return; }
  showToast('Customer assigned');
  closeModal('modal-assign');
  await loadAll();
}

async function bulkAssign() {
  const agentId = document.getElementById('bulk-agent-select').value;
  if (!agentId) { showToast('Please select an agent','error'); return; }
  const ids = selectAllMatching ? filteredCustomers.map(c=>c.id) : [...selectedIds];
  if (ids.length === 0) return;
  const btn = document.getElementById('bulk-assign-btn');
  btn.disabled=true; btn.textContent='Assigning…';

  // Batch in chunks of 200 to avoid URL length limits
  const CHUNK = 200;
  let hasError = false;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await window._supabase
      .from('customers')
      .update({ assigned_to: agentId })
      .in('id', ids.slice(i, i + CHUNK));
    if (error) { showToast(error.message, 'error'); hasError = true; break; }
  }

  btn.disabled=false; btn.textContent='Assign';
  if (hasError) return;
  showToast(`${ids.length} customers assigned`);
  selectedIds.clear(); selectAllMatching=false;
  document.getElementById('bulk-bar').classList.remove('visible');
  await loadAll();
}

async function autoDistribute() {
  const checkedBoxes = document.querySelectorAll('.dist-agent-chk:checked');
  const agentIds = [...checkedBoxes].map(el => el.value);
  if (agentIds.length === 0) { showToast('Select at least one agent','error'); return; }
  const unassigned = allCustomers.filter(c => !c.assigned_to);
  if (unassigned.length === 0) { showToast('No unassigned customers','error'); return; }
  const btn = document.getElementById('confirm-distribute-btn');
  btn.disabled=true; btn.textContent='Distributing…';

  // Round-robin: group customer IDs by which agent they'll go to
  const groups = {}; // agentId -> [customerId, ...]
  agentIds.forEach(id => { groups[id] = []; });
  unassigned.forEach((c, i) => { groups[agentIds[i % agentIds.length]].push(c.id); });

  // One UPDATE per agent, chunked at 500 IDs per call
  const CHUNK = 500;
  let hasError = false;
  for (const agentId of agentIds) {
    const ids = groups[agentId];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await window._supabase
        .from('customers')
        .update({ assigned_to: agentId })
        .in('id', ids.slice(i, i + CHUNK));
      if (error) { showToast('Distribution error: ' + error.message, 'error'); hasError = true; break; }
    }
    if (hasError) break;
  }

  btn.disabled=false; btn.textContent='Distribute';
  if (!hasError) {
    showToast(`Distributed ${rows.length} customers to ${agentIds.length} agent(s)`);
    closeModal('modal-distribute');
    await loadAll();
  }
}

function exportCustomersCsv() {
  const headers = ['full_name','phone','state','order_date','tier','assigned_agent','status'];
  const rows = filteredCustomers.map(c => ({
    full_name: c.full_name||'',
    phone: c.phone||'',
    state: c.state||'',
    order_date: c.order_date||'',
    tier: calcTier(c.order_date),
    assigned_agent: c.profiles?.full_name||'',
    status: getCampaignStatus(c),
  }));
  const csv = [headers.join(','), ...rows.map(r => headers.map(h=>`"${r[h]??''}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv,' + encodeURIComponent(csv);
  a.download = 'customers.csv';
  a.click();
}

function handleCsvFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      csvRows = parseCsv(ev.target.result);
      document.getElementById('csv-preview').textContent = `Parsed ${csvRows.length} row(s). Ready to import.`;
      document.getElementById('csv-error').textContent = '';
      document.getElementById('import-csv-btn').disabled = false;
    } catch (err) {
      document.getElementById('csv-error').textContent = 'Error: ' + err.message;
      document.getElementById('import-csv-btn').disabled = true;
    }
  };
  reader.readAsText(file);
}

// Month name → YYYY-MM-DD, using 2024 for Nov/Dec and 2025 for Jan–Jun
const MONTH_TO_DATE = {
  january:'2025-01-01', february:'2025-02-01', march:'2025-03-01',
  april:'2025-04-01',   may:'2025-05-01',       june:'2025-06-01',
  july:'2025-07-01',    august:'2025-08-01',    september:'2025-09-01',
  october:'2025-10-01', november:'2024-11-01',  december:'2024-12-01',
};

function parseCsvLine(line) {
  // Handles quoted fields containing commas
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function parseCsv(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have header + at least one data row');
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g,'').trim());
  const isNexo = headers.includes('customer name') || headers.includes('order month');
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line).map(v => v.replace(/^"|"$/g,'').trim());
    const raw = {};
    headers.forEach((h, i) => raw[h] = vals[i] || '');
    if (isNexo) {
      const monthKey = (raw['order month'] || '').toLowerCase();
      return {
        full_name:        raw['customer name'] || '',
        phone:            raw['phone number'] || '',
        state:            raw['location'] || '',
        original_product: raw['product'] || '',
        order_date:       MONTH_TO_DATE[monthKey] || null,
        _source_sheet:    raw['sheet'] || '',
      };
    }
    return {
      full_name:        raw['full_name'] || raw['name'] || '',
      phone:            raw['phone'] || '',
      state:            raw['state'] || '',
      order_date:       raw['order_date'] || null,
      original_product: raw['original_product'] || raw['product'] || '',
    };
  });
}

async function importCsv() {
  if (!csvRows.length) return;
  const btn = document.getElementById('import-csv-btn');
  btn.disabled=true; btn.textContent='Importing…';
  const records = csvRows.map(r => ({
    full_name:        r.full_name || '',
    phone:            r.phone || '',
    state:            r.state || '',
    order_date:       r.order_date || null,
    original_product: r.original_product || '',
  })).filter(r => r.full_name && r.phone);
  const { error } = await window._supabase.from('customers').insert(records);
  btn.disabled=false; btn.textContent='Import';
  if (error) { showToast(error.message,'error'); return; }
  showToast(`Imported ${records.length} customers`);
  closeModal('modal-csv');
  csvRows=[];
  document.getElementById('csv-file').value='';
  document.getElementById('csv-preview').textContent='';
  await loadAll();
}

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-tier').addEventListener('change', applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-agent').addEventListener('change', applyFilters);
  document.getElementById('filter-website').addEventListener('change', applyFilters);

  document.getElementById('btn-add-customer').addEventListener('click', () => {
    document.getElementById('cust-id').value='';
    document.getElementById('c-name').value='';
    document.getElementById('c-phone').value='';
    document.getElementById('c-state').value='';
    document.getElementById('c-order-date').value='';
    document.getElementById('c-product').value='';
    if (document.getElementById('c-agent')) document.getElementById('c-agent').value='';
    openModal('modal-customer');
  });
  document.getElementById('save-cust-btn').addEventListener('click', saveCustomer);
  document.getElementById('save-fees-btn').addEventListener('click', saveFees); // available to all roles

  if (isAdmin) {
    document.getElementById('btn-export-csv').addEventListener('click', exportCustomersCsv);
    document.getElementById('btn-import-csv').addEventListener('click', () => openModal('modal-csv'));
    document.getElementById('csv-file').addEventListener('change', handleCsvFile);
    document.getElementById('import-csv-btn').addEventListener('click', importCsv);
    document.getElementById('btn-auto-distribute').addEventListener('click', () => {
      const unassigned = allCustomers.filter(c => !c.assigned_to);
      document.getElementById('distribute-info').textContent = `${unassigned.length} unassigned customers will be distributed.`;
      openModal('modal-distribute');
    });
    document.getElementById('confirm-distribute-btn').addEventListener('click', autoDistribute);
    document.getElementById('confirm-assign-btn').addEventListener('click', confirmAssign);
    document.getElementById('bulk-assign-btn').addEventListener('click', bulkAssign);
    document.getElementById('select-all-link').addEventListener('click', () => {
      selectAllMatching = true;
      selectedIds.clear();
      updateBulkBar();
    });
    document.getElementById('chk-all').addEventListener('change', e => {
      const pageRows = filteredCustomers.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);
      pageRows.forEach(c => { if (e.target.checked) selectedIds.add(c.id); else selectedIds.delete(c.id); });
      selectAllMatching = false;
      renderTable();
      updateBulkBar();
    });
    const perfToggleBtn = document.getElementById('btn-toggle-perf');
    perfToggleBtn.addEventListener('click', () => {
      const card = document.getElementById('crs-perf-card');
      const hidden = card.style.display === 'none';
      card.style.display = hidden ? '' : 'none';
      perfToggleBtn.textContent = hidden ? 'Hide' : 'Show';
    });
  }
}
