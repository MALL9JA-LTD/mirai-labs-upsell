let allProfiles = [], allDeliveryStaff = [], allCallLogs = [], allDeliveries = [], allCustomers = [];

// Close any open row-menu when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.row-menu-wrap')) closeAllMenus();
});

function closeAllMenus() {
  document.querySelectorAll('.row-menu.open').forEach(m => {
    m.classList.remove('open');
    m.classList.remove('open-up');
  });
}

function toggleMenu(btn, menuId) {
  const menu = document.getElementById(menuId);
  const wasOpen = menu.classList.contains('open');
  closeAllMenus();
  if (!wasOpen) {
    menu.classList.add('open');
    // If near bottom of viewport, open upward
    const rect = btn.getBoundingClientRect();
    if (window.innerHeight - rect.bottom < 240) {
      menu.classList.add('open-up');
    }
  }
}

(async () => {
  const profile = await requireAuth();
  if (!profile) return;
  if (!isAdminLevel(profile)) {
    document.querySelector('.main-content').innerHTML = '<div class="empty-state" style="padding:60px;"><em>Admin access only.</em></div>';
    return;
  }
  await loadAll();
  bindEvents();
})();

async function loadAll() {
  document.getElementById('team-body').innerHTML = '<tr><td colspan="9" class="empty-state"><em>Loading…</em></td></tr>';
  document.getElementById('dstaff-body').innerHTML = '<tr><td colspan="5" class="empty-state"><em>Loading…</em></td></tr>';

  const [profiles, dstaff, callLogs, deliveries, customers] = await Promise.all([
    window._supabase.from('profiles').select('*').order('created_at',{ascending:false}),
    window._supabase.from('delivery_staff').select('id,name,phone,state,active').order('name'),
    fetchAll((from,to) => window._supabase.from('call_logs').select('id,agent_id,outcome').order('id').range(from,to)),
    fetchAll((from,to) => window._supabase.from('deliveries').select('id,agent_id,status,sale_price').order('id').range(from,to)),
    fetchAll((from,to) => window._supabase.from('customers').select('id,assigned_to').order('id').range(from,to)),
  ]);

  if (profiles.error) { showToast('Failed to load profiles: ' + profiles.error.message, 'error'); }
  allProfiles = profiles.data || [];
  allDeliveryStaff = dstaff.data || [];
  allCallLogs = callLogs;
  allDeliveries = deliveries;
  allCustomers = customers;

  renderTeam();
  renderDeliveryStaff();
}

function roleBadge(role, isActive) {
  if (isActive === false) return `<span class="badge badge-neutral">Deactivated</span>`;
  const map = {
    admin:      ['Admin',      'badge-gold'],
    temp_admin: ['Temp Admin', 'badge-amber'],
    supervisor: ['Supervisor', 'badge-tier-b'],
    crs_agent:  ['CRS Agent',  'badge-neutral'],
  };
  const [label, cls] = map[role] || [role, 'badge-neutral'];
  return `<span class="badge ${cls}">${label}</span>`;
}

const ROLES = [
  { value: 'crs_agent',  label: 'CRS Agent'  },
  { value: 'supervisor', label: 'Supervisor'  },
  { value: 'temp_admin', label: 'Temp Admin'  },
  { value: 'admin',      label: 'Admin'       },
];

