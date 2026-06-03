const BRANDS = [
  {
    key: 'mirailabs',
    name: 'MIRAI LABS',
    hostnames: ['mirai-labs-upsellcd.vercel.app', 'localhost', '127.0.0.1'],
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
  { value: 'delivered',          label: 'Delivered' },
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
    ordered:            'badge-gold',
    ordered_pending:    'badge-amber',
    interested:         'badge-amber',
    declined:           'badge-danger',
    failed_delivery:    'badge-danger',
    returned:           'badge-danger',
    angry:              'badge-danger',
    answered:           'badge-neutral',
    no_answer:          'badge-neutral',
    callback_requested: 'badge-neutral',
    wrong_number:       'badge-neutral',
    pending:            'badge-amber',
    failed:             'badge-danger',
    not_contacted:      'badge-neutral',
  }[key] || 'badge-neutral';
  return `<span class="badge ${cls}">${label}</span>`;
}

function calcTier(orderDateStr) {
  if (!orderDateStr) return 'D';
  const m = new Date(orderDateStr).getMonth() + 1; // 1–12
  if (m === 11 || m === 12) return 'A';
  if (m === 1  || m === 2)  return 'B';
  if (m === 3  || m === 4)  return 'C';
  return 'D'; // May, June, or anything else
}

function tierBadge(tier) {
  const cls = { A: 'badge-tier-a', B: 'badge-tier-b', C: 'badge-tier-c', D: 'badge-tier-d' }[tier] || 'badge-tier-d';
  return `<span class="badge ${cls}">Tier ${tier || 'D'}</span>`;
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
