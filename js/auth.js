async function requireAuth() {
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) { window.location.href = '/'; return null; }
  const { data: profile } = await window._supabase
    .from('profiles').select('*').eq('id', session.user.id).single();
  window._profile = profile;
  window._session = session;
  renderSidebar(profile, session);
  return profile;
}

function renderSidebar(profile, session) {
  const isAdmin = profile?.role === 'admin';
  const links = [
    { href: '/dashboard',      icon: '📊', label: 'Dashboard',      admin: false },
    { href: '/customers',      icon: '👥', label: 'Customers',      admin: false },
    { href: '/calls',          icon: '📞', label: 'Calls',          admin: false },
    { href: '/deliveries',     icon: '📦', label: 'Deliveries',     admin: false },
    { href: '/inventory',      icon: '🏭', label: 'Inventory',      admin: true  },
    { href: '/reports',        icon: '📈', label: 'Reports',        admin: false },
    { href: '/agents',         icon: '🧑‍💼', label: 'Agents',      admin: true  },
    { href: '/website-orders', icon: '🛒', label: 'Website Orders', admin: true  },
  ];
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = links
    .filter(l => !l.admin || isAdmin)
    .map(l => `<a href="${l.href}" class="sidebar-link ${location.pathname.startsWith(l.href) ? 'active' : ''}">${l.icon} <span>${l.label}</span></a>`)
    .join('');

  const userEl = document.getElementById('sidebar-user');
  if (userEl) userEl.textContent = profile?.full_name || session?.user?.email || '';

  const roleEl = document.getElementById('sidebar-role');
  if (roleEl) roleEl.textContent = isAdmin ? 'Administrator' : 'CRS Agent';

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await window._supabase.auth.signOut();
    window.location.href = '/';
  });

  // Mobile hamburger
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.querySelector('.sidebar');
  if (hamburger && sidebar) {
    hamburger.addEventListener('click', () => sidebar.classList.toggle('open'));
  }
}
