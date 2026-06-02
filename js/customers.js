let allCustomers = [];
let allAgents = [];
let filteredCustomers = [];
let currentPage = 1;
const PAGE_SIZE = 50;
let isAdmin = false;
let csvRows = [];

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  isAdmin = profile.role === 'admin';

  if (!isAdmin) {
    document.getElementById('admin-actions').style.display = 'none';
    document.getElementById('filter-agent').style.display = 'none';
    document.getElementById('assign-group').style.display = 'none';
  } else {
    document.getElementById('crs-performance').style.display = 'block';
    await loadAgents();
    await loadPerformance();
  }

  await loadCustomers();
  bindEvents();
})();

async function loadAgents() {
  const { data } = await window._supabase
    .from('profiles')
    .select('id, full_name, role')
    .order('full_name');
  allAgents = data || [];

  const agentFilter = document.getElementById('filter-agent');
  const agentSelect = document.getElementById('c-agent');
  allAgents.filter(a => a.role !== 'admin' || true).forEach(a => {
    agentFilter.innerHTML += `<option value="${a.id}">${a.full_name}</option>`;
    agentSelect.innerHTML += `<option value="${a.id}">${a.full_name}</option>`;
  });
}

async function loadCustomers() {
  document.getElementById('customers-body').innerHTML =
    `<tr class="loading-row"><td colspan="9"><span class="spinner"></span></td></tr>`;

  try {
    allCustomers = await fetchAll((from, to) => {
      let q = window._supabase
        .from('customers')
        .select('id, full_name, phone, state, order_date, original_product, assigned_to, created_at, profiles(full_name), call_logs(outcome, call_date)')
        .order('id')
        .range(from, to);
      if (!isAdmin) q = q.eq('assigned_to', window._profile.id);
      return q;
    });

    applyFilters();
  } catch (err) {
    console.error(err);
    showToast('Failed to load customers', 'error');
  }
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const agentFilter = document.getElementById('filter-agent').value;
  const tierFilter = document.getElementById('filter-tier').value;

  filteredCustomers = allCustomers.filter(c => {
    const matchSearch = !search ||
      (c.full_name || '').toLowerCase().includes(search) ||
      (c.phone || '').includes(search);
    const matchAgent = !agentFilter || c.assigned_to === agentFilter;
    const tier = calcTier(c.order_date);
    const matchTier = !tierFilter || tier === tierFilter;
    return matchSearch && matchAgent && matchTier;
  });

  currentPage = 1;
  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById('customers-body');
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredCustomers.slice(start, start + PAGE_SIZE);

  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><span class="empty-icon">👥</span>No customers found</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows.map(c => {
    const tier = calcTier(c.order_date);
    // Last call outcome: pick most recent by call_date
    const calls = (c.call_logs || []).sort((a, b) => new Date(b.call_date) - new Date(a.call_date));
    const lastOutcome = calls[0]?.outcome || 'not_contacted';
    const agentName = c.profiles?.full_name || '—';

    return `<tr>
      <td><strong>${c.full_name || '—'}</strong></td>
      <td>${c.phone || '—'}</td>
      <td>${c.state || '—'}</td>
      <td>${tierBadge(tier)}</td>
      <td>${agentName}</td>
      <td>${statusBadge(lastOutcome)}</td>
      <td>${c.original_product || '—'}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editCustomer('${c.id}')">Edit</button>
        ${isAdmin ? `<button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteCustomer('${c.id}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const total = filteredCustomers.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }

  let html = `<span class="page-info">Showing ${Math.min((currentPage-1)*PAGE_SIZE+1, total)}–${Math.min(currentPage*PAGE_SIZE, total)} of ${total}</span>`;
  html += `<button class="btn btn-secondary btn-sm" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== pages) {
      if (i === 2 || i === pages - 1) html += `<span style="padding:0 4px;">…</span>`;
      continue;
    }
    html += `<button class="btn btn-sm ${i===currentPage?'btn-primary':'btn-secondary'}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="btn btn-secondary btn-sm" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

function goPage(p) {
  const pages = Math.ceil(filteredCustomers.length / PAGE_SIZE);
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
  renderPagination();
}

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-agent').addEventListener('change', applyFilters);
  document.getElementById('filter-tier').addEventListener('change', applyFilters);

  document.getElementById('btn-add-customer').addEventListener('click', () => {
    document.getElementById('customer-id').value = '';
    document.getElementById('c-name').value = '';
    document.getElementById('c-phone').value = '';
    document.getElementById('c-state').value = '';
    document.getElementById('c-order-date').value = '';
    document.getElementById('c-product').value = '';
    document.getElementById('c-agent').value = '';
    document.getElementById('customer-modal-title').textContent = 'Add Customer';
    openModal('modal-customer');
  });

  document.getElementById('save-customer-btn').addEventListener('click', saveCustomer);

  if (isAdmin) {
    document.getElementById('btn-import-csv').addEventListener('click', () => openModal('modal-csv'));
    document.getElementById('csv-file').addEventListener('change', handleCsvFile);
    document.getElementById('import-csv-btn').addEventListener('click', importCsv);
  }
}

function editCustomer(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('customer-id').value = c.id;
  document.getElementById('c-name').value = c.full_name || '';
  document.getElementById('c-phone').value = c.phone || '';
  document.getElementById('c-state').value = c.state || '';
  document.getElementById('c-order-date').value = c.order_date ? c.order_date.split('T')[0] : '';
  document.getElementById('c-product').value = c.original_product || '';
  document.getElementById('c-agent').value = c.assigned_to || '';
  document.getElementById('customer-modal-title').textContent = 'Edit Customer';
  openModal('modal-customer');
}

async function saveCustomer() {
  const id = document.getElementById('customer-id').value;
  const full_name = document.getElementById('c-name').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  const state = document.getElementById('c-state').value.trim();
  const order_date = document.getElementById('c-order-date').value || null;
  const original_product = document.getElementById('c-product').value.trim();
  const assigned_to = document.getElementById('c-agent').value || null;

  if (!full_name || !phone) { showToast('Name and phone are required', 'error'); return; }

  const btn = document.getElementById('save-customer-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = { full_name, phone, state, order_date, original_product, assigned_to };

  let error;
  if (id) {
    const res = await window._supabase.from('customers').update(payload).eq('id', id).select();
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) {
      showToast('Update failed — RLS may have blocked it', 'error');
      btn.disabled = false; btn.textContent = 'Save Customer';
      return;
    }
  } else {
    const res = await window._supabase.from('customers').insert(payload).select();
    error = res.error;
  }

  btn.disabled = false; btn.textContent = 'Save Customer';

  if (error) { showToast(error.message, 'error'); return; }
  showToast(id ? 'Customer updated' : 'Customer added');
  closeModal('modal-customer');
  await loadCustomers();
  if (isAdmin) await loadPerformance();
}

async function deleteCustomer(id) {
  if (!confirm('Delete this customer? This cannot be undone.')) return;
  const { error } = await window._supabase.from('customers').delete().eq('id', id);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Customer deleted');
  await loadCustomers();
}

// ---- CSV Import ----
function handleCsvFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      csvRows = parseCsv(ev.target.result);
      document.getElementById('csv-preview').textContent =
        `Parsed ${csvRows.length} row(s). Ready to import.`;
      document.getElementById('csv-error').textContent = '';
      document.getElementById('import-csv-btn').disabled = false;
    } catch (err) {
      document.getElementById('csv-error').textContent = 'Error parsing CSV: ' + err.message;
      document.getElementById('import-csv-btn').disabled = true;
    }
  };
  reader.readAsText(file);
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i] || '');
    return row;
  });
}

