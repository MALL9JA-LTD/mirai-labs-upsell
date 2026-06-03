let allOrders = [];
let filteredOrders = [];
let activeStatus = '';
let currentPage = 1;
const PAGE_SIZE = 50;

(async () => {
  const profile = await requireAuth();
  if (!profile) return;

  if (!['admin','temp_admin','supervisor'].includes(profile.role)) {
    document.querySelector('.main-content').innerHTML =
      `<div class="empty-state" style="padding:60px;"><span class="empty-icon">🔒</span>Admin access only</div>`;
    return;
  }

  bindEvents();
  await loadOrders();
})();

async function loadOrders() {
  document.getElementById('website-orders-body').innerHTML =
    `<tr class="loading-row"><td colspan="8"><span class="spinner"></span></td></tr>`;

  try {
    allOrders = await fetchAll((from, to) =>
      window._supabase
        .from('deliveries')
        .select(`id, status, quantity, sale_price, delivery_date, created_at, logged_by,
          customers(full_name, phone),
          products(name)`)
        .is('logged_by', null)
        .order('id', { ascending: false })
        .range(from, to)
    );

    applyFilters();
  } catch (err) {
    console.error(err);
    showToast('Failed to load website orders', 'error');
    document.getElementById('website-orders-body').innerHTML =
      `<tr><td colspan="8" class="empty-state">Error loading orders</td></tr>`;
  }
}

function applyFilters() {
  const search = document.getElementById('search-input').value.toLowerCase();

  filteredOrders = allOrders.filter(d => {
    const matchStatus = !activeStatus || d.status === activeStatus ||
      (activeStatus === 'failed' && (d.status === 'failed' || d.status === 'failed_delivery'));
    const matchSearch = !search ||
      (d.customers?.full_name || '').toLowerCase().includes(search) ||
      (d.customers?.phone || '').includes(search) ||
      (d.products?.name || '').toLowerCase().includes(search);
    return matchStatus && matchSearch;
  });

  currentPage = 1;
  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById('website-orders-body');
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredOrders.slice(start, start + PAGE_SIZE);

  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><span class="empty-icon">🛒</span>No website orders found</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows.map(d => {
    const isPending = d.status === 'pending';
    const actions = isPending ? `
      <button class="btn btn-success btn-sm" onclick="updateStatus('${d.id}','delivered')">✓ Delivered</button>
      <button class="btn btn-warning btn-sm" style="margin-top:4px;" onclick="updateStatus('${d.id}','failed')">✗ Failed</button>
      <button class="btn btn-secondary btn-sm" style="margin-top:4px;" onclick="updateStatus('${d.id}','returned')">↩ Returned</button>
    ` : '—';

    return `<tr>
      <td><strong>${d.customers?.full_name || '—'}</strong></td>
      <td>${d.customers?.phone || '—'}</td>
      <td>${d.products?.name || '—'}</td>
      <td>${d.quantity || 1}</td>
      <td>${fmtMoney(d.sale_price)}</td>
      <td>${statusBadge(d.status)}</td>
      <td>${fmtDate(d.delivery_date || d.created_at)}</td>
      <td style="min-width:130px;">${actions}</td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const total = filteredOrders.length;
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
  const pages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
  renderPagination();
}

async function updateStatus(id, status) {
  const label = { delivered: 'Mark as Delivered', failed: 'Mark as Failed', returned: 'Mark as Returned' }[status];
  if (!confirm(`${label}?`)) return;

  const updateData = { status };
  if (status === 'delivered') updateData.delivery_date = new Date().toISOString();

  const { data, error } = await window._supabase
    .from('deliveries')
    .update(updateData)
    .eq('id', id)
    .select();

  if (error) { showToast(error.message, 'error'); return; }
  if (!data || data.length === 0) { showToast('Update failed — RLS may have blocked it', 'error'); return; }

  showToast(`Order marked as ${status}`);
  const idx = allOrders.findIndex(d => d.id === id);
  if (idx !== -1) allOrders[idx] = { ...allOrders[idx], ...data[0] };
  applyFilters();
}

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', applyFilters);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatus = btn.dataset.status;
      applyFilters();
    });
  });
}
