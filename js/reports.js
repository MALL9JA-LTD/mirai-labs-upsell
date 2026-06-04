let reportData = { productRows: [], tierRows: [], agentRows: [], outcomeRows: [], deliveryRows: [] };

(async () => {
  const profile = await requireAuth();
  if (!profile) return;

  const now = new Date();
  // Default: last 3 months so existing data always shows
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth()-2, 1);
  document.getElementById('date-from').value = threeMonthsAgo.toISOString().split('T')[0];
  document.getElementById('date-to').value = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];

  document.getElementById('btn-run').addEventListener('click', runReport);
  document.getElementById('btn-export-all').addEventListener('click', exportAll);
  await runReport();
})();

async function runReport() {
  const fromDate = document.getElementById('date-from').value;
  const toDate   = document.getElementById('date-to').value;
  if (!fromDate || !toDate) { showToast('Please select a date range','error'); return; }
  const btn = document.getElementById('btn-run');
  btn.disabled=true; btn.textContent='Loading…';

  try {
    const [deliveries, callLogs, customers, profiles, products, allStaff] = await Promise.all([
      // Fetch all deliveries — no date filter here, we filter in JS below
      fetchAll((from, to) =>
        window._supabase.from('deliveries')
          .select('id,status,sale_price,quantity,product_id,items,agent_id,delivery_staff_id,customer_id,created_at')
          .order('id').range(from, to)
      ),
      // Call logs filtered by date range
      fetchAll((from, to) =>
        window._supabase.from('call_logs')
          .select('id,agent_id,outcome,call_date,customer_id')
          .gte('call_date', fromDate)
          .lte('call_date', toDate+'T23:59:59')
          .order('id').range(from, to)
      ),
      fetchAll((from, to) =>
        window._supabase.from('customers').select('id,order_date').order('id').range(from, to)
      ),
      window._supabase.from('profiles').select('id,full_name,role').order('full_name'),
      window._supabase.from('products').select('id,name,cost_price').order('name'),
      window._supabase.from('delivery_staff').select('id,name').order('name'),
    ]);

    const profileMap = {};
    (profiles.data||[]).forEach(p => { profileMap[p.id] = p; });
    const prodLookup = {};
    (products.data||[]).forEach(p => { prodLookup[p.id] = p; });
    const staffLookup = {};
    (allStaff.data||[]).forEach(s => { staffLookup[s.id] = s; });

    // Filter deliveries by created_at date range
    const fromDt = new Date(fromDate+'T00:00:00');
    const toDt   = new Date(toDate+'T23:59:59');
    const inRange = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= fromDt && d <= toDt;
    };

    const periodDeliveries = deliveries.filter(d => inRange(d.created_at));
    const delivered = periodDeliveries.filter(d => d.status === 'delivered');
    const allOrders = periodDeliveries;
    const failed = periodDeliveries.filter(d => ['failed','failed_delivery'].includes(d.status));

    const totalRev = delivered.reduce((s,d) => s+Number(d.sale_price||0), 0);
    const totalOrders = delivered.length;
    const aov = totalOrders > 0 ? totalRev/totalOrders : 0;
    const rate = allOrders.length > 0 ? (delivered.length/allOrders.length*100).toFixed(1)+'%' : '—';

    document.getElementById('r-revenue').textContent = fmtMoney(totalRev);
    document.getElementById('r-orders').textContent = totalOrders;
    document.getElementById('r-aov').textContent = fmtMoney(aov);
    document.getElementById('r-rate').textContent = rate;

    // Revenue by Product
    const productMap = {};
    delivered.forEach(d => {
      const items = Array.isArray(d.items) && d.items.length > 0 ? d.items : [{ product_id: d.product_id, qty: d.quantity||1, sale_price: d.sale_price||0 }];
      items.forEach(it => {
        const prod = prodLookup[it.product_id] || prodLookup[d.product_id];
        const name = prod?.name || 'Unknown';
        if (!productMap[name]) productMap[name] = { units: 0, revenue: 0 };
        productMap[name].units += Number(it.qty||1);
        // sale_price on item is already the line total
        productMap[name].revenue += Number(it.sale_price||0) || Number(d.sale_price||0);
      });
    });
    const productRows = Object.entries(productMap).sort((a,b) => b[1].revenue-a[1].revenue);
    const maxProdRev = productRows.length > 0 ? productRows[0][1].revenue : 1;
    const productBars = document.getElementById('product-bars');
    if (productRows.length === 0) {
      productBars.innerHTML = '<div class="empty-state"><em>No data for this period.</em></div>';
    } else {
      productBars.innerHTML = productRows.map(([name, r]) =>
        `<div class="bar-row">
          <div class="bar-label">${name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${maxProdRev>0?r.revenue/maxProdRev*100:0}%"></div></div>
          <div class="bar-val">${fmtMoney(r.revenue)}</div>
        </div>`
      ).join('');
    }
    const prodTotalRev = productRows.reduce((s,[,r]) => s+r.revenue, 0);
    const prodBody = document.getElementById('product-table-body');
    if (productRows.length === 0) {
      prodBody.innerHTML = '<tr><td colspan="4" class="empty-state"><em>No records found.</em></td></tr>';
    } else {
      prodBody.innerHTML = productRows.map(([name, r]) =>
        `<tr><td>${name}</td><td>${r.units}</td><td class="cell-amount">${fmtMoney(r.revenue)}</td><td>${prodTotalRev>0?(r.revenue/prodTotalRev*100).toFixed(1)+'%':'—'}</td></tr>`
      ).join('');
    }
    reportData.productRows = productRows.map(([name,r]) => ({ product: name, units: r.units, revenue: r.revenue, pct: prodTotalRev>0?(r.revenue/prodTotalRev*100).toFixed(1)+'%':'—' }));

    // Revenue by Tier
    const custMap = {};
    customers.forEach(c => { custMap[c.id] = c; });
    const tierMap = { A:{orders:0,revenue:0,custTotal:0,custDelivered:new Set()}, B:{orders:0,revenue:0,custTotal:0,custDelivered:new Set()}, C:{orders:0,revenue:0,custTotal:0,custDelivered:new Set()} };
    customers.forEach(c => { const t = calcTier(c.order_date); if (tierMap[t]) tierMap[t].custTotal++; });
    delivered.forEach(d => {
      const cust = custMap[d.customer_id];
      if (!cust) return;
      const t = calcTier(cust.order_date);
      if (tierMap[t]) { tierMap[t].orders++; tierMap[t].revenue += Number(d.sale_price||0); tierMap[t].custDelivered.add(d.customer_id); }
    });
    const tierBody = document.getElementById('tier-table-body');
    tierBody.innerHTML = ['A','B','C'].map(t => {
      const r = tierMap[t];
      const conv = r.custTotal > 0 ? (r.custDelivered.size/r.custTotal*100).toFixed(1)+'%' : '—';
      return `<tr><td>${tierBadge(t)}</td><td>${r.orders}</td><td class="cell-amount">${fmtMoney(r.revenue)}</td><td>${conv}</td></tr>`;
    }).join('');
    reportData.tierRows = ['A','B','C'].map(t => {
      const r = tierMap[t];
      return { tier: t, orders: r.orders, revenue: r.revenue, conversion: r.custTotal>0?(r.custDelivered.size/r.custTotal*100).toFixed(1)+'%':'—' };
    });

    // Revenue by CRS Agent
    const agentRevMap = {};
    (profiles.data||[]).filter(p => ['crs_agent','temp_admin','supervisor'].includes(p.role)).forEach(p => { agentRevMap[p.id] = { name: p.full_name, calls: 0, orders: 0, revenue: 0 }; });
    callLogs.forEach(c => { if (agentRevMap[c.agent_id]) agentRevMap[c.agent_id].calls++; });
    delivered.forEach(d => { if (agentRevMap[d.agent_id]) { agentRevMap[d.agent_id].orders++; agentRevMap[d.agent_id].revenue += Number(d.sale_price||0); } });
    const agentRevRows = Object.values(agentRevMap).sort((a,b) => b.revenue-a.revenue);
    const agentBody = document.getElementById('agent-table-body');
    if (agentRevRows.length === 0) {
      agentBody.innerHTML = '<tr><td colspan="4" class="empty-state"><em>No records found.</em></td></tr>';
    } else {
      agentBody.innerHTML = agentRevRows.map(a => `<tr><td>${a.name}</td><td>${a.calls}</td><td>${a.orders}</td><td class="cell-amount">${fmtMoney(a.revenue)}</td></tr>`).join('');
    }
    reportData.agentRows = agentRevRows;

    // Call Outcomes
    const outcomeCounts = {};
    callLogs.forEach(c => { outcomeCounts[c.outcome] = (outcomeCounts[c.outcome]||0)+1; });
    const totalCallCount = callLogs.length;
    const outcomeRows = Object.entries(outcomeCounts).sort((a,b) => b[1]-a[1]);
    const maxOutcome = outcomeRows.length > 0 ? outcomeRows[0][1] : 1;
    const outcomeBars = document.getElementById('outcome-bars');
    if (outcomeRows.length === 0) {
      outcomeBars.innerHTML = '<div class="empty-state"><em>No calls in this period.</em></div>';
    } else {
      outcomeBars.innerHTML = outcomeRows.map(([outcome, count]) => {
        const barColors = { ordered:'#1D9E75', delivered:'#1D9E75', interested:'#D97B2A', declined:'#E24B4A', angry:'#E24B4A', answered:'#C9922A', no_answer:'#888070', callback_requested:'#D97B2A', wrong_number:'#888070' };
        const color = barColors[outcome] || '#888070';
        return `<div class="bar-row">
          <div style="width:180px;flex-shrink:0;">${statusBadge(outcome)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${maxOutcome>0?count/maxOutcome*100:0}%;background:${color};"></div></div>
          <div class="bar-val">${count} · ${totalCallCount>0?(count/totalCallCount*100).toFixed(1)+'%':'—'}</div>
        </div>`;
      }).join('');
    }
    reportData.outcomeRows = outcomeRows.map(([outcome,count]) => ({ outcome, count, pct: totalCallCount>0?(count/totalCallCount*100).toFixed(1)+'%':'—' }));

    // Delivery Performance by Staff
    const staffPerfMap = {};
    const staffSet = new Set(periodDeliveries.map(d => d.delivery_staff_id).filter(Boolean));
    staffSet.forEach(id => {
      staffPerfMap[id] = { name: staffLookup[id]?.name || id, delivered:0, failed:0, revenue:0 };
    });
    delivered.forEach(d => { if (staffPerfMap[d.delivery_staff_id]) { staffPerfMap[d.delivery_staff_id].delivered++; staffPerfMap[d.delivery_staff_id].revenue+=Number(d.sale_price||0); } });
    failed.forEach(d => { if (staffPerfMap[d.delivery_staff_id]) staffPerfMap[d.delivery_staff_id].failed++; });
    const deliveryPerfRows = Object.values(staffPerfMap).sort((a,b) => b.delivered-a.delivered);
    const deliveryBody = document.getElementById('delivery-perf-body');
    if (deliveryPerfRows.length === 0) {
      deliveryBody.innerHTML = '<tr><td colspan="5" class="empty-state"><em>No records found.</em></td></tr>';
    } else {
      deliveryBody.innerHTML = deliveryPerfRows.map(r => {
        const total = r.delivered + r.failed;
        const sr = total > 0 ? (r.delivered/total*100).toFixed(1)+'%' : '—';
        return `<tr><td>${r.name}</td><td>${r.delivered}</td><td>${r.failed}</td><td>${sr}</td><td class="cell-amount">${fmtMoney(r.revenue)}</td></tr>`;
      }).join('');
    }
    reportData.deliveryRows = deliveryPerfRows.map(r => { const total=r.delivered+r.failed; return { ...r, success_rate: total>0?(r.delivered/total*100).toFixed(1)+'%':'—' }; });

  } catch (err) {
    console.error('Report error:', err);
    showToast('Error: ' + (err?.message || JSON.stringify(err) || 'Unknown error'), 'error');
  } finally {
    btn.disabled=false; btn.textContent='Apply';
  }
}

function exportCSV(filename, rows, headers) {
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${r[h]??''}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

function exportSection(section) {
  const map = {
    product: { filename:'revenue-by-product.csv', rows: reportData.productRows, headers: ['product','units','revenue','pct'] },
    tier:    { filename:'revenue-by-tier.csv',    rows: reportData.tierRows,    headers: ['tier','orders','revenue','conversion'] },
    agent:   { filename:'revenue-by-agent.csv',   rows: reportData.agentRows,   headers: ['name','calls','orders','revenue'] },
    outcomes:{ filename:'call-outcomes.csv',      rows: reportData.outcomeRows, headers: ['outcome','count','pct'] },
    delivery:{ filename:'delivery-performance.csv',rows:reportData.deliveryRows,headers:['name','delivered','failed','success_rate','revenue'] },
  };
  const s = map[section];
  if (s) exportCSV(s.filename, s.rows, s.headers);
}

function exportAll() {
  ['product','tier','agent','outcomes','delivery'].forEach(s => exportSection(s));
}
