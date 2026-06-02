(async () => {
  const profile = await requireAuth();
  if (!profile) return;

  // Default date range: current month
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  document.getElementById('date-from').value = firstDay;
  document.getElementById('date-to').value   = lastDay;

  document.getElementById('btn-run-report').addEventListener('click', runReport);

  // Auto-run on load
  await runReport();
})();

async function runReport() {
  const fromDate = document.getElementById('date-from').value;
  const toDate   = document.getElementById('date-to').value;

  if (!fromDate || !toDate) { showToast('Please select a date range', 'error'); return; }
  if (fromDate > toDate)    { showToast('From date must be before To date', 'error'); return; }

  const btn = document.getElementById('btn-run-report');
  btn.disabled = true; btn.textContent = 'Loading…';

  try {
    // Fetch all deliveries in range with product cost data
    const deliveries = await fetchAll((from, to) =>
      window._supabase
        .from('deliveries')
        .select(`id, status, quantity, sale_price, cost_price, created_at,
          agent_id, customer_id,
          products(id, name, cost_price, selling_price),
          profiles!deliveries_agent_id_fkey(id, full_name)`)
        .gte('created_at', fromDate + 'T00:00:00')
        .lte('created_at', toDate   + 'T23:59:59')
        .order('id')
        .range(from, to)
    );

    const delivered = deliveries.filter(d => d.status === 'delivered');
    const failed    = deliveries.filter(d => d.status === 'failed' || d.status === 'failed_delivery');

    // Summary KPIs
    const totalRevenue = delivered.reduce((s, d) => s + Number(d.sale_price || 0), 0);
    const totalCost    = delivered.reduce((s, d) => s + Number(d.cost_price || 0), 0);
    const grossProfit  = totalRevenue - totalCost;
    const margin       = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) + '%' : '—';
    const convTotal    = delivered.length + failed.length;
    const convRate     = convTotal > 0 ? ((delivered.length / convTotal) * 100).toFixed(1) + '%' : '—';

    document.getElementById('r-revenue').textContent    = fmtMoney(totalRevenue);
    document.getElementById('r-cost').textContent       = fmtMoney(totalCost);
    document.getElementById('r-profit').textContent     = fmtMoney(grossProfit);
    document.getElementById('r-margin').textContent     = margin;
    document.getElementById('r-deliveries').textContent = delivered.length;
    document.getElementById('r-conversion').textContent = convRate;

    // Per-agent breakdown
    const agentMap = {};
    deliveries.forEach(d => {
      const agentId   = d.agent_id;
      const agentName = d.profiles?.full_name || 'Unknown';
      if (!agentMap[agentId]) {
        agentMap[agentId] = { name: agentName, orders: 0, delivered: 0, failed: 0, revenue: 0, profit: 0 };
      }
      agentMap[agentId].orders++;
      if (d.status === 'delivered') {
        agentMap[agentId].delivered++;
        agentMap[agentId].revenue += Number(d.sale_price || 0);
        agentMap[agentId].profit  += Number(d.sale_price || 0) - Number(d.cost_price || 0);
      }
      if (d.status === 'failed' || d.status === 'failed_delivery') {
        agentMap[agentId].failed++;
      }
    });

    const agentBody = document.getElementById('agent-breakdown-body');
    const agentRows = Object.values(agentMap).sort((a, b) => b.revenue - a.revenue);
    if (agentRows.length === 0) {
      agentBody.innerHTML = `<tr><td colspan="6" class="empty-state">No data for this period</td></tr>`;
    } else {
      agentBody.innerHTML = agentRows.map(a => `
        <tr>
          <td><strong>${a.name}</strong></td>
          <td>${a.orders}</td>
          <td>${a.delivered}</td>
          <td>${a.failed}</td>
          <td>${fmtMoney(a.revenue)}</td>
          <td>${fmtMoney(a.profit)}</td>
        </tr>
      `).join('');
    }

    // Per-product breakdown (delivered only)
    const productMap = {};
    delivered.forEach(d => {
      const pid  = d.products?.id || 'unknown';
      const name = d.products?.name || 'Unknown';
      if (!productMap[pid]) {
        productMap[pid] = { name, units: 0, revenue: 0, cost: 0 };
      }
      productMap[pid].units   += Number(d.quantity || 1);
      productMap[pid].revenue += Number(d.sale_price || 0);
      productMap[pid].cost    += Number(d.cost_price || 0);
    });

    const productBody = document.getElementById('product-breakdown-body');
    const productRows = Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
    if (productRows.length === 0) {
      productBody.innerHTML = `<tr><td colspan="5" class="empty-state">No delivered orders in this period</td></tr>`;
    } else {
      productBody.innerHTML = productRows.map(p => {
        const profit = p.revenue - p.cost;
        return `<tr>
          <td><strong>${p.name}</strong></td>
          <td>${p.units}</td>
          <td>${fmtMoney(p.revenue)}</td>
          <td>${fmtMoney(p.cost)}</td>
          <td>${fmtMoney(profit)}</td>
        </tr>`;
      }).join('');
    }

  } catch (err) {
    console.error(err);
    showToast('Failed to load report data', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Run Report';
  }
}
