let allLeads = [], filteredLeads = [];
let activeStatus = '';
let currentPage = 1;
const PAGE_SIZE = 50;
let isAdmin = false;
let leadRows = [];

const UPSELL_STATUS_LABELS = {
  new:            'New',
  called:         'Called — no order',
  interested:     'Interested',
  ordered:        'Ordered',
  not_interested: 'Not interested',
};

const UPSELL_STATUS_BADGE = {
  new:            'badge-neutral',
  called:         'badge-neutral',
  interested:     'badge-amber',
  ordered:        'badge-success',
  not_interested: 'badge-danger',
};

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  isAdmin = ['admin','temp_admin','supervisor'].includes(profile.role);

  // Import is admin-only
  if (!isAdmin) document.getElementById('header-actions').style.display = 'none';

  bindEvents();
  await loadLeads();
})();

async function loadLeads() {
  document.getElementById('leads-body').innerHTML =
    `<tr class="loading-row"><td colspan="9"><span class="spinner"></span></td></tr>`;
  try {
    allLeads = await fetchAll((from, to) =>
      window._supabase
        .from('upsell_leads')
        .select('id,customer_name,phone,location,order_date,product,quantity,sales_price,delivery_date,upsell_status,upsell_notes,last_called_at,called_by,source_sheet,profiles:called_by(full_name)')
        .order('created_at', { ascending: false })
        .range(from, to)
    );
    applyFilters();
  } catch (err) {
    console.error(err);
    const msg = err?.message || 'Unknown error';
    showToast('Failed to load leads: ' + msg, 'error');
    document.getElementById('leads-body').innerHTML =
      `<tr><td colspan="9" class="empty-state" style="color:#E24B4A;">${msg}</td></tr>`;
  }
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();
  filteredLeads = allLeads.filter(l => {
    const matchStatus = !activeStatus || (l.upsell_status || 'new') === activeStatus;
    const matchSearch = !search ||
      (l.customer_name || '').toLowerCase().includes(search) ||
      (l.phone || '').includes(search) ||
      (l.product || '').toLowerCase().includes(search);
    return matchStatus && matchSearch;
  });
  currentPage = 1;
  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById('leads-body');
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredLeads.slice(start, start + PAGE_SIZE);
  document.getElementById('row-count').textContent = `${filteredLeads.length} lead(s)`;

  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><span class="empty-icon">★</span>No delivered leads yet. Use “Import Delivered” to add them.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows.map(l => {
    const status = l.upsell_status || 'new';
    const badgeCls = UPSELL_STATUS_BADGE[status] || 'badge-neutral';
    const badge = `<span class="badge ${badgeCls}">${UPSELL_STATUS_LABELS[status] || status}</span>`;
    const lastCalled = l.last_called_at
      ? `${fmtDate(l.last_called_at)}${l.profiles?.full_name ? ` · ${l.profiles.full_name}` : ''}`
      : '—';
    return `<tr>
      <td><strong>${l.customer_name || '—'}</strong></td>
      <td>${l.phone || '—'}</td>
      <td>${l.location || '—'}</td>
      <td>${l.product || '—'}</td>
      <td>${fmtDate(l.order_date)}</td>
      <td>${fmtMoney(l.sales_price)}</td>
      <td>${badge}</td>
      <td style="font-size:12px;color:var(--ml-muted);">${lastCalled}</td>
      <td><button class="btn-primary btn-sm" onclick="openUpdateLead('${l.id}')">Log Call</button></td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const total = filteredLeads.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = ''; return; }
  let html = `<span class="page-info">${Math.min((currentPage-1)*PAGE_SIZE+1,total)}–${Math.min(currentPage*PAGE_SIZE,total)} of ${total}</span>`;
  html += `<button class="btn-secondary btn-sm" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== pages) {
      if (i === 2 || i === pages - 1) html += `<span style="padding:0 4px">…</span>`;
      continue;
    }
    html += `<button class="btn-sm ${i===currentPage?'btn-primary':'btn-secondary'}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="btn-secondary btn-sm" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

function goPage(p) {
  const pages = Math.ceil(filteredLeads.length / PAGE_SIZE);
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
  renderPagination();
}

function openUpdateLead(id) {
  const l = allLeads.find(x => x.id === id);
  if (!l) return;
  document.getElementById('update-lead-id').value = id;
  document.getElementById('update-lead-name').textContent = `${l.customer_name || '—'} · ${l.phone || ''}`;
  document.getElementById('update-lead-status').value = l.upsell_status || 'new';
  document.getElementById('update-lead-notes').value = l.upsell_notes || '';
  openModal('modal-update-lead');
}

async function saveLead() {
  const id = document.getElementById('update-lead-id').value;
  const status = document.getElementById('update-lead-status').value;
  const notes = document.getElementById('update-lead-notes').value.trim();
  const btn = document.getElementById('save-lead-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const payload = {
    upsell_status: status,
    upsell_notes: notes || null,
    last_called_at: new Date().toISOString(),
    called_by: window._profile.id,
  };
  const { data, error } = await window._supabase
    .from('upsell_leads').update(payload).eq('id', id).select('*,profiles:called_by(full_name)');

  btn.disabled = false; btn.textContent = 'Save';
  if (error) { showToast(error.message, 'error'); return; }
  if (!data || data.length === 0) { showToast('Update blocked — check permissions (RLS)', 'error'); return; }

  const idx = allLeads.findIndex(x => x.id === id);
  if (idx !== -1) allLeads[idx] = { ...allLeads[idx], ...data[0] };
  showToast('Call logged');
  closeModal('modal-update-lead');
  applyFilters();
}

/* ---------- CSV import ---------- */

function parseCsvLine(line) {
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

function toIsoDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d)) return null;
  // Use local calendar parts (not toISOString, which shifts by the UTC offset)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toNumber(str) {
  if (!str) return null;
  const n = Number(String(str).replace(/[₦,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function parseLeadsCsv(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g, '').trim());
  const idx = name => headers.indexOf(name);
  const iName = idx('customer_name'), iPhone = idx('phone_number'), iStatus = idx('order_status');
  if (iName === -1 || iPhone === -1 || iStatus === -1) {
    throw new Error('Expected columns Customer_Name, Phone_number and Order_Status were not found');
  }
  const get = (vals, name) => { const i = idx(name); return i === -1 ? '' : (vals[i] || '').replace(/^"|"$/g, '').trim(); };

  const rows = [];
  for (const line of lines.slice(1)) {
    const vals = parseCsvLine(line).map(v => v.replace(/^"|"$/g, '').trim());
    const status = get(vals, 'order_status');
    if (status.toLowerCase() !== 'delivered') continue;   // only delivered rows
    const phone = get(vals, 'phone_number');
    const name = get(vals, 'customer_name');
    if (!name || !phone) continue;
    rows.push({
      customer_name: name,
      phone,
      location:      get(vals, 'location'),
      order_date:    toIsoDate(get(vals, 'order_date')),
      product:       get(vals, 'product'),
      quantity:      parseInt(get(vals, 'quantity'), 10) || null,
      sales_price:   toNumber(get(vals, 'sales_price')),
      delivery_fee:  toNumber(get(vals, 'delivery_fee')),
      delivery_date: toIsoDate(get(vals, 'delivery_date')),
      order_status:  status,
    });
  }
  return rows;
}

function handleLeadsCsvFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      leadRows = parseLeadsCsv(ev.target.result);
      document.getElementById('leads-csv-preview').textContent =
        `Found ${leadRows.length} delivered row(s) ready to import.`;
      document.getElementById('leads-csv-error').textContent = '';
      document.getElementById('import-leads-btn').disabled = leadRows.length === 0;
    } catch (err) {
      document.getElementById('leads-csv-error').textContent = 'Error: ' + err.message;
      document.getElementById('leads-csv-preview').textContent = '';
      document.getElementById('import-leads-btn').disabled = true;
    }
  };
  reader.readAsText(file);
}

async function importLeads() {
  if (!leadRows.length) return;
  const sheet = document.getElementById('import-source-sheet').value.trim() || null;
  const btn = document.getElementById('import-leads-btn');
  btn.disabled = true; btn.textContent = 'Importing…';

  const records = leadRows.map(r => ({ ...r, source_sheet: sheet }));
  const CHUNK = 200;
  let hasError = false;
  for (let i = 0; i < records.length; i += CHUNK) {
    const { error } = await window._supabase
      .from('upsell_leads')
      .upsert(records.slice(i, i + CHUNK), { onConflict: 'phone', ignoreDuplicates: false });
    if (error) { showToast(error.message, 'error'); hasError = true; break; }
  }

  btn.disabled = false; btn.textContent = 'Import';
  if (hasError) return;
  showToast(`${records.length} delivered leads imported`);
  document.getElementById('leads-csv-file').value = '';
  document.getElementById('leads-csv-preview').textContent = '';
  leadRows = [];
  closeModal('modal-import-leads');
  await loadLeads();
}

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.querySelectorAll('.tab-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatus = btn.dataset.status;
      applyFilters();
    });
  });
  document.getElementById('save-lead-btn').addEventListener('click', saveLead);

  if (isAdmin) {
    document.getElementById('btn-import-leads').addEventListener('click', () => openModal('modal-import-leads'));
    document.getElementById('leads-csv-file').addEventListener('change', handleLeadsCsvFile);
    document.getElementById('import-leads-btn').addEventListener('click', importLeads);
  }
}
