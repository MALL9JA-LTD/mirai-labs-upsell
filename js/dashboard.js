(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  const isAdmin = profile.role === 'admin';

  if (!isAdmin) {
    document.getElementById('kpi-profit-card').style.display = 'none';
  } else {
    document.getElementById('kpi-row2').style.display = '';
  }

  try {
    const [deliveries, callLogs, customers, profiles, deliveryStaff, products] = await Promise.all([
      fetchAll((from, to) =>
        window._supabase.from('deliveries')
          .select('id,status,sale_price,delivery_fee,waybill_fee,customer_id,agent_id,items,product_id,quantity,delivery_staff_id,delivery_date,created_at')
          .order('id').range(from, to)
      ),
      fetchAll((from, to) =>
        window._supabase.from('call_logs')
          .select('id,customer_id,agent_id,outcome,call_date,channel,customers(full_name),profiles(full_name)')
          .order('call_date',{ascending:false}).order('id',{ascending:false}).range(from, to)
      ),
      fetchAll((from, to) =>
        window._supabase.from('customers')
          .select('id,order_date,assigned_to').order('id').range(from, to)
      ),
      fetchAll((from, to) =>
        window._supabase.from('profiles')
          .select('id,full_name,role').in('role',['admin','crs_agent']).order('full_name').range(from, to)
      ),
      fetchAll((from, to) =>
        window._supabase.from('delivery_staff')
          .select('id,active').order('id').range(from, to)
      ),
      fetchAll((from, to) =>
        window._supabase.from('products')
          .select('id,name,cost_price').order('name').range(from, to)
      ),
    ]);

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    const pending   = deliveries.filter(d => d.status === 'pending');
    const delivered = deliveries.filter(d => d.status === 'delivered');

    // KPI Row 1
    const pipeline = pending.reduce((s, d) => s + Number(d.sale_price || 0), 0);
    const realized = delivered.reduce((s, d) => s + Number(d.sale_price || 0), 0);
    document.getElementById('kpi-pipeline').textContent = fmtMoney(pipeline);
    document.getElementById('kpi-realized').textContent = fmtMoney(realized);

    if (isAdmin) {
      const totalFees = deliveries.reduce((s, d) => s + Number(d.delivery_fee || 0), 0);
      const totalWaybill = deliveries.reduce((s, d) => s + Number(d.waybill_fee || 0), 0);
      let totalCost = 0;
      delivered.forEach(d => {
        const items = Array.isArray(d.items) ? d.items : [];
        if (items.length > 0) {
          items.forEach(it => {
            const p = productMap[it.product_id];
            if (p) totalCost += Number(p.cost_price || 0) * Number(it.qty || 1);
          });
        } else {
          const p = productMap[d.product_id];
          if (p) totalCost += Number(p.cost_price || 0) * Number(d.quantity || 1);
        }
      });
      const profit = realized - totalFees - totalWaybill - totalCost;
      document.getElementById('kpi-profit').textContent = fmtMoney(profit);
      document.getElementById('kpi-delfees').textContent = fmtMoney(totalFees);
      document.getElementById('kpi-waybill').textContent = fmtMoney(totalWaybill);
      document.getElementById('kpi-prodcost').textContent = fmtMoney(totalCost);
    } else {
      document.getElementById('kpi-profit').textContent = '—';
    }

    const crsCount = profiles.filter(p => p.role === 'crs_agent').length;
    const activeStaff = deliveryStaff.filter(s => s.active).length;
    document.getElementById('kpi-crs').textContent = crsCount;
    document.getElementById('kpi-dstaff').textContent = activeStaff;

    // Customer Funnel
    const custWithCalls = new Set(callLogs.map(c => c.customer_id));
    const custWithOrders = new Set(deliveries.map(d => d.customer_id));
    const custDelivered = new Set(delivered.map(d => d.customer_id));
    const totalCust = customers.length;
    const contactedCount = customers.filter(c => custWithCalls.has(c.id)).length;
    const orderedCount = customers.filter(c => custWithOrders.has(c.id)).length;
    const deliveredCount = customers.filter(c => custDelivered.has(c.id)).length;

    document.getElementById('funnel-total').textContent = totalCust;
    document.getElementById('funnel-contacted').textContent = contactedCount;
    document.getElementById('funnel-contacted-pct').textContent = totalCust ? ((contactedCount/totalCust*100).toFixed(1)+'% of total') : '';
    document.getElementById('funnel-ordered').textContent = orderedCount;
    document.getElementById('funnel-ordered-pct').textContent = contactedCount ? ((orderedCount/contactedCount*100).toFixed(1)+'% of contacted') : '';
    document.getElementById('funnel-delivered').textContent = deliveredCount;
    document.getElementById('funnel-delivered-pct').textContent = orderedCount ? ((deliveredCount/orderedCount*100).toFixed(1)+'% of ordered') : '';

    // KPI Row 3
    document.getElementById('kpi-total-orders').textContent = deliveries.length;
    document.getElementById('kpi-delivered-count').textContent = delivered.length;
    const delRate = deliveries.length > 0 ? (delivered.length/deliveries.length*100).toFixed(1)+'%' : '—';
    document.getElementById('kpi-del-rate').textContent = delRate;

    // Revenue by Product
    const revByProduct = {};
    delivered.forEach(d => {
      const items = Array.isArray(d.items) ? d.items : [];
      if (items.length > 0) {
        items.forEach(it => {
          const p = productMap[it.product_id];
          const name = p ? p.name : 'Unknown';
          if (!revByProduct[name]) revByProduct[name] = { units: 0, revenue: 0 };
          revByProduct[name].units += Number(it.qty || 1);
          revByProduct[name].revenue += Number(it.sale_price || 0) * Number(it.qty || 1);
        });
      } else {
        const p = productMap[d.product_id];
        const name = p ? p.name : 'Unknown';
        if (!revByProduct[name]) revByProduct[name] = { units: 0, revenue: 0 };
        revByProduct[name].units += Number(d.quantity || 1);
        revByProduct[name].revenue += Number(d.sale_price || 0);
      }
    });
    const totalRevForPct = Object.values(revByProduct).reduce((s,r) => s + r.revenue, 0);
    const productRows = Object.entries(revByProduct).sort((a,b) => b[1].revenue - a[1].revenue);
    const revProductBody = document.getElementById('rev-product-body');
    if (productRows.length === 0) {
      revProductBody.innerHTML = '<tr><td colspan="4" class="empty-state"><em>No delivered orders yet.</em></td></tr>';
    } else {
      revProductBody.innerHTML = productRows.map(([name, r]) =>
        `<tr><td>${name}</td><td>${r.units}</td><td class="cell-amount">${fmtMoney(r.revenue)}</td><td>${totalRevForPct > 0 ? (r.revenue/totalRevForPct*100).toFixed(1)+'%' : '—'}</td></tr>`
      ).join('');
    }

    // Revenue by Tier
    const tierMap = { A: { orders: 0, revenue: 0, custTotal: 0, custDelivered: 0 },
                      B: { orders: 0, revenue: 0, custTotal: 0, custDelivered: 0 },
                      C: { orders: 0, revenue: 0, custTotal: 0, custDelivered: 0 } };
    customers.forEach(c => {
      const tier = calcTier(c.order_date);
      if (tierMap[tier]) tierMap[tier].custTotal++;
    });
    delivered.forEach(d => {
      const cust = customers.find(c => c.id === d.customer_id);
      if (!cust) return;
      const tier = calcTier(cust.order_date);
      if (tierMap[tier]) {
        tierMap[tier].orders++;
        tierMap[tier].revenue += Number(d.sale_price || 0);
      }
    });
    customers.filter(c => custDelivered.has(c.id)).forEach(c => {
      const tier = calcTier(c.order_date);
      if (tierMap[tier]) tierMap[tier].custDelivered++;
    });
    const revTierBody = document.getElementById('rev-tier-body');
    revTierBody.innerHTML = ['A','B','C'].map(tier => {
      const t = tierMap[tier];
      const conv = t.custTotal > 0 ? (t.custDelivered/t.custTotal*100).toFixed(1)+'%' : '—';
      return `<tr><td>${tierBadge(tier)}</td><td>${t.orders}</td><td class="cell-amount">${fmtMoney(t.revenue)}</td><td>${conv}</td></tr>`;
    }).join('');

    // Top CRS Agents
    const agentPerfMap = {};
    profiles.filter(p => p.role === 'crs_agent').forEach(p => {
      agentPerfMap[p.id] = { name: p.full_name, calls: 0, orders: 0, revenue: 0 };
    });
    callLogs.forEach(c => {
      if (agentPerfMap[c.agent_id]) agentPerfMap[c.agent_id].calls++;
    });
    delivered.forEach(d => {
      if (agentPerfMap[d.agent_id]) {
        agentPerfMap[d.agent_id].orders++;
        agentPerfMap[d.agent_id].revenue += Number(d.sale_price || 0);
      }
    });
    const agentRows = Object.values(agentPerfMap).sort((a,b) => b.revenue - a.revenue);
    const topAgentBody = document.getElementById('top-agents-body');
    if (agentRows.length === 0) {
      topAgentBody.innerHTML = '<tr><td colspan="4" class="empty-state"><em>No records found.</em></td></tr>';
    } else {
      topAgentBody.innerHTML = agentRows.map(a =>
        `<tr><td>${a.name}</td><td>${a.calls}</td><td>${a.orders}</td><td class="cell-amount">${fmtMoney(a.revenue)}</td></tr>`
      ).join('');
    }

    // Recent Activity
    const recent30 = callLogs.slice(0, 30);
    const activityFeed = document.getElementById('activity-feed');
    if (recent30.length === 0) {
      activityFeed.innerHTML = '<div class="empty-state"><em>No recent activity.</em></div>';
    } else {
      const dotColor = outcome => {
        if (['answered','ordered','interested'].includes(outcome)) return '#1D9E75';
        if (['declined','angry'].includes(outcome)) return '#E24B4A';
        if (['callback_requested'].includes(outcome)) return '#D97B2A';
        return '#888070';
      };
      activityFeed.innerHTML = recent30.map(c => {
        const color = dotColor(c.outcome);
        const custName = c.customers?.full_name || '—';
        const agentName = c.profiles?.full_name || '—';
        const outcomeLabel = STATUS_LABELS[c.outcome] || c.outcome;
        const ts = c.call_date ? fmtDate(c.call_date) : '—';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:0.5px solid var(--ml-border);">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="flex:1;">${custName} <span style="color:var(--ml-muted);">— ${outcomeLabel} · by ${agentName} · ${ts}</span></span>
        </div>`;
      }).join('');
    }

  } catch (err) {
    console.error('Dashboard error:', err);
    showToast('Failed to load dashboard data', 'error');
  }
})();
