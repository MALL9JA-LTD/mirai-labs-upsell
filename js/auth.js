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
    { href: '/dashboard',      icon: '▦', label: 'Dashboard',      admin: false },
    { href: '/customers',      icon: '◉', label: 'Customers',      admin: false },
    { href: '/calls',          icon: '◌', label: 'Calls',          admin: false },
    { href: '/deliveries',     icon: '▷', label: 'Deliveries',     admin: false },
    { href: '/website-orders', icon: '◈', label: 'Website Orders', admin: true  },
    { href: '/inventory',      icon: '▣', label: 'Inventory',      admin: true  },
    { href: '/agents',         icon: '◯', label: 'Agents',         admin: true  },
    { href: '/reports',        icon: '▨', label: 'Reports',        admin: false },
  ];

  // Inject brand header into sidebar
  const sidebar = document.querySelector('.sidebar');
  if (sidebar && !sidebar.querySelector('.sidebar-brand')) {
    const brand = document.createElement('div');
    brand.className = 'sidebar-brand';
    brand.innerHTML = `
      <div class="sidebar-brand-icon">M</div>
      <div class="sidebar-brand-text">
        <div class="sidebar-brand-name">MIRAI LABS</div>
        <div class="sidebar-brand-sub">CLTV Upsell</div>
      </div>
    `;
    sidebar.insertBefore(brand, sidebar.firstChild);
  }

  const nav = document.getElementById('sidebar-nav');
  if (nav) {
    nav.innerHTML = links
      .filter(l => !l.admin || isAdmin)
      .map(l => {
        const isActive = location.pathname === l.href || location.pathname.startsWith(l.href + '/');
        return `<a href="${l.href}" class="sidebar-link${isActive ? ' active' : ''}" aria-label="${l.label}">
          <span class="nav-icon">${l.icon}</span>
          <span>${l.label}</span>
        </a>`;
      })
      .join('');

    // Add footer version tag
    const footer = document.createElement('div');
    footer.className = 'sidebar-footer';
    footer.textContent = 'v1.0 · CRS Campaign';
    nav.after(footer);
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
