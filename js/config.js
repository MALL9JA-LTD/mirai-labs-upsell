const BRANDS = [
  {
    key: 'mirailabs',
    name: 'MIRAI LABS',
    hostnames: ['YOUR_DOMAIN_HERE', 'localhost', '127.0.0.1'],
    SUPABASE_URL: 'https://nfalzvmxntybjeucgghw.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_d67ACOJDswrU4o10IBpmkg_N422HBZk',
    primary: '#6C63FF',
    logo: null,
  },
];

const ACTIVE_BRAND = BRANDS.find(b => b.hostnames.includes(window.location.hostname)) || BRANDS[0];

// Apply brand theme
document.documentElement.style.setProperty('--primary', ACTIVE_BRAND.primary);
document.title = ACTIVE_BRAND.name + ' — Upsell Tracker';

// Init Supabase
window._supabase = window.supabase.createClient(ACTIVE_BRAND.SUPABASE_URL, ACTIVE_BRAND.SUPABASE_ANON_KEY);

const OUTCOMES = [
  { value: 'answered',           label: 'Answered' },
  { value: 'no_answer',          label: 'No answer' },
  { value: 'callback_requested', label: 'Callback requested' },
  { value: 'interested',         label: 'Interested' },
  { value: 'ordered',            label: 'Ordered' },
  { value: 'declined',           label: 'Declined' },
  { value: 'angry',              label: 'Angry / abusive' },
  { value: 'wrong_number',       label: 'Wrong number' },
];

const STATUS_LABELS = {
  not_contacted:      'Not contacted',
  ordered_pending:    'Ordered — pending delivery',
  delivered:          'Delivered',
  failed_delivery:    'Failed delivery',
  returned:           'Returned',
  answered:           'Answered',
  no_answer:          'No answer',
  callback_requested: 'Callback requested',
  interested:         'Interested',
  ordered:            'Ordered',
  declined:           'Declined',
  angry:              'Angry / abusive',
  wrong_number:       'Wrong number',
  pending:            'Pending',
  failed:             'Failed',
};

function statusLabel(key) {
  return STATUS_LABELS[key] || key || '—';
}

function statusBadge(key) {
  const label = statusLabel(key);
  const cls = {
    delivered:          'badge-success',
    ordered:            'badge-info',
    ordered_pending:    'badge-info',
    pending:            'badge-info',
    interested:         'badge-warning',
    callback_requested: 'badge-warning',
    answered:           'badge-secondary',
    declined:           'badge-danger',
    failed_delivery:    'badge-danger',
    failed:             'badge-danger',
    returned:           'badge-secondary',
    angry:              'badge-danger',
    no_answer:          'badge-secondary',
    wrong_number:       'badge-secondary',
    not_contacted:      'badge-secondary',
  }[key] || 'badge-secondary';
  return `<span class="badge ${cls}">${label}</span>`;
}

function calcTier(orderDateStr) {
  if (!orderDateStr) return 'C';
  const months = (Date.now() - new Date(orderDateStr)) / (1000 * 60 * 60 * 24 * 30);
  if (months <= 3) return 'A';
  if (months <= 6) return 'B';
  return 'C';
}

function tierBadge(tier) {
  const cls = { A: 'badge-success', B: 'badge-warning', C: 'badge-secondary' }[tier] || 'badge-secondary';
  return `<span class="badge ${cls}">Tier ${tier}</span>`;
}

function fmtMoney(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB');
}

async function fetchAll(queryFn) {
  const PAGE = 1000;
  let rows = [], from = 0;
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3500);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

// Close modal when clicking backdrop
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});
