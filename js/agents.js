let allProfiles = [], allDeliveryStaff = [], allCallLogs = [], allDeliveries = [], allCustomers = [];

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML = '<div class="empty-state" style="padding:60px;"><em>Admin access only.</em></div>';
    return;
  }
  await loadAll();
  bindEvents();
})();

async function loadAll() {
  document.getElementById('team-body').innerHTML = '<tr><td colspan="8" class="empty-state"><em>Loading…</em></td></tr>';
  document.getElementById('dstaff-body').innerHTML = '<tr><td colspan="5" class="empty-state"><em>Loading…</em></td></tr>';

  const [profiles, dstaff, callLogs, deliveries, customers] = await Promise.all([
    window._supabase.from('profiles').select('id,full_name,email,role,created_at').order('created_at',{ascending:false}),
    window._supabase.from('delivery_staff').select('id,name,phone,active,created_at').order('created_at',{ascending:false}),
    fetchAll((from,to) => window._supabase.from('call_logs').select('id,agent_id,outcome').order('id').range(from,to)),
    fetchAll((from,to) => window._supabase.from('deliveries').select('id,agent_id,status,sale_price').order('id').range(from,to)),
    fetchAll((from,to) => window._supabase.from('customers').select('id,assigned_to').order('id').range(from,to)),
  ]);

  allProfiles = profiles.data || [];
  allDeliveryStaff = dstaff.data || [];
  allCallLogs = callLogs;
  allDeliveries = deliveries;
  allCustomers = customers;

  renderTeam();
  renderDeliveryStaff();
}

function roleBadge(role) {
  const labels = { admin:'Admin', crs_agent:'CRS Agent' };
  const cls = role === 'admin' ? 'badge-gold' : 'badge-neutral';
  return `<span class="badge ${cls}">${labels[role]||role}</span>`;
}

