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
    { href: '/dashboard',      icon: '◈', label: 'Dashboard',      admin: false },
    { href: '/customers',      icon: '⬡', label: 'Customers',      admin: false },
    { href: '/calls',          icon: '◎', label: 'Calls',          admin: false },
    { href: '/deliveries',     icon: '▣', label: 'Deliveries',     admin: false },
    { href: '/inventory',      icon: '◰', label: 'Inventory',      admin: true  },
    { href: '/reports',        icon: '◫', label: 'Reports',        admin: false },
    { href: '/agents',         icon: '◯', label: 'Agents',         admin: true  },
    { href: '/website-orders', icon: '◱', label: 'Website Orders', admin: true  },
  ];

  const nav = document.getElementById('sidebar-nav');
  if (nav) {
    nav.innerHTML = links
      .filter(l => !l.admin || isAdmin)
      .map(l => {
        const isActive = location.pathname.startsWith(l.href);
        return `<a href="${l.href}" class="sidebar-icon${isActive ? ' active' : ''}" title="${l.label}" aria-label="${l.label}">${l.icon}</a>`;
      })
      .join('');
  }

  // Topbar avatar & role
  const avatarEl = document.getElementById('topbar-avatar');
  if (avatarEl) {
    const name = profile?.full_name || session?.user?.email || '';
    const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    avatarEl.textContent = initials || '?';
  }

  const roleEl = document.getElementById('topbar-role');
  if (roleEl) {
    roleEl.textContent = isAdmin ? 'Administrator' : 'CRS Agent';
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await window._supabase.auth.signOut();
      window.location.href = '/';
    });
  }
}