function renderTeam() {
  const tbody = document.getElementById('team-body');
  const myId  = window._session?.user?.id;
  const myRole = window._profile?.role;
  const iAmMainAdmin = myRole === 'admin';
  const iAmTempAdmin = myRole === 'temp_admin';

  if (allProfiles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><em>No records found.</em></td></tr>';
    return;
  }

  tbody.innerHTML = allProfiles.map(a => {
    const custCount  = allCustomers.filter(c => c.assigned_to === a.id).length;
    const callCount  = allCallLogs.filter(c => c.agent_id === a.id).length;
    const orderCount = allDeliveries.filter(d => d.agent_id === a.id).length;
    const revenue    = allDeliveries.filter(d => d.agent_id===a.id&&d.status==='delivered').reduce((s,d)=>s+Number(d.sale_price||0),0);
    const isMe       = a.id === myId;
    const isActive   = a.is_active !== false;
    const targetIsMainAdmin = a.role === 'admin';

    // Who can act on this row
    const canAct = !isMe && (iAmMainAdmin || (iAmTempAdmin && !targetIsMainAdmin));

    const menuId = `menu-${a.id}`;

    // Build role change items
    const roleItems = ROLES
      .filter(r => iAmMainAdmin || r.value !== 'admin') // only main admin can assign admin
      .map(r => `<button class="row-menu-item${a.role===r.value?' active-role':''}"
          onclick="setRole('${a.id}','${r.value}',this)" ${a.role===r.value?'disabled':''}>
          ${a.role===r.value ? '✓ ' : ''}${r.label}
        </button>`).join('');

    const actionItems = `
      ${custCount > 0 ? `<button class="row-menu-item" onclick="clearAgentCustomers('${a.id}','${escAttr(a.full_name||'')}')">Clear ${custCount} customer${custCount>1?'s':''}</button>` : ''}
      ${isActive
        ? `<button class="row-menu-item danger" onclick="setActive('${a.id}',false)">Deactivate agent</button>`
        : `
          <button class="row-menu-item" onclick="setActive('${a.id}',true)">Reactivate agent</button>
          <button class="row-menu-item danger" onclick="removeAgent('${a.id}','${escAttr(a.full_name||'')}')">Remove permanently</button>
        `
      }
    `;

    const dotsBtn = canAct ? `
      <div class="row-menu-wrap">
        <button class="dots-btn" onclick="toggleMenu(this,'${menuId}')" title="Actions">⋯</button>
        <div class="row-menu" id="${menuId}">
          <div class="row-menu-section">
            <div class="row-menu-label">Change Role</div>
            ${roleItems}
          </div>
          <div class="row-menu-section">${actionItems}</div>
        </div>
      </div>` : '';

    return `<tr class="${!isActive?'inactive-agent':''}">
      <td><strong>${a.full_name||'—'}</strong>${isMe?' <span style="font-size:11px;color:var(--ml-muted);">(you)</span>':''}</td>
      <td>${roleBadge(a.role, a.is_active)}</td>
      <td>${custCount}</td>
      <td>${callCount}</td>
      <td>${orderCount}</td>
      <td class="cell-amount">${fmtMoney(revenue)}</td>
      <td>${fmtDate(a.created_at)}</td>
      <td>${dotsBtn}</td>
    </tr>`;
  }).join('');
}

