async function init() {
  const profile = await requireAuth();
  if (!profile) return;
  const isAdmin = profile?.role === 'admin';

  // Greeting
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.full_name?.split(' ')[0] || '';
  document.getElementById('dash-greeting').textContent = greet + (firstName ? ', ' + firstName : '');

  try {
    // Fetch all data in parallel
    const [deliveries, callLogs, customers, profiles, products, deliveryStaff] = await Promise.all([
      fetchAll((f, t) =>
        window._supabase.from('deliveries')
          .select('id,status,sale_price,delivery_fee,waybill_fee,quantity,product_id,items,agent_id,logged_by,customer_id,products(id,name,cost_price)')
          .order('id').range(f, t)
      ),
      fetchAll((f, t) =>
        window._supabase.from('call_logs')
          .select('id,customer_id,agent_id,outcome,call_date,channel,customers(full_name),profiles(full_name)')
          .order('call_date', { ascending: false }).order('id', { ascending: false }).range(f, t)
      ),
      fetchAll((f, t) =>
        window._supabase.from('customers').select('id,order_date').order('id').range(f, t)
      ),
      fetchAll((f, t) =>
        window._supabase.from('profiles').select('id,full_name,role').in('role', ['admin', 'crs_agent']).order('full_name').range(f, t)
      ),
      fetchAll((f, t) =>
        window._supabase.from('products').select('id,name,cost_price,selling_price').order('name').range(f, t)
      ),
      fetchAll((f, t) =>
        window._supabase.from('delivery_staff').select('id,active').order('id').range(f, t)
      ),
    ]);

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    const pending   = deliveries.filter(d => d.status === 'pending');
    const delivered = deliveries.filter(d => d.status === 'delivered');

    // KPI 1: Pipeline Revenue
    const pipeline = pending.reduce((s, d) => s + (Number(d.sale_price) || 0), 0);
    // KPI 2: Realized Revenue
    const revenue = delivered.reduce((s, d) => s + (Number(d.sale_price) || 0), 0);
    // KPI 3: Profit
    const profit = delivered.reduce((s, d) => {
      let cost = 0;
      const items = Array.isArray(d.items) && d.items.length > 0 ? d.items : null;
      if (items) {
        items.forEach(it => {
          const p = productMap[it.product_id];
          cost += (Number(p?.cost_price) || 0) * (Number(it.qty) || 1);
        });
      } else {
        const p = productMap[d.product_id];
        cost = (Number(p?.cost_price) || 0) * (Number(d.quantity) || 1);
      }
      return s + (Number(d.sale_price) || 0) - cost - (Number(d.delivery_fee) || 0) - (Number(d.waybill_fee) || 0);
    }, 0);
    // KPI 4: Active CRS agents
    const crsCount = profiles.filter(p => p.role === 'crs_agent').length;
    // KPI 5: Delivery staff count
    const dstaffCount = deliveryStaff.filter(s => s.active).length;
    // KPI 6: Total delivery fees
    const delFees = deliveries.reduce((s, d) => s + (Number(d.delivery_fee) || 0), 0);
    // KPI 7: Total waybill
    const waybill = deliveries.reduce((s, d) => s + (Number(d.waybill_fee) || 0), 0);
    // KPI 8: Total product cost (delivered only)
    const prodCost = delivered.reduce((s, d) => {
      const items = Array.isArray(d.items) && d.items.length > 0 ? d.items : null;
      if (items) {
        return s + items.reduce((ss, it) => {
          const p = productMap[it.product_id];
          return ss + (Number(p?.cost_price) || 0) * (Number(it.qty) || 1);
        }, 0);
      }
      const p = productMap[d.product_id];
      return s + (Number(p?.cost_price) || 0) * (Number(d.quantity) || 1);
    }, 0);

    // Render KPI cards
    setKpi('kpi-pipeline', fmtMoney(pipeline), 'Pipeline Revenue', 'Orders placed (awaiting delivery)', '📦');
    setKpi('kpi-revenue',  fmtMoney(revenue),  'Realized Revenue', 'Delivered & paid', '💰');
    if (isAdmin) {
      setKpi('kpi-profit', fmtMoney(profit), 'Profit', 'Sale − delivery fee − waybill − cost', '📈');
    } else {
      document.getElementById('kpi-profit').innerHTML = hiddenKpi('Profit (Admin Only)');
    }
    setKpi('kpi-agents',  crsCount,    'CRS Agents',     'Active', '📞');
    setKpi('kpi-dstaff',  dstaffCount, 'Delivery Staff', 'Active', '🚚');
    setKpi('kpi-delfees', fmtMoney(delFees), 'Total Delivery Fees', 'All courier fees, incl. failed deliveries', '🚛');
    setKpi('kpi-waybill', fmtMoney(waybill),  'Total Waybill Paid',  'Inter-state shipping out of Lagos', '📮');
    setKpi('kpi-productcost', fmtMoney(prodCost), 'Total Product Cost', 'Cost of goods sold (delivered only)', '🏭');

    // Customer Funnel
    const contactedSet = new Set(callLogs.map(c => c.customer_id));
    const orderedSet   = new Set(deliveries.map(d => d.customer_id));
    const deliveredSet = new Set(delivered.map(d => d.customer_id));
    const totalCust    = customers.length;
    const contactedCount  = customers.filter(c => contactedSet.has(c.id)).length;
    const orderedCount    = customers.filter(c => orderedSet.has(c.id)).length;
    const deliveredCount  = customers.filter(c => deliveredSet.has(c.id)).length;

    const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '0%';
    document.getElementById('funnel-total').textContent = totalCust;
    document.getElementById('funnel-contacted').textContent = contactedCount;
    document.getElementById('funnel-contacted-pct').textContent = pct(contactedCount, totalCust) + ' of total';
    document.getElementById('funnel-ordered').textContent = orderedCount;
    document.getElementById('funnel-ordered-pct').textContent = pct(orderedCount, contactedCount) + ' of contacted';
    document.getElementById('funnel-delivered').textContent = deliveredCount;
    document.getElementById('funnel-delivered-pct').textContent = pct(deliveredCount, orderedCount) + ' of ordered';

    // Row 3 KPIs
    const allOrdersCount = deliveries.length;
    const deliveredOrdersCount = delivered.length;
    setKpi('kpi-orders',    allOrdersCount,    'Total Orders',  'All delivery records', '🛒');
    setKpi('kpi-delivered', deliveredOrdersCount, 'Delivered', 'Confirmed deliveries', '✅');
    const delRate = allOrdersCount > 0 ? (deliveredOrdersCount / allOrdersCount * 100).toFixed(1) + '%' : '0%';
    setKpi('kpi-delrate', delRate, 'Delivery Rate', 'Delivered / Ordered', '📊');

    // Revenue by Product
    renderRevenueByProduct(delivered, productMap);
    // Revenue by Tier
    renderRevenueByTier(delivered, customers);
    // Top CRS Agents
    renderTopAgents(callLogs, delivered, profiles);
    // Recent Activity
    renderRecentActivity(callLogs);

  } catch (err) {
    console.error('Dashboard error:', err);
    showToast('Failed to load dashboard data', 'error');
  }
}

