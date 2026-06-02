let allAgents = [];

(async () => {
  const profile = await requireAuth();
  if (!profile) return;

  if (profile.role !== 'admin') {
    document.querySelector('.main-content').innerHTML =
      `<div class="empty-state" style="padding:60px;"><span class="empty-icon">🔒</span>Admin access only</div>`;
    return;
  }

  await loadAgents();
  bindEvents();
})();

async function loadAgents() {
  document.getElementById('agents-body').innerHTML =
    `<tr class="loading-row"><td colspan="5"><span class="spinner"></span></td></tr>`;

  const { data, error } = await window._supabase
    .from('profiles')
    .select('id, full_name, email, role, created_at')
    .order('created_at', { ascending: false });

  if (error) { showToast('Failed to load agents', 'error'); return; }
  allAgents = data || [];
  renderAgents();
}

function roleBadge(role) {
  const map = {
    admin:          'badge-primary',
    crs_agent:      'badge-info',
    delivery_staff: 'badge-warning',
  };
  const labels = {
    admin:          'Admin',
    crs_agent:      'CRS Agent',
    delivery_staff: 'Delivery Staff',
  };
  const cls = map[role] || 'badge-secondary';
  return `<span class="badge ${cls}">${labels[role] || role}</span>`;
}

function renderAgents() {
  const tbody = document.getElementById('agents-body');
  if (!allAgents.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="empty-icon">🧑‍💼</span>No agents found</td></tr>`;
    return;
  }

  const myId = window._session?.user?.id;

  tbody.innerHTML = allAgents.map(a => `
    <tr>
      <td><strong>${a.full_name || '—'}</strong></td>
      <td>${a.email || '—'}</td>
      <td>${roleBadge(a.role)}</td>
      <td>${fmtDate(a.created_at)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openEditAgent('${a.id}')">Edit</button>
        ${a.id !== myId ? `<button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteAgent('${a.id}','${(a.full_name||'').replace(/'/g,"\\'")}')">Delete</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function openEditAgent(id) {
  const a = allAgents.find(x => x.id === id);
  if (!a) return;
  document.getElementById('edit-agent-id').value   = a.id;
  document.getElementById('edit-agent-name').value  = a.full_name || '';
  document.getElementById('edit-agent-role').value  = a.role || 'crs_agent';
  document.getElementById('edit-error').textContent = '';
  openModal('modal-edit-agent');
}

function bindEvents() {
  document.getElementById('btn-invite-agent').addEventListener('click', () => {
    document.getElementById('invite-name').value     = '';
    document.getElementById('invite-email').value    = '';
    document.getElementById('invite-password').value = '';
    document.getElementById('invite-role').value     = 'crs_agent';
    document.getElementById('invite-error').textContent = '';
    openModal('modal-invite');
  });

  document.getElementById('invite-btn').addEventListener('click', inviteAgent);
  document.getElementById('save-agent-btn').addEventListener('click', saveAgent);
}

async function inviteAgent() {
  const full_name = document.getElementById('invite-name').value.trim();
  const email     = document.getElementById('invite-email').value.trim();
  const password  = document.getElementById('invite-password').value;
  const role      = document.getElementById('invite-role').value;
  const errEl     = document.getElementById('invite-error');

  errEl.textContent = '';
  if (!full_name) { errEl.textContent = 'Full name is required'; return; }
  if (!email)     { errEl.textContent = 'Email is required'; return; }
  if (password.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; return; }

  const btn = document.getElementById('invite-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  // Sign up via standard client — requires handle_new_user trigger in Supabase
  // to insert into profiles with full_name and role from user_metadata
  const { data, error } = await window._supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name, role }
    }
  });

  if (error) {
    errEl.textContent = error.message;
    btn.disabled = false; btn.textContent = 'Create Account';
    return;
  }

  // If email confirmation is disabled, user is created immediately
  // Also try to upsert into profiles in case trigger is not set up
  if (data?.user?.id) {
    await window._supabase.from('profiles').upsert({
      id:        data.user.id,
      email,
      full_name,
      role,
    }, { onConflict: 'id' });
  }

  showToast(`Account created for ${full_name}`);
  closeModal('modal-invite');
  btn.disabled = false; btn.textContent = 'Create Account';
  await loadAgents();
}

async function saveAgent() {
  const id        = document.getElementById('edit-agent-id').value;
  const full_name = document.getElementById('edit-agent-name').value.trim();
  const role      = document.getElementById('edit-agent-role').value;
  const errEl     = document.getElementById('edit-error');

  errEl.textContent = '';
  if (!full_name) { errEl.textContent = 'Name is required'; return; }

  const btn = document.getElementById('save-agent-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { data, error } = await window._supabase
    .from('profiles')
    .update({ full_name, role })
    .eq('id', id)
    .select();

  btn.disabled = false; btn.textContent = 'Save Changes';

  if (error) { errEl.textContent = error.message; return; }
  if (!data || data.length === 0) {
    errEl.textContent = 'Update failed — RLS may have blocked it';
    return;
  }

  showToast('Agent updated successfully');
  closeModal('modal-edit-agent');
  await loadAgents();
}

async function deleteAgent(id, name) {
  if (!confirm(`Delete agent "${name}"? This cannot be undone and may affect related records.`)) return;

  const { error } = await window._supabase
    .from('profiles')
    .delete()
    .eq('id', id);

  if (error) { showToast(error.message, 'error'); return; }
  showToast('Agent deleted');
  await loadAgents();
}