function escAttr(str) { return (str||'').replace(/'/g,"\\'"); }

async function setRole(agentId, newRole, triggerEl) {
  closeAllMenus();
  const myRole = window._profile?.role;
  if (newRole === 'admin' && myRole !== 'admin') { showToast('Only the main Admin can grant Admin role.','error'); return; }
  const a = allProfiles.find(p => p.id === agentId);
  if (!a) return;
  const { data, error } = await window._supabase.from('profiles').update({ role: newRole }).eq('id', agentId).select();
  if (error) { showToast(error.message,'error'); return; }
  if (!data||data.length===0) { showToast('Update blocked — check permissions','error'); return; }
  showToast(`${a.full_name} → ${ROLES.find(r=>r.value===newRole)?.label}`);
  await loadAll();
}

async function setActive(agentId, active, triggerEl) {
  closeAllMenus();
  const a = allProfiles.find(p => p.id === agentId);
  if (!a) return;
  if (!active && !confirm(`Deactivate ${a.full_name}?\n\nThey will be signed out and cannot log in until reactivated.`)) return;
  const { error } = await window._supabase.from('profiles').update({ is_active: active }).eq('id', agentId);
  if (error) { showToast(error.message,'error'); return; }
  showToast(active ? `${a.full_name} reactivated` : `${a.full_name} deactivated`);
  await loadAll();
}

async function removeAgent(agentId, agentName) {
  closeAllMenus();
  if (!confirm(`Permanently remove ${agentName} from the app?\n\nTheir call and delivery history will be kept but unlinked. This cannot be undone.`)) return;
  // Unassign their customers first
  await window._supabase.from('customers').update({ assigned_to: null }).eq('assigned_to', agentId);
  // Unlink from call_logs and deliveries (preserve history, just remove agent link)
  await window._supabase.from('call_logs').update({ agent_id: null }).eq('agent_id', agentId);
  await window._supabase.from('deliveries').update({ agent_id: null }).eq('agent_id', agentId);
  // Now delete the profile
  const { error } = await window._supabase.from('profiles').delete().eq('id', agentId);
  if (error) { showToast('Remove failed: ' + error.message, 'error'); return; }
  showToast(`${agentName} removed from the app`);
  await loadAll();
}

async function clearAgentCustomers(agentId, agentName) {
  closeAllMenus();
  if (!confirm(`Unassign all customers from ${agentName}?\n\nThey will become available for redistribution.`)) return;
  const { error } = await window._supabase.from('customers').update({ assigned_to: null }).eq('assigned_to', agentId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(`Customers unassigned from ${agentName}`);
  await loadAll();
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
    <td>${s.state||'—'}</td>
    <td>${s.active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
    <td style="display:flex;gap:4px;">
      <button class="btn-ghost btn-sm" onclick="editDeliveryStaff('${s.id}')">Edit</button>
      <button class="btn-ghost btn-sm" style="color:var(--ml-muted);" onclick="toggleStaffActive('${s.id}',${!s.active})">${s.active?'Deactivate':'Activate'}</button>
    </td>
  </tr>`).join('');
}

function editDeliveryStaff(id) {
  const s = allDeliveryStaff.find(x => x.id===id);
  if (!s) return;
  document.getElementById('dstaff-id').value    = s.id;
  document.getElementById('dstaff-name').value  = s.name||'';
  document.getElementById('dstaff-phone').value = s.phone||'';
  document.getElementById('dstaff-state').value = s.state||'';
  document.getElementById('dstaff-active').checked = !!s.active;
  document.getElementById('dstaff-modal-title').textContent = 'Edit Delivery Staff';
  document.getElementById('dstaff-error').textContent = '';
  openModal('modal-delivery-staff');
}

async function saveDeliveryStaff() {
  const id    = document.getElementById('dstaff-id').value;
  const name  = document.getElementById('dstaff-name').value.trim();
  const phone = document.getElementById('dstaff-phone').value.trim();
  const state = document.getElementById('dstaff-state').value.trim();
  const active= document.getElementById('dstaff-active').checked;
  const errEl = document.getElementById('dstaff-error');
  errEl.textContent='';
  if (!name) { errEl.textContent='Name is required'; return; }
  const btn = document.getElementById('save-dstaff-btn');
  btn.disabled=true; btn.textContent='Saving…';
  const payload = { name, phone, state, active };
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

// ── CSV IMPORT ────────────────────────────────────────────────
let csvStaffRows = [];

function handleDStaffCsv(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { showToast('CSV file is empty or has no data rows','error'); return; }

    // Detect header
    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g,''));
    const nameIdx  = header.findIndex(h => h.includes('name'));
    const phoneIdx = header.findIndex(h => h.includes('phone'));
    const stateIdx = header.findIndex(h => h.includes('state') || h.includes('area'));

    if (nameIdx === -1) { showToast('CSV must have a "name" column','error'); return; }

    csvStaffRows = [];
    const parseRow = (line) => {
      // Handle quoted commas
      const cols = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      cols.push(cur.trim());
      return cols;
    };

    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const name = nameIdx  >= 0 ? (cols[nameIdx]  || '').replace(/^"|"$/g,'').trim() : '';
      const phone= phoneIdx >= 0 ? (cols[phoneIdx] || '').replace(/^"|"$/g,'').trim() : '';
      const state= stateIdx >= 0 ? (cols[stateIdx] || '').replace(/^"|"$/g,'').trim() : '';
      if (name) csvStaffRows.push({ name, phone, state, active: true });
    }

    if (csvStaffRows.length === 0) { showToast('No valid rows found in CSV','error'); return; }

    // Show preview
    const preview = document.getElementById('dstaff-csv-preview');
    preview.innerHTML = `
      <p style="font-size:12px;color:var(--ml-muted);margin-bottom:8px;">${csvStaffRows.length} staff found — preview:</p>
      <table class="data-table" style="font-size:12px;">
        <thead><tr><th>NAME</th><th>PHONE</th><th>STATE</th></tr></thead>
        <tbody>${csvStaffRows.slice(0,10).map(r => `<tr><td>${r.name}</td><td>${r.phone||'—'}</td><td>${r.state||'—'}</td></tr>`).join('')}</tbody>
      </table>
      ${csvStaffRows.length > 10 ? `<p style="font-size:11px;color:var(--ml-muted);margin-top:6px;">...and ${csvStaffRows.length - 10} more</p>` : ''}
    `;
    document.getElementById('dstaff-csv-error').textContent = '';
    openModal('modal-dstaff-csv');
  };
  reader.readAsText(file);
}

async function importDStaffCsv() {
  if (csvStaffRows.length === 0) return;
  const btn = document.getElementById('btn-confirm-dstaff-csv');
  const errEl = document.getElementById('dstaff-csv-error');
  btn.disabled = true; btn.textContent = 'Importing…';

  // Batch insert in chunks of 50
  const CHUNK = 50;
  let imported = 0;
  for (let i = 0; i < csvStaffRows.length; i += CHUNK) {
    const { error } = await window._supabase.from('delivery_staff').insert(csvStaffRows.slice(i, i + CHUNK));
    if (error) { errEl.textContent = error.message; btn.disabled=false; btn.textContent='Import All'; return; }
    imported += Math.min(CHUNK, csvStaffRows.length - i);
  }

  btn.disabled=false; btn.textContent='Import All';
  showToast(`Imported ${imported} delivery staff`);
  closeModal('modal-dstaff-csv');
  csvStaffRows = [];
  document.getElementById('dstaff-csv-file').value = '';
  await loadAll();
}

async function toggleStaffActive(id, newActive) {
  const { data, error } = await window._supabase.from('delivery_staff').update({ active: newActive }).eq('id',id).select();
  if (error) { showToast(error.message,'error'); return; }
  showToast(newActive ? 'Staff activated' : 'Staff deactivated');
  await loadAll();
}

async function createCrsAgent() {
  const myRole = window._profile?.role;
  const full_name = document.getElementById('crs-name').value.trim();
  const email     = document.getElementById('crs-email').value.trim();
  const password  = document.getElementById('crs-password').value;
  const role      = document.getElementById('crs-role').value;
  const errEl     = document.getElementById('crs-error');
  errEl.textContent = '';
  if (!full_name) { errEl.textContent='Name is required'; return; }
  if (!email)     { errEl.textContent='Email is required'; return; }
  if (password.length < 8) { errEl.textContent='Password must be at least 8 characters'; return; }
  if (role === 'admin' && myRole !== 'admin') { errEl.textContent='Only the main Admin can create Admin accounts.'; return; }

  const btn = document.getElementById('save-crs-btn');
  btn.disabled=true; btn.textContent='Creating…';

  // Save admin session BEFORE signUp — Supabase signUp replaces the current session
  const adminAccessToken  = window._session?.access_token;
  const adminRefreshToken = window._session?.refresh_token;

  const { data, error } = await window._supabase.auth.signUp({ email, password, options:{ data:{ full_name, role } } });

  // Immediately restore admin session regardless of outcome
  if (adminAccessToken) {
    await window._supabase.auth.setSession({ access_token: adminAccessToken, refresh_token: adminRefreshToken });
  }

  if (error) { errEl.textContent=error.message; btn.disabled=false; btn.textContent='Create Account'; return; }
  if (data?.user?.id) {
    await window._supabase.from('profiles').upsert({ id:data.user.id, email, full_name, role, is_active:true }, { onConflict:'id' });
  }
  showToast(`Account created for ${full_name}`);
  closeModal('modal-add-crs');
  btn.disabled=false; btn.textContent='Create Account';
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

  const myRole = window._profile?.role;
  if (myRole === 'supervisor') {
    document.getElementById('btn-add-crs').style.display = 'none';
    document.getElementById('btn-add-delivery-staff').style.display = 'none';
  }

  document.getElementById('btn-add-crs').addEventListener('click', () => {
    const iAmMainAdmin = window._profile?.role === 'admin';
    const roleSelect = document.getElementById('crs-role');
    Array.from(roleSelect.options).forEach(opt => { if (opt.value==='admin') opt.hidden=!iAmMainAdmin; });
    document.getElementById('crs-name').value='';
    document.getElementById('crs-email').value='';
    document.getElementById('crs-password').value='';
    roleSelect.value='crs_agent';
    document.getElementById('crs-error').textContent='';
    openModal('modal-add-crs');
  });
  document.getElementById('save-crs-btn').addEventListener('click', createCrsAgent);

  document.getElementById('btn-add-delivery-staff').addEventListener('click', () => {
    document.getElementById('dstaff-id').value='';
    document.getElementById('dstaff-name').value='';
    document.getElementById('dstaff-phone').value='';
    document.getElementById('dstaff-state').value='';
    document.getElementById('dstaff-active').checked=true;
    document.getElementById('dstaff-modal-title').textContent='Add Delivery Staff';
    document.getElementById('dstaff-error').textContent='';
    openModal('modal-delivery-staff');
  });
  document.getElementById('save-dstaff-btn').addEventListener('click', saveDeliveryStaff);

  // CSV import
  document.getElementById('btn-import-dstaff').addEventListener('click', () => {
    document.getElementById('dstaff-csv-file').click();
  });
  document.getElementById('dstaff-csv-file').addEventListener('change', e => {
    if (e.target.files[0]) handleDStaffCsv(e.target.files[0]);
  });
  document.getElementById('btn-confirm-dstaff-csv').addEventListener('click', importDStaffCsv);
}