async function importCsv() {
  if (!csvRows.length) return;
  const btn = document.getElementById('import-csv-btn');
  btn.disabled = true; btn.textContent = 'Importing…';

  const records = csvRows.map(r => ({
    full_name: r.full_name || r.name || '',
    phone: r.phone || '',
    state: r.state || '',
    order_date: r.order_date || null,
    original_product: r.original_product || r.product || '',
  })).filter(r => r.full_name && r.phone);

  const { error } = await window._supabase.from('customers').insert(records);
  btn.disabled = false; btn.textContent = 'Import';

  if (error) { showToast(error.message, 'error'); return; }
  showToast(`Imported ${records.length} customers`);
  closeModal('modal-csv');
  csvRows = [];
  document.getElementById('csv-file').value = '';
  document.getElementById('csv-preview').textContent = '';
  await loadCustomers();
}

// ---- CRS Performance ----
async function loadPerformance() {
  try {
    const [agentsRes, callsRes, deliveriesRes] = await Promise.all([
      window._supabase.from('profiles').select('id, full_name').order('full_name'),
      window._supabase.from('call_logs').select('agent_id, outcome').order('id'),
      window._supabase.from('deliveries').select('agent_id, status').order('id'),
    ]);

    // customers per agent from allCustomers
    const custPerAgent = {};
    allCustomers.forEach(c => {
      if (c.assigned_to) custPerAgent[c.assigned_to] = (custPerAgent[c.assigned_to] || 0) + 1;
    });

    const callsPerAgent = {};
    const ordersPerAgent = {};
    (callsRes.data || []).forEach(c => {
      callsPerAgent[c.agent_id] = (callsPerAgent[c.agent_id] || 0) + 1;
      if (c.outcome === 'ordered') ordersPerAgent[c.agent_id] = (ordersPerAgent[c.agent_id] || 0) + 1;
    });

    const deliveredPerAgent = {};
    const failedPerAgent = {};
    (deliveriesRes.data || []).forEach(d => {
      if (d.status === 'delivered') deliveredPerAgent[d.agent_id] = (deliveredPerAgent[d.agent_id] || 0) + 1;
      if (d.status === 'failed' || d.status === 'failed_delivery') failedPerAgent[d.agent_id] = (failedPerAgent[d.agent_id] || 0) + 1;
    });

    const tbody = document.getElementById('performance-body');
    const agents = agentsRes.data || [];
    if (!agents.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No agents found</td></tr>`;
      return;
    }

    tbody.innerHTML = agents.map(a => {
      const delivered = deliveredPerAgent[a.id] || 0;
      const failed = failedPerAgent[a.id] || 0;
      const convTotal = delivered + failed;
      const conv = convTotal > 0 ? ((delivered / convTotal) * 100).toFixed(1) + '%' : '—';
      return `<tr>
        <td><strong>${a.full_name}</strong></td>
        <td>${custPerAgent[a.id] || 0}</td>
        <td>${callsPerAgent[a.id] || 0}</td>
        <td>${ordersPerAgent[a.id] || 0}</td>
        <td>${delivered}</td>
        <td>${conv}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Performance load error:', err);
  }
}
