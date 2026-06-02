(async () => {
  const profile = await requireAuth();
  if (!profile) return;

  const isAdmin = profile.role === 'admin';
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  try {
    // --- Fetch all deliveries ---
    const deliveries = await fetchAll((from, to) =>
      window._supabase
        .from('deliveries')
        .select('id, status, sale_price, cost_price, created_at, customer_id, customers(full_name), products(name)')
        .order('id')
        .range(from, to)
    );

    // KPI: Total Pending Value
    const pending = deliveries.filter(d => d.status === 'pending');
    const pendingValue = pending.reduce((s, d) => s + Number(d.sale_price || 0), 0);
    document.getElementById('kpi-pending').textContent = fmtMoney(pendingValue);

    // KPI: Revenue This Month (delivered)
    const deliveredMonth = deliveries.filter(d =>
      d.status === 'delivered' &&
      d.created_at >= monthStart && d.created_at <= monthEnd
    );
    const revenueMonth = deliveredMonth.reduce((s, d) => s + Number(d.sale_price || 0), 0);
    document.getElementById('kpi-revenue').textContent = fmtMoney(revenueMonth);

    // KPI: Profit This Month
    const profitMonth = deliveredMonth.reduce((s, d) =>
      s + Number(d.sale_price || 0) - Number(d.cost_price || 0), 0);
    document.getElementById('kpi-profit').textContent = fmtMoney(profitMonth);

    // KPI: Conversion Rate
    const failedMonth = deliveries.filter(d =>
      (d.status === 'failed' || d.status === 'failed_delivery') &&
      d.created_at >= monthStart && d.created_at <= monthEnd
    );
    const total = deliveredMonth.length + failedMonth.length;
    const rate = total > 0 ? ((deliveredMonth.length / total) * 100).toFixed(1) : '—';
    document.getElementById('kpi-conversion').textContent = rate !== '—' ? rate + '%' : '—';

    // --- Recent Deliveries (last 20) ---
    const recentDeliveries = deliveries.slice(-20).reverse();
    const delivBody = document.getElementById('recent-deliveries-body');
    if (recentDeliveries.length === 0) {
      delivBody.innerHTML = `<tr><td colspan="4" class="empty-state"><span class="empty-icon">📦</span>No deliveries yet</td></tr>`;
    } else {
      delivBody.innerHTML = recentDeliveries.map(d => `
        <tr>
          <td>${d.customers?.full_name || '—'}</td>
          <td>${d.products?.name || '—'}</td>
          <td>${fmtMoney(d.sale_price)}</td>
          <td>${statusBadge(d.status)}</td>
        </tr>
      `).join('');
    }

  } catch (err) {
    console.error('Dashboard KPI error:', err);
    showToast('Failed to load KPI data', 'error');
  }

  // --- Recent Calls (last 20) ---
  try {
    const { data: calls, error } = await window._supabase
      .from('call_logs')
      .select('id, outcome, call_date, notes, customers(full_name), profiles(full_name)')
      .order('call_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(20);

    if (error) throw error;

    const callsBody = document.getElementById('recent-calls-body');
    if (!calls || calls.length === 0) {
      callsBody.innerHTML = `<tr><td colspan="4" class="empty-state"><span class="empty-icon">📞</span>No calls logged yet</td></tr>`;
    } else {
      callsBody.innerHTML = calls.map(c => `
        <tr>
          <td>${c.customers?.full_name || '—'}</td>
          <td>${c.profiles?.full_name || '—'}</td>
          <td>${statusBadge(c.outcome)}</td>
          <td>${fmtDate(c.call_date)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Recent calls error:', err);
    document.getElementById('recent-calls-body').innerHTML =
      `<tr><td colspan="4" class="empty-state">Failed to load calls</td></tr>`;
  }
})();