function renderTeam() {
  const tbody = document.getElementById('team-body');
  const myId = window._session?.user?.id;

  if (allProfiles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }

  tbody.innerHTML = allProfiles.map(a => {
    const custCount = allCustomers.filter(c => c.assigned_to === a.id).length;
    const callCount = allCallLogs.filter(c => c.agent_id === a.id).length;
    const orderCount = allDeliveries.filter(d => d.agent_id === a.id).length;
    const revenue = allDeliveries.filter(d => d.agent_id===a.id&&d.status==='delivered').reduce((s,d) => s+Number(d.sale_price||0), 0);
    const isMe = a.id === myId;
    return `<tr>
      <td><strong>${a.full_name||'—'}</strong>${isMe?' <span style="font-size:11px;color:var(--ml-muted);">(you)</span>':''}</td>
      <td>${roleBadge(a.role)}</td>
      <td>${custCount}</td>
      <td>${callCount}</td>
      <td>${orderCount}</td>
      <td class="cell-amount">${fmtMoney(revenue)}</td>
      <td>${fmtDate(a.created_at)}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap;">
        <a href="/customers?agent=${a.id}" class="btn-ghost btn-sm">View</a>
        ${!isMe ? `<button class="btn-ghost btn-sm" onclick="openChangeRole('${a.id}','${a.role}')">Change Role</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function renderDeliveryStaff() {
  const tbody = document.getElementById('dstaff-body');
  if (allDeliveryStaff.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }
  tbody.innerHTML = allDeliveryStaff.map(s => `<tr>
    <td><strong>${s.name||'—'}</strong></td>
    <td>${s.phone||'—'}</td>
    <td>${s.active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
    <td>${fmtDate(s.created_at)}</td>
    <td style="display:flex;gap:4px;">
      <button class="btn-ghost btn-sm" onclick="editDeliveryStaff('${s.id}')">Edit</button>
      <button class="btn-ghost btn-sm" style="color:var(--ml-muted);" onclick="toggleStaffActive('${s.id}',${!s.active})">${s.active?'Deactivate':'Activate'}</button>
    </td>
  </tr>`).join('');
}

function openChangeRole(id, currentRole) {
  document.getElementById('change-role-id').value = id;
  document.getElementById('change-role-value').value = currentRole;
  document.getElementById('change-role-error').textContent = '';
  openModal('modal-change-role');
}

async function saveRole() {
  const id = document.getElementById('change-role-id').value;
  const role = document.getElementById('change-role-value').value;
  const errEl = document.getElementById('change-role-error');
  const btn = document.getElementById('save-role-btn');
  btn.disabled=true; btn.textContent='Saving…';
  const { data, error } = await window._supabase.from('profiles').update({ role }).eq('id',id).select();
  btn.disabled=false; btn.textContent='Save';
  if (error) { errEl.textContent = error.message; return; }
  if (!data||data.length===0) { errEl.textContent='Update failed — RLS blocked it'; return; }
  showToast('Role updated');
  closeModal('modal-change-role');
  await loadAll();
}

async function createCrsAgent() {
  const full_name = document.getElementById('crs-name').value.trim();
  const email = document.getElementById('crs-email').value.trim();
  const password = document.getElementById('crs-password').value;
  const role = document.getElementById('crs-role').value;
  const errEl = document.getElementById('crs-error');
  errEl.textContent = '';
  if (!full_name) { errEl.textContent='Name is required'; return; }
  if (!email) { errEl.textContent='Email is required'; return; }
  if (password.length < 8) { errEl.textContent='Password must be at least 8 characters'; return; }
  const btn = document.getElementById('save-crs-btn');
  btn.disabled=true; btn.textContent='Creating…';
  const { data, error } = await window._supabase.auth.signUp({ email, password, options: { data: { full_name, role } } });
  if (error) { errEl.textContent = error.message; btn.disabled=false; btn.textContent='Create Account'; return; }
  if (data?.user?.id) {
    await window._supabase.from('profiles').upsert({ id: data.user.id, email, full_name, role }, { onConflict:'id' });
  }
  showToast(`Agent account created for ${full_name}`);
  closeModal('modal-add-crs');
  btn.disabled=false; btn.textContent='Create Account';
  await loadAll();
}

function editDeliveryStaff(id) {
  const s = allDeliveryStaff.find(x => x.id===id);
  if (!s) return;
  document.getElementById('dstaff-id').value = s.id;
  document.getElementById('dstaff-name').value = s.name||'';
  document.getElementById('dstaff-phone').value = s.phone||'';
  document.getElementById('dstaff-active').checked = !!s.active;
  document.getElementById('dstaff-modal-title').textContent = 'Edit Delivery Staff';
  document.getElementById('dstaff-error').textContent = '';
  openModal('modal-delivery-staff');
}

async function saveDeliveryStaff() {
  const id = document.getElementById('dstaff-id').value;
  const name = document.getElementById('dstaff-name').value.trim();
  const phone = document.getElementById('dstaff-phone').value.trim();
  const active = document.getElementById('dstaff-active').checked;
  const errEl = document.getElementById('dstaff-error');
  errEl.textContent='';
  if (!name) { errEl.textContent='Name is required'; return; }
  const btn = document.getElementById('save-dstaff-btn');
  btn.disabled=true; btn.textContent='Saving…';
  const payload = { name, phone, active };
  let error;
  if (id) {
    const res = await window._supabase.from('delivery_staff').update(payload).eq('id',id).select();
    error = res.error;
    if (!error&&(!res.data||res.data.length===0)) { errEl.textContent='Update failed'; btn.disabled=false; btn.textContent='Save'; return; }
  } else {
    const res = await window._supabase.from('delivery_staff').insert(payload).select();
    error = res.error;
  }
  btn.disabled=false; btn.textContent='Save';
  if (error) { errEl.textContent=error.message; return; }
  showToast(id ? 'Staff updated' : 'Staff added');
  closeModal('modal-delivery-staff');
  await loadAll();
}

async function toggleStaffActive(id, newActive) {
  const { data, error } = await window._supabase.from('delivery_staff').update({ active: newActive }).eq('id',id).select();
  if (error) { showToast(error.message,'error'); return; }
  if (!data||data.length===0) { showToast('Update failed','error'); return; }
  showToast(newActive ? 'Staff activated' : 'Staff deactivated');
  await loadAll();
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('btn-add-crs').addEventListener('click', () => {
    document.getElementById('crs-name').value='';
    document.getElementById('crs-email').value='';
    document.getElementById('crs-password').value='';
    document.getElementById('crs-role').value='crs_agent';
    document.getElementById('crs-error').textContent='';
    openModal('modal-add-crs');
  });
  document.getElementById('save-crs-btn').addEventListener('click', createCrsAgent);
  document.getElementById('save-role-btn').addEventListener('click', saveRole);

  document.getElementById('btn-add-delivery-staff').addEventListener('click', () => {
    document.getElementById('dstaff-id').value='';
    document.getElementById('dstaff-name').value='';
    document.getElementById('dstaff-phone').value='';
    document.getElementById('dstaff-active').checked=true;
    document.getElementById('dstaff-modal-title').textContent='Add Delivery Staff';
    document.getElementById('dstaff-error').textContent='';
    openModal('modal-delivery-staff');
  });
  document.getElementById('save-dstaff-btn').addEventListener('click', saveDeliveryStaff);
}