function setKpi(id, value, label, sub, icon) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div class="stat-label">${label}</div>
      <span style="font-size:18px;opacity:0.4;">${icon || ''}</span>
    </div>
    <div class="stat-value" style="margin:8px 0 4px;">${value}</div>
    <div style="font-size:11px;color:var(--ml-muted);">${sub || ''}</div>
  `;
}

function hiddenKpi(label) {
  return `<div class="stat-label">${label}</div>
    <div class="stat-value" style="filter:blur(8px);user-select:none;">₦██████</div>`;
}

function renderRevenueByProduct(delivered, productMap) {
  const el = document.getElementById('rev-by-product');
  if (!el) return;
  const map = {};
  delivered.forEach(d => {
    const items = Array.isArray(d.items) && d.items.length > 0 ? d.items : null;
    if (items) {
      items.forEach(it => {
        const p = productMap[it.product_id];
        const name = p ? p.name : 'Unknown';
        if (!map[name]) map[name] = { units: 0, revenue: 0 };
        map[name].units += Number(it.qty || 1);
        map[name].revenue += Number(it.sale_price || 0) * Number(it.qty || 1) || 0;
      });
    } else {
      const p = productMap[d.product_id];
      const name = p ? p.name : 'Unknown';
      if (!map[name]) map[name] = { units: 0, revenue: 0 };
      map[name].units += Number(d.quantity || 1);
      map[name].revenue += Number(d.sale_price || 0);
    }
  });
  const total = Object.values(map).reduce((s, v) => s + v.revenue, 0);
  const rows = Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  const rowsHtml = rows.length > 0
    ? rows.map(([name, v]) => `<tr>
        <td>${name}</td>
        <td>${v.units}</td>
        <td class="cell-amount">${fmtMoney(v.revenue)}</td>
        <td>${total > 0 ? (v.revenue / total * 100).toFixed(1) + '%' : '0%'}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--ml-muted);font-style:italic;padding:24px;">No delivered orders yet.</td></tr>`;
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>PRODUCT</th><th>UNITS</th><th>REVENUE</th><th>% OF TOTAL</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function renderRevenueByTier(delivered, customers) {
  const el = document.getElementById('rev-by-tier');
  if (!el) return;
  const custMap = {};
  customers.forEach(c => { custMap[c.id] = c; });
  const tiers = { A: { orders: 0, revenue: 0, custTotal: 0, custDelivered: new Set() },
                  B: { orders: 0, revenue: 0, custTotal: 0, custDelivered: new Set() },
                  C: { orders: 0, revenue: 0, custTotal: 0, custDelivered: new Set() } };
  customers.forEach(c => { const t = calcTier(c.order_date); if (tiers[t]) tiers[t].custTotal++; });
  delivered.forEach(d => {
    const c = custMap[d.customer_id];
    if (!c) return;
    const t = calcTier(c.order_date);
    if (tiers[t]) {
      tiers[t].orders++;
      tiers[t].revenue += Number(d.sale_price || 0);
      tiers[t].custDelivered.add(d.customer_id);
    }
  });
  const rowsHtml = ['A', 'B', 'C'].map(t => {
    const r = tiers[t];
    const conv = r.custTotal > 0 ? (r.custDelivered.size / r.custTotal * 100).toFixed(1) + '%' : '—';
    return `<tr><td>${tierBadge(t)}</td><td>${r.orders}</td><td class="cell-amount">${fmtMoney(r.revenue)}</td><td>${conv}</td></tr>`;
  }).join('');
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>TIER</th><th>ORDERS</th><th>REVENUE</th><th>CONVERSION</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function renderTopAgents(callLogs, delivered, profiles) {
  const el = document.getElementById('top-agents');
  if (!el) return;
  const agentMap = {};
  profiles.filter(p => p.role === 'crs_agent').forEach(p => {
    agentMap[p.id] = { name: p.full_name || p.id, calls: 0, orders: 0, revenue: 0 };
  });
  callLogs.forEach(c => { if (agentMap[c.agent_id]) agentMap[c.agent_id].calls++; });
  delivered.forEach(d => {
    const aid = d.agent_id || d.logged_by;
    if (agentMap[aid]) {
      agentMap[aid].orders++;
      agentMap[aid].revenue += Number(d.sale_price || 0);
    }
  });
  const sorted = Object.values(agentMap).sort((a, b) => b.revenue - a.revenue || b.calls - a.calls);
  const rowsHtml = sorted.length > 0
    ? sorted.map(a => `<tr>
        <td><span style="color:var(--ml-gold);">${a.name}</span></td>
        <td>${a.calls}</td>
        <td>${a.orders}</td>
        <td class="cell-amount">${fmtMoney(a.revenue)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:var(--ml-muted);font-style:italic;padding:24px;">No agent activity yet.</td></tr>`;
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>AGENT</th><th>CALLS</th><th>ORDERS</th><th>REVENUE</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function renderRecentActivity(callLogs) {
  const el = document.getElementById('recent-activity');
  if (!el) return;
  const recent = callLogs.slice(0, 20);
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state"><em>No activity yet.</em></div>`;
    return;
  }
  const outcomeColor = {
    answered: '#5DCAA5', ordered: '#E8B84B', interested: '#EF9F27',
    declined: '#F09595', angry: '#F09595', no_answer: '#888070',
    callback_requested: '#888070', wrong_number: '#888070'
  };
  el.innerHTML = recent.map(c => {
    const color = outcomeColor[c.outcome] || '#888070';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:0.5px solid var(--ml-border);">
      <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
      <div style="flex:1;">
        <span style="color:var(--ml-white);font-weight:400;">${c.customers?.full_name || '—'}</span>
        <span style="color:var(--ml-muted);"> — </span>
        <span style="color:${color};">${statusLabel(c.outcome)}</span>
        <div style="font-size:11px;color:var(--ml-muted);margin-top:2px;">by ${c.profiles?.full_name || '—'} · ${fmtDate(c.call_date)}</div>
      </div>
    </div>`;
  }).join('');
}

init();
