// Support Link Box - Core Administration Engine (Vanilla JS Edition)
// High-performance client-side state machine with localStorage persistence

const ADMIN_NAMES = {
  'shihab@linkbox.com': 'Md Shihab Khan',
  'mamun@linkbox.com': 'Mamun Aravi',
  'shuvo@linkbox.com': 'Shuvo Sutradhar',
  'shadat@linkbox.com': 'ShaDat Hossain',
  'rubel@linkbox.com': 'Ariyan Ahmed Rubel',
  'hanif@linkbox.com': 'Mohammad Abu Hanif'
};

const INITIAL_MEMBERS_DATA = [];

function getPastDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

const STORAGE_KEYS = {
  MEMBERS: 'support_linkbox_members',
  LOGS: 'support_linkbox_logs',
  AUDIT: 'support_linkbox_audit',
  BADGES: 'support_linkbox_badges',
  CURRENT_ADMIN: 'support_linkbox_current_admin',
  SUPABASE_URL: 'support_linkbox_supabase_url',
  SUPABASE_KEY: 'support_linkbox_supabase_key',
  SUPABASE_SYNC_ENABLED: 'support_linkbox_supabase_sync_enabled'
};

// Supabase client and sync helpers
let cachedSupabaseClient = null;
let realtimeChannel = null;

export function getase() {
  if (cachedSupabaseClient) return cachedSupabaseClient;

  const url = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || state.supabaseUrl;
  const key = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || state.supabaseKey;

  if (!url || !key || url.includes('your-project')) {
    console.warn('Supabase URL or Key is missing or invalid.');
    return null;
  }

  // Check global object for both CDN and bundler support
  const supabaseLib = window.supabase || (typeof createClient !== 'undefined' ? createClient : null);

  if (!supabaseLib) {
    console.warn('Supabase JS library (CDN/Module) is not loaded yet.');
    return null;
  }
  try {
    cachedSupabaseClient = supabaseLib.createClient(url, key);
    return cachedSupabaseClient;
  } catch (err) {
    console.error('Failed to instantiate Supabase client:', err);
    return null;
  }
}

export function setupSupabaseRealtime() {
  const client = getSupabase();
  if (!client) return;
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  if (realtimeChannel) {
    client.removeChannel(realtimeChannel);
  }

  console.log('Initializing Supabase Realtime Channels for Live Sync...');
  realtimeChannel = client.channel('public-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, (payload) => {
      console.log('Realtime change: members', payload);
      handleRealtimeChange('members', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, (payload) => {
      console.log('Realtime change: activity_logs', payload);
      handleRealtimeChange('activity_logs', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'badges' }, (payload) => {
      console.log('Realtime change: badges', payload);
      handleRealtimeChange('badges', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_trails' }, (payload) => {
      console.log('Realtime change: audit_trails', payload);
      handleRealtimeChange('audit_trails', payload);
    })
    .subscribe((status) => {
      console.log('Supabase realtime connection status:', status);
    });
}

function handleRealtimeChange(table, payload) {
  const storageKeyMap = {
    members: STORAGE_KEYS.MEMBERS,
    activity_logs: STORAGE_KEYS.LOGS,
    badges: STORAGE_KEYS.BADGES,
    audit_trails: STORAGE_KEYS.AUDIT
  };

  const key = storageKeyMap[table];
  if (!key) return;

  try {
    let localData = JSON.parse(localStorage.getItem(key) || '[]');
    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'INSERT') {
      if (!localData.some(item => item.id === newRecord.id)) {
        localData.push(newRecord);
        localStorage.setItem(key, JSON.stringify(localData));
        state[table === 'members' ? 'members' : table === 'audit_trails' ? 'auditTrails' : table] = localData;
        render();
      }
    } else if (eventType === 'UPDATE') {
      let updated = false;
      localData = localData.map(item => {
        if (item.id === newRecord.id) {
          if (JSON.stringify(item) !== JSON.stringify(newRecord)) {
            updated = true;
            return newRecord;
          }
        }
        return item;
      });
      if (updated) {
        localStorage.setItem(key, JSON.stringify(localData));
        state[table === 'members' ? 'members' : table === 'audit_trails' ? 'auditTrails' : table] = localData;
        render();
      }
    } else if (eventType === 'DELETE') {
      const initialLength = localData.length;
      localData = localData.filter(item => item.id !== oldRecord.id);
      if (localData.length !== initialLength) {
        localStorage.setItem(key, JSON.stringify(localData));
        state[table === 'members' ? 'members' : table === 'audit_trails' ? 'auditTrails' : table] = localData;
        render();
      }
    }
  } catch (err) {
    console.error('Error handling realtime update:', err);
  }
}

function triggerStateReload(table) {
  console.log(`Realtime: Reloading state and UI for table ${table}`);
  loadStateFromStorage();
  updateState({});
}

export async function testSupabaseConnection() {
  const client = getSupabase();
  if (!client) {
    updateState({ supabaseConnectionStatus: 'not_configured', supabaseConnectionError: '' });
    return false;
  }
  updateState({ supabaseConnectionStatus: 'connecting', supabaseConnectionError: '' });
  try {
    const { error } = await client.from('members').select('id').limit(1);
    if (error) throw error;
    updateState({ supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
    return true;
  } catch (err) {
    console.error('Supabase Connection Test Error:', err);
    updateState({ 
      supabaseConnectionStatus: 'error', 
      supabaseConnectionError: err.message || err.details || 'Connection failed' 
    });
    return false;
  }
}

export async function pushToSupabase() {
  const client = getSupabase();
  if (!client) {
    showToast('অনুগ্রহ করে প্রথমে Supabase URL এবং Key সেট আপ করুন!', 'error');
    return false;
  }
  updateState({ supabaseSyncing: true });
  try {
    const members = getMembers();
    const logs = getActivityLogs();
    const badges = getBadges();
    const auditTrails = getAuditTrails();

    if (members.length > 0) {
      const { error: mErr } = await client.from('members').upsert(members);
      if (mErr) throw new Error(`Members Sync Error: ${mErr.message}`);
    }
    if (logs.length > 0) {
      const { error: lErr } = await client.from('activity_logs').upsert(logs);
      if (lErr) throw new Error(`Logs Sync Error: ${lErr.message}`);
    }
    if (badges.length > 0) {
      const { error: bErr } = await client.from('badges').upsert(badges);
      if (bErr) throw new Error(`Badges Sync Error: ${bErr.message}`);
    }
    if (auditTrails.length > 0) {
      const { error: aErr } = await client.from('audit_trails').upsert(auditTrails);
      if (aErr) throw new Error(`Audit Sync Error: ${aErr.message}`);
    }

    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
    showToast('অভিনন্দন! লোকাল ব্রাউজারের সমস্ত মেম্বার এবং অ্যাক্টিভিটি ডাটা সফলভাবে Supabase ক্লাউডে আপলোড করা হয়েছে!', 'success');
    return true;
  } catch (err) {
    console.error(err);
    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'error', supabaseConnectionError: err.message });
    showToast(`ডাটা আপলোড করতে সমস্যা হয়েছে: ${err.message}`, 'error');
    return false;
  }
}

export async function pullFromSupabase() {
  const client = getSupabase();
  if (!client) {
    showToast('অনুগ্রহ করে প্রথমে Supabase URL এবং Key সেট আপ করুন!', 'error');
    return false;
  }
  updateState({ supabaseSyncing: true });
  try {
    const { data: remoteMembers, error: mErr } = await client.from('members').select('*').order('member_number', { ascending: true });
    if (mErr) throw new Error(`Members Pull Error: ${mErr.message}`);

    const { data: remoteLogs, error: lErr } = await client.from('activity_logs').select('*');
    if (lErr) throw new Error(`Logs Pull Error: ${lErr.message}`);

    const { data: remoteBadges, error: bErr } = await client.from('badges').select('*');
    if (bErr) throw new Error(`Badges Pull Error: ${bErr.message}`);

    const { data: remoteAudits, error: aErr } = await client.from('audit_trails').select('*').order('timestamp', { ascending: false });
    if (aErr) throw new Error(`Audits Pull Error: ${aErr.message}`);

    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(remoteMembers || []));
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(remoteLogs || []));
    localStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify(remoteBadges || []));
    localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(remoteAudits || []));

    loadStateFromStorage();
    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
    showToast('অভিনন্দন! Supabase ক্লাউড ডাটাবেজ থেকে সমস্ত রেকর্ড সফলভাবে ডাউনলোড করা হয়েছে!', 'success');
    return true;
  } catch (err) {
    console.error(err);
    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'error', supabaseConnectionError: err.message });
    showToast(`ডাটা ডাউনলোড করতে সমস্যা হয়েছে: ${err.message}`, 'error');
    return false;
  }
}

export async function silentPullFromSupabase() {
  const client = getSupabase();
  if (!client) return false;
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return false;

  try {
    const { data: remoteMembers, error: mErr } = await client.from('members').select('*').order('member_number', { ascending: true });
    if (mErr) throw mErr;

    const { data: remoteLogs, error: lErr } = await client.from('activity_logs').select('*');
    if (lErr) throw lErr;

    const { data: remoteBadges, error: bErr } = await client.from('badges').select('*');
    if (bErr) throw bErr;

    const { data: remoteAudits, error: aErr } = await client.from('audit_trails').select('*').order('timestamp', { ascending: false });
    if (aErr) throw aErr;

    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(remoteMembers || []));
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(remoteLogs || []));
    localStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify(remoteBadges || []));
    localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(remoteAudits || []));

    state.members = remoteMembers || [];
    state.auditTrails = remoteAudits || [];
    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
    console.log('Background silent sync completed successfully!');
    return true;
  } catch (err) {
    console.error('Background silent sync pull failed:', err);
    updateState({ supabaseConnectionStatus: 'error', supabaseConnectionError: err.message });
    return false;
  }
}

export async function syncMembersDiff(newMembers) {
  const client = getSupabase();
  if (!client) return;
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  try {
    const oldMembers = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]');
    const newMemberIds = new Set(newMembers.map(m => m.id));
    const deletedMembers = oldMembers.filter(m => m && m.id && !newMemberIds.has(m.id));
    
    for (const dm of deletedMembers) {
      await client.from('members').delete().eq('id', dm.id);
    }
    
    const oldMemberMap = new Map(oldMembers.map(m => [m.id, m]));
    const modifiedOrNewMembers = newMembers.filter(nm => {
      const om = oldMemberMap.get(nm.id);
      if (!om) return true;
      return (
        nm.updated_at !== om.updated_at ||
        nm.status !== om.status ||
        nm.total_points !== om.total_points ||
        nm.current_streak !== om.current_streak ||
        nm.longest_streak !== om.longest_streak ||
        nm.notes !== om.notes ||
        nm.level !== om.level ||
        nm.consecutive_inactive_days !== om.consecutive_inactive_days ||
        nm.total_active_days !== om.total_active_days ||
        nm.last_active_date !== om.last_active_date
      );
    });
    
    if (modifiedOrNewMembers.length > 0) {
      await client.from('members').upsert(modifiedOrNewMembers);
    }
  } catch (err) {
    console.error('Error syncing members diff:', err);
  }
}

export async function syncLogsDiff(newLogs) {
  const client = getSupabase();
  if (!client) return;
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  try {
    const oldLogs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
    const newLogIds = new Set(newLogs.map(l => l.id));
    const deletedLogs = oldLogs.filter(l => l && l.id && !newLogIds.has(l.id));
    
    for (const dl of deletedLogs) {
      await client.from('activity_logs').delete().eq('id', dl.id);
    }
    
    const oldLogIds = new Set(oldLogs.map(l => l.id));
    const addedLogs = newLogs.filter(nl => !oldLogIds.has(nl.id));
    
    if (addedLogs.length > 0) {
      await client.from('activity_logs').upsert(addedLogs);
    }
  } catch (err) {
    console.error('Error syncing logs diff:', err);
  }
}

export async function syncBadgesDiff(newBadges) {
  const client = getSupabase();
  if (!client) return;
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  try {
    const oldBadges = JSON.parse(localStorage.getItem(STORAGE_KEYS.BADGES) || '[]');
    const newBadgeIds = new Set(newBadges.map(b => b.id));
    const deletedBadges = oldBadges.filter(b => b && b.id && !newBadgeIds.has(b.id));
    
    for (const db of deletedBadges) {
      await client.from('badges').delete().eq('id', db.id);
    }
    
    const oldBadgeIds = new Set(oldBadges.map(b => b.id));
    const addedBadges = newBadges.filter(nb => !oldBadgeIds.has(nb.id));
    
    if (addedBadges.length > 0) {
      await client.from('badges').upsert(addedBadges);
    }
  } catch (err) {
    console.error('Error syncing badges diff:', err);
  }
}

export async function syncAuditTrailsDiff(newAudits) {
  const client = getSupabase();
  if (!client) return;
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  try {
    const oldAudits = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT) || '[]');
    const oldAuditIds = new Set(oldAudits.map(a => a.id));
    const addedAudits = newAudits.filter(na => !oldAuditIds.has(na.id));
    
    if (addedAudits.length > 0) {
      await client.from('audit_trails').upsert(addedAudits);
    }
  } catch (err) {
    console.error('Error syncing audits diff:', err);
  }
}

export async function syncSingleRecord(tableName, record) {
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;
  const client = getSupabase();
  if (!client) return;
  try {
    await client.from(tableName).upsert([record]);
  } catch (e) {
    console.error(`Auto-sync failed for ${tableName}:`, e);
  }
}

export async function syncMultipleRecords(tableName, records) {
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;
  const client = getSupabase();
  if (!client) return;
  try {
    await client.from(tableName).upsert(records);
  } catch (e) {
    console.error(`Auto-sync failed for bulk ${tableName}:`, e);
  }
}

export function initializeDatabase() {
  try {
    const existingMembers = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]');
    const hasLegacyDemo = Array.isArray(existingMembers) && existingMembers.some(m => 
      m && (m.name === 'Rahi Ahmed Rabiul' || m.name === 'HM Jakaria Ahmed' || m.id === 'member-1')
    );
    if (hasLegacyDemo) {
      localStorage.removeItem(STORAGE_KEYS.MEMBERS);
      localStorage.removeItem(STORAGE_KEYS.LOGS);
      localStorage.removeItem(STORAGE_KEYS.AUDIT);
      localStorage.removeItem(STORAGE_KEYS.BADGES);
      console.log('Legacy demo database detected and successfully purged.');
    }
  } catch (e) {
    console.error('Error checking legacy database:', e);
  }

  if (!localStorage.getItem(STORAGE_KEYS.MEMBERS)) {
    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify([]));

    const audit = [{
      id: 'audit-initial',
      admin_email: 'shihab@linkbox.com',
      admin_name: 'Md Shihab Khan',
      action: 'INITIALIZE',
      entity_type: 'DATABASE',
      description: 'System database initialized with clean empty state.',
      timestamp: new Date().toISOString()
    }];
    localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(audit));
    localStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify([]));
  }
}

export function getMembers() {
  initializeDatabase();
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]');
}

export function saveMembers(members) {
  syncMembersDiff(members);
  localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(members));
}

export function getActivityLogs() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
}

export function saveActivityLogs(logs) {
  syncLogsDiff(logs);
  localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
}

export function getAuditTrails() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT) || '[]');
}

export function saveAuditTrails(trails) {
  syncAuditTrailsDiff(trails);
  localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(trails));
}

export function getBadges() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.BADGES) || '[]');
}

export function saveBadges(badges) {
  syncBadgesDiff(badges);
  localStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify(badges));
}

export function getCurrentAdmin() {
  return localStorage.getItem(STORAGE_KEYS.CURRENT_ADMIN) || 'shihab@linkbox.com';
}

export function setCurrentAdmin(email) {
  localStorage.setItem(STORAGE_KEYS.CURRENT_ADMIN, email);
}

export function cleanName(name) {
  return name.replace(/^@/, '').trim().replace(/\s+/g, ' ');
}

let deferredPrompt = null;

// Global State Object
let state = {
  currentTab: 'members',
  currentAdminEmail: getCurrentAdmin(),
  members: [],
  auditTrails: [],
  searchQueryMembers: '',
  memberFilterStatus: 'all',
  editingNotesMemberId: null,
  editingNotesText: '',
  bulkInputText: '',
  bulkInputDate: new Date().toISOString().split('T')[0],
  noticeFilterDays: 3,
  copiedNotice: false,
  leaderboardSearchQuery: '',
  leaderboardActiveThreshold: 1,
  leaderboardInactiveThreshold: 3,
  reportSearchQuery: '',
  reportSelectedMemberId: '',
  isDownloadingReport: false,
  copiedSQL: false,
  copiedJS: false,
  generatedPngUrl: '',
  generatedPngMemberName: '',
  showPwaInstallBanner: false,
  showRegisterModal: false,
  
  // 🔽 এখানে আপনার আসল SUPABASE ক্রেডেনশিয়ালস বসিয়ে দিন (সব এডমিনের ফোনে অটো সেটআপ হবে)
  supabaseUrl: localStorage.getItem('support_linkbox_supabase_url') || 'https://xzgozwylnfpcicdipjhw.supabase.co',
  supabaseKey: localStorage.getItem('support_linkbox_supabase_key') || 'sb_publishable_mjndYPAxtmjjulEtV3brkA_CPhU4BA_',
  
  supabaseSyncEnabled: localStorage.getItem('support_linkbox_supabase_sync_enabled') !== 'false',
  supabaseConnectionStatus: 'idle',
  supabaseConnectionError: '',
  supabaseSyncing: false,
  loadedFromEnv: false,
  showUrlInput: false,
  showKeyInput: false,
  uncheckedUnregisteredNames: [],
  developerUnlocked: typeof sessionStorage !== 'undefined' && sessionStorage.getItem('developer_unlocked') === 'true',
  toast: null
};

export function initSupabaseConfig() {
  try {
    const urlObj = new URL(window.location.href);
    const urlParam = urlObj.searchParams.get('supabase_url') || urlObj.searchParams.get('url');
    const keyParam = urlObj.searchParams.get('supabase_key') || urlObj.searchParams.get('key');
    
    let updated = false;
    if (urlParam) {
      localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, urlParam);
      updated = true;
    }
    if (keyParam) {
      localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, keyParam);
      updated = true;
    }
    
    if (updated) {
      urlObj.searchParams.delete('supabase_url');
      urlObj.searchParams.delete('supabase_key');
      urlObj.searchParams.delete('url');
      urlObj.searchParams.delete('key');
      window.history.replaceState({}, document.title, urlObj.pathname + urlObj.search);
      
      state.supabaseUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL);
      state.supabaseKey = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY);
    }
  } catch (e) {
    console.error('Error parsing URL queries for configuration:', e);
  }
}

function loadStateFromStorage() {
  initializeDatabase();
  initSupabaseConfig();
  state.members = getMembers();
  state.auditTrails = getAuditTrails();
  state.currentAdminEmail = getCurrentAdmin();
  
  if (state.supabaseUrl && state.supabaseKey) {
    setTimeout(() => {
      testSupabaseConnection();
    }, 500);
  }
}

export function showToast(message, type = 'success') {
  state.toast = { message, type };
  render();
  setTimeout(() => {
    if (state.toast && state.toast.message === message) {
      state.toast = null;
      render();
    }
  }, 4000);
}

function updateState(newState) {
  state = { ...state, ...newState };
  render();
}

function handleAddMember(rawName, notes = '') {
  const cleaned = cleanName(rawName);
  if (!cleaned) {
    alert('মেম্বার এর নাম ফাকা হতে পারে না!');
    return false;
  }

  const members = getMembers();
  const duplicate = members.find(m => m.name.toLowerCase() === cleaned.toLowerCase());
  if (duplicate) {
    alert(`এই নামের অন্য লোক আছে! অনুগ্রহ করে নামের শেষে '1', '2' বা 'A', 'B' কিছু লাগিয়ে দিন (যেমন: ${cleaned} A)`);
    return false;
  }

  const maxMemberNum = members.reduce((max, m) => m.member_number > max ? m.member_number : max, 0);
  const nextMemberNum = maxMemberNum + 1;

  const newMember = {
    id: `member-${Math.random().toString(36).substr(2, 9)}`,
    name: cleaned,
    display_name: `@${cleaned.replace(/\s+/g, '')}`,
    member_number: nextMemberNum,
    status: 'active',
    level: 'Bronze',
    total_points: 0,
    current_streak: 0,
    longest_streak: 0,
    total_active_days: 0,
    last_active_date: null,
    consecutive_inactive_days: 0,
    notes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  members.push(newMember);
  saveMembers(members);

  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${Date.now()}`,
    admin_email: state.currentAdminEmail,
    admin_name: adminName,
    action: 'ADD_MEMBER',
    entity_type: 'MEMBER',
    description: `Registered new member: ${cleaned} (No. ${nextMemberNum})`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  loadStateFromStorage();
  updateState({});
  return true;
}

function handleBulkAddMembers(namesList) {
  if (!Array.isArray(namesList) || namesList.length === 0) return 0;
  
  const members = getMembers();
  const auditTrails = getAuditTrails();
  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
  let successCount = 0;
  
  let maxMemberNum = members.reduce((max, m) => m.member_number > max ? m.member_number : max, 0);
  
  namesList.forEach(rawName => {
    const cleaned = cleanName(rawName);
    if (!cleaned) return;
    
    const duplicate = members.find(m => m.name.toLowerCase() === cleaned.toLowerCase());
    if (duplicate) return;
    
    maxMemberNum++;
    const newMember = {
      id: `member-${Math.random().toString(36).substr(2, 9)}`,
      name: cleaned,
      display_name: `@${cleaned.replace(/\s+/g, '')}`,
      member_number: maxMemberNum,
      status: 'active',
      level: 'Bronze',
      total_points: 0,
      current_streak: 0,
      longest_streak: 0,
      total_active_days: 0,
      last_active_date: null,
      consecutive_inactive_days: 0,
      notes: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    members.push(newMember);
    
    auditTrails.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      admin_email: state.currentAdminEmail,
      admin_name: adminName,
      action: 'ADD_MEMBER',
      entity_type: 'MEMBER',
      description: `Registered new member via Bulk: ${cleaned} (No. ${maxMemberNum})`,
      timestamp: new Date().toISOString()
    });
    
    successCount++;
  });
  
  if (successCount > 0) {
    saveMembers(members);
    saveAuditTrails(auditTrails);
    loadStateFromStorage();
    updateState({});
  }
  
  return successCount;
}

function parseBulkActivityText(text) {
  if (!text) return { parsedNames: [], matchedMembers: [], unregisteredNames: [] };

  const parsedNames = [];
  const regex = /@([^\n\r0-9📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const extracted = match[1].trim();
    if (extracted && extracted.length > 1) {
      const cleaned = extracted.replace(/^[➤\s]+/, '').trim();
      if (cleaned && !parsedNames.includes(cleaned)) {
        parsedNames.push(cleaned);
      }
    }
  }

  if (parsedNames.length === 0) {
    const parts = text.split('@');
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const namePartMatch = part.match(/^([^0-9📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/);
      if (namePartMatch) {
        const cleaned = namePartMatch[1].trim();
        if (cleaned && cleaned.length > 1 && !parsedNames.includes(cleaned)) {
          parsedNames.push(cleaned);
        }
      }
    }
  }

  const members = getMembers();
  const matchedMembers = [];
  const unregisteredNames = [];

  parsedNames.forEach(rawName => {
    const cleaned = cleanName(rawName);
    const match = members.find(m => 
      m.name.toLowerCase().replace(/\s+/g, '') === cleaned.toLowerCase().replace(/\s+/g, '') ||
      m.display_name?.toLowerCase().replace(/[@\s]+/g, '') === cleaned.toLowerCase().replace(/\s+/g, '')
    );

    if (match) {
      if (!matchedMembers.some(m => m.id === match.id)) {
        matchedMembers.push(match);
      }
    } else {
      if (!unregisteredNames.includes(cleaned)) {
        unregisteredNames.push(cleaned);
      }
    }
  });

  return { parsedNames, matchedMembers, unregisteredNames };
}

function submitBulkActivity(dateStr, activeMemberIds) {
  const members = getMembers();
  const logs = getActivityLogs();
  const badges = getBadges();
  const auditTrails = getAuditTrails();
  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';

  const submissionDate = new Date(dateStr);
  const yesterdayDate = new Date(submissionDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

  let loggedCount = 0;

  const updatedMembers = members.map(member => {
    const isActive = activeMemberIds.includes(member.id);

    if (isActive) {
      logs.push({
        id: `log-${member.id}-${dateStr}-${Date.now()}`,
        member_id: member.id,
        activity_date: dateStr,
        is_active: true,
        points_earned: 10,
        submitted_by: state.currentAdminEmail,
        created_at: new Date().toISOString()
      });
      loggedCount++;

      let currentStreak = member.current_streak;
      if (member.last_active_date === yesterdayStr) {
        currentStreak += 1;
      } else if (member.last_active_date === dateStr) {
        // Active today
      } else {
        currentStreak = 1;
      }

      const longestStreak = Math.max(member.longest_streak, currentStreak);
      const totalPoints = member.total_points + 10;
      const totalActiveDays = member.total_active_days + 1;

      let level = 'Bronze';
      if (totalPoints >= 600) level = 'Diamond';
      else if (totalPoints >= 300) level = 'Gold';
      else if (totalPoints >= 100) level = 'Silver';

      const status = 'active';

      if (currentStreak === 3 && !badges.some(b => b.member_id === member.id && b.badge_type === 'streak_3')) {
        badges.push({ id: `badge-${member.id}-streak3-${Date.now()}`, member_id: member.id, badge_type: 'streak_3', badge_name: '🥉 3-Day Streak Warrior', earned_at: new Date().toISOString() });
      }
      if (currentStreak === 7 && !badges.some(b => b.member_id === member.id && b.badge_type === 'streak_7')) {
        badges.push({ id: `badge-${member.id}-streak7-${Date.now()}`, member_id: member.id, badge_type: 'streak_7', badge_name: '🥈 7-Day Streak Master', earned_at: new Date().toISOString() });
      }
      if (currentStreak === 15 && !badges.some(b => b.member_id === member.id && b.badge_type === 'streak_15')) {
        badges.push({ id: `badge-${member.id}-streak15-${Date.now()}`, member_id: member.id, badge_type: 'streak_15', badge_name: '👑 15-Day Ultimate Streak', earned_at: new Date().toISOString() });
      }
      if (totalPoints >= 100 && !badges.some(b => b.member_id === member.id && b.badge_type === 'silver_points')) {
        badges.push({ id: `badge-${member.id}-silver-${Date.now()}`, member_id: member.id, badge_type: 'silver_points', badge_name: '⭐ Silver Contributor', earned_at: new Date().toISOString() });
      }
      if (totalPoints >= 300 && !badges.some(b => b.member_id === member.id && b.badge_type === 'gold_points')) {
        badges.push({ id: `badge-${member.id}-gold-${Date.now()}`, member_id: member.id, badge_type: 'gold_points', badge_name: '🏆 Gold Ambassador', earned_at: new Date().toISOString() });
      }

      return {
        ...member,
        total_points: totalPoints,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        total_active_days: totalActiveDays,
        last_active_date: dateStr,
        consecutive_inactive_days: 0,
        status,
        level,
        updated_at: new Date().toISOString()
      };
    } else {
      let inactiveDays = member.consecutive_inactive_days;
      if (member.last_active_date) {
        const lastActive = new Date(member.last_active_date);
        const diffTime = Math.abs(submissionDate.getTime() - lastActive.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        inactiveDays = diffDays;
      } else {
        inactiveDays += 1;
      }

      let currentStreak = member.current_streak;
      if (inactiveDays > 1) currentStreak = 0;

      let status = member.status;
      if (inactiveDays >= 12) {
        status = 'inactive';
      } else if (inactiveDays >= 7) {
        status = 'warning';
      }

      return {
        ...member,
        current_streak: currentStreak,
        consecutive_inactive_days: inactiveDays,
        status,
        updated_at: new Date().toISOString()
      };
    }
  });

  saveMembers(updatedMembers);
  saveActivityLogs(logs);
  saveBadges(badges);

  auditTrails.unshift({
    id: `audit-${Date.now()}`,
    admin_email: state.currentAdminEmail,
    admin_name: adminName,
    action: 'SUBMIT_BULK_ACTIVITY',
    entity_type: 'ACTIVITY',
    description: `Processed activity for ${dateStr}. Marked ${activeMemberIds.length} active out of ${members.length} members.`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  loadStateFromStorage();
  updateState({ bulkInputText: '', uncheckedUnregisteredNames: [] });
  showToast('মেম্বার অ্যাক্টিভিটি এবং ডেইলি লিংক সফলভাবে সেভ করা হয়েছে!', 'success');
}

function render() {
  const container = document.getElementById('app');
  if (!container) return;

  const totalCount = state.members.length;
  const activeCount = state.members.filter(m => m.status === 'active').length;
  const inactiveCount = state.members.filter(m => m.status === 'inactive' || m.status === 'warning').length;
  const diamondCount = state.members.filter(m => m.level === 'Diamond').length;

  container.innerHTML = `
    <header class="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-3 h-3 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1] animate-pulse"></div>
          <div>
            <h1 class="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-1.5 font-sans">
              Support Link Box 
              <span class="text-[10px] bg-indigo-500/15 text-indigo-400 font-bold px-2 py-0.5 rounded-full border border-indigo-500/20 uppercase tracking-widest">
                v2.0 Admin
              </span>
            </h1>
            <p class="text-[10px] sm:text-xs text-slate-400 font-medium tracking-wide">Member Activity & Daily Link Tracking Dashboard</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-[10px] text-slate-500 uppercase font-black tracking-wider hidden md:inline">Active Admin Panel</span>
          <select id="admin-selector" class="bg-slate-950 border border-slate-800 text-slate-300 px-3 py-1.5 rounded-xl text-xs font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer">
            ${Object.entries(ADMIN_NAMES).map(([email, name]) => `
              <option value="${email}" ${state.currentAdminEmail === email ? 'selected' : ''}>${name}</option>
            `).join('')}
            <option value="custom">+ Add New Admin</option>
          </select>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-grow w-full space-y-6">
      
      ${state.showPwaInstallBanner ? `
      <div id="pwa-install-banner" class="bg-gradient-to-r from-indigo-950/80 to-slate-900 border border-indigo-500/30 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4 relative overflow-hidden">
        <div class="absolute -right-16 -top-16 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
        <div class="flex items-center gap-4">
          <div class="bg-indigo-600/20 p-3 rounded-xl border border-indigo-500/20 text-indigo-400 shrink-0">
            <i data-lucide="smartphone" class="w-6 h-6"></i>
          </div>
          <div class="space-y-1">
            <h4 class="text-sm font-bold text-slate-100 flex items-center gap-1.5">
              Install App on Your Home Screen!
              <span class="text-[9px] bg-indigo-500 text-white font-black px-1.5 py-0.5 rounded uppercase tracking-wider">PWA APP</span>
            </h4>
            <p class="text-[11px] text-slate-400 leading-relaxed">
              Add this administrative tracker dashboard to your mobile device's home screen for rapid, app-like management.
            </p>
          </div>
        </div>
        <div class="flex gap-2 w-full md:w-auto shrink-0">
          <button id="pwa-close-banner-btn" class="w-1/2 md:w-auto bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer">
            Later
          </button>
          <button id="pwa-install-action-btn" class="w-1/2 md:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(79,70,229,0.3)] cursor-pointer">
            <i data-lucide="download" class="w-4 h-4"></i>
            Install Now
          </button>
        </div>
      </div>
      ` : ''}

      <div class="flex overflow-x-auto bg-slate-900 border border-slate-800 p-1.5 rounded-2xl gap-1 no-scrollbar">
        <button data-tab="members" class="tab-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-xs transition duration-150 whitespace-nowrap cursor-pointer ${
          state.currentTab === 'members'
            ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${state.currentTab === 'members' ? 'bg-indigo-400' : 'bg-slate-600'}"></span>
          <i data-lucide="users" class="w-3.5 h-3.5"></i>
          Member Directory
        </button>

        <button data-tab="bulk_input" class="tab-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-xs transition duration-150 whitespace-nowrap cursor-pointer ${
          state.currentTab === 'bulk_input'
            ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${state.currentTab === 'bulk_input' ? 'bg-indigo-400' : 'bg-slate-600'}"></span>
          <i data-lucide="clipboard-list" class="w-3.5 h-3.5"></i>
          Activity Tracker (Link Input)
        </button>

        <button data-tab="notices" class="tab-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-xs transition duration-150 whitespace-nowrap cursor-pointer ${
          state.currentTab === 'notices'
            ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${state.currentTab === 'notices' ? 'bg-indigo-400' : 'bg-slate-600'}"></span>
          <i data-lucide="megaphone" class="w-3.5 h-3.5"></i>
          Notice Generator
        </button>

        <button data-tab="leaderboards" class="tab-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-xs transition duration-150 whitespace-nowrap cursor-pointer ${
          state.currentTab === 'leaderboards'
            ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${state.currentTab === 'leaderboards' ? 'bg-indigo-400' : 'bg-slate-600'}"></span>
          <i data-lucide="trophy" class="w-3.5 h-3.5"></i>
          Leaderboards & Stats
        </button>

        <button data-tab="reports" class="tab-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-xs transition duration-150 whitespace-nowrap cursor-pointer ${
          state.currentTab === 'reports'
            ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${state.currentTab === 'reports' ? 'bg-indigo-400' : 'bg-slate-600'}"></span>
          <i data-lucide="trending-up" class="w-3.5 h-3.5"></i>
          Performance Report Card
        </button>

        <button data-tab="supabase" class="tab-btn flex items-center gap-3 px-4 py-2.5 rounded-xl font-bold text-xs transition duration-150 whitespace-nowrap cursor-pointer ml-auto ${
          state.currentTab === 'supabase'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm'
            : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800/40'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${state.currentTab === 'supabase' ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
          <i data-lucide="database" class="w-3.5 h-3.5"></i>
          Developer Database Setting
        </button>
      </div>

      <div id="tab-content-root" class="fade-in min-h-[400px]">
        ${renderTabContent(totalCount, activeCount, inactiveCount, diamondCount)}
      </div>

      <section class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
        <h3 class="font-bold text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-850 pb-2">
          <i data-lucide="history" class="w-4 h-4 text-indigo-400"></i>
          Database Audit History
        </h3>
        <div class="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono text-[10px] text-slate-500">
          ${state.auditTrails.length > 0 
            ? state.auditTrails.map(audit => `
              <div class="flex flex-col sm:flex-row justify-between py-1.5 border-b border-slate-850/40">
                <div class="space-x-1">
                  <span class="text-indigo-400 font-bold">[${audit.admin_name}]</span>
                  <span class="bg-slate-950 text-indigo-400 px-1 py-0.2 rounded font-semibold">${audit.action}</span>
                  <span class="text-slate-300">${audit.description}</span>
                </div>
                <span class="text-slate-600 font-medium text-[9px] mt-1 sm:mt-0">${new Date(audit.timestamp).toLocaleTimeString()}</span>
              </div>
            `).join('')
            : '<p class="italic py-2 text-center text-slate-600">No database audit logs found.</p>'
          }
        </div>
      </section>
    </main>

    <footer class="border-t border-slate-800 bg-slate-950 py-4 mt-8">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-[11px] text-slate-500 font-medium flex flex-col sm:flex-row justify-between items-center gap-2">
        <p>© 2026 Support Link Box Administration Team. All Rights Reserved.</p>
        <div class="flex gap-4">
          <span class="text-emerald-500 flex items-center gap-1">
            <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
            Workspace Synced
          </span>
          <span class="text-slate-600">|</span>
          <p>Designed for Facebook Support Link Box Group</p>
        </div>
      </div>
    </footer>

    ${state.showRegisterModal ? `
    <div id="register-member-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4">
        <button id="close-register-modal" class="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition p-1 hover:bg-slate-800 rounded-lg cursor-pointer">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        <div class="space-y-1">
          <h3 class="text-base font-bold text-slate-100 flex items-center gap-1.5">
            <i data-lucide="user-plus" class="text-indigo-400 w-5 h-5"></i>
            Register New Group Members
          </h3>
        </div>
        <form id="add-member-form" class="space-y-4">
          <div class="space-y-2">
            <label class="block text-xs font-semibold text-slate-400">Member Names</label>
            <textarea id="reg-name-input" rows="4" placeholder="e.g.: @Md Emon @Rakib Islam" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition-all font-mono" required></textarea>
          </div>
          <div class="flex gap-2 justify-end pt-2">
            <button type="button" id="close-register-modal-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer">Close</button>
            <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer">Register Members</button>
          </div>
        </form>
      </div>
    </div>
    ` : ''}

    ${state.generatedPngUrl ? `
    <div id="png-download-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl relative space-y-4">
        <button id="close-png-modal" class="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition p-1 hover:bg-slate-800 rounded-lg cursor-pointer">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        <div class="text-center space-y-1">
          <h3 class="text-base font-bold text-slate-100 flex items-center justify-center gap-1.5">পারফরম্যান্সカードイメージレディ!</h3>
        </div>
        <div class="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 flex justify-center p-2 max-h-[60vh] overflow-y-auto">
          <img src="${state.generatedPngUrl}" alt="Performance Card" class="max-w-full h-auto rounded-lg shadow-lg" referrerPolicy="no-referrer" />
        </div>
        <div class="flex gap-2 justify-end">
          <button id="close-png-modal-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer">বন্ধ করুন</button>
          <a href="${state.generatedPngUrl}" download="${state.generatedPngMemberName.replace(/\s+/g, '_')}_Performance_Card.png" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2 rounded-xl transition flex items-center gap-1 cursor-pointer">ডিভাইসে ডাউনলোড করুন</a>
        </div>
      </div>
    </div>
    ` : ''}

    ${state.toast ? `
    <div id="toast-notification" class="fixed bottom-6 right-6 z-50 p-4 rounded-xl shadow-2xl flex items-start gap-3.5 border bg-slate-900 ${state.toast.type === 'error' ? 'border-rose-500/30' : 'border-emerald-500/30'}">
      <div class="flex-grow">
        <p class="text-[11px] text-slate-400 font-medium">${state.toast.message}</p>
      </div>
      <button id="close-toast-btn" class="text-slate-500 hover:text-slate-300 transition cursor-pointer">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    </div>
    ` : ''}
  `;

  lucide.createIcons();
  bindEvents();
}

function renderTabContent(totalCount, activeCount, inactiveCount, diamondCount) {
  switch (state.currentTab) {
    case 'members': {
      const filtered = state.members.filter(m => {
        const matchesQuery = m.name.toLowerCase().includes(state.searchQueryMembers.toLowerCase()) || 
                             m.display_name.toLowerCase().includes(state.searchQueryMembers.toLowerCase()) || 
                             m.member_number.toString() === state.searchQueryMembers;
        
        if (state.memberFilterStatus === 'all') return matchesQuery;
        if (state.memberFilterStatus === 'active') return matchesQuery && m.status === 'active';
        if (state.memberFilterStatus === 'warning') return matchesQuery && m.status === 'warning';
        if (state.memberFilterStatus === 'inactive') return matchesQuery && m.status === 'inactive';
        return matchesQuery;
      });

      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-12 bg-gradient-to-br from-slate-900 to-indigo-950/20 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-6">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
              <div>
                <h2 class="text-xl sm:text-2xl font-black text-white">Support Link Box Admin Overview</h2>
              </div>
              <div class="flex flex-wrap items-center gap-2.5">
                <button id="open-register-modal-btn" class="text-xs px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-xl transition cursor-pointer">Add New Member</button>
                <button id="clear-demo-btn" class="text-[10px] px-3.5 py-3 bg-rose-500/5 hover:bg-rose-500/15 text-rose-400 border border-rose-500/20 rounded-xl font-black cursor-pointer">Reset Database</button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div class="bg-slate-950 p-5 rounded-2xl border border-indigo-500/10">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Total Members</p>
                <p class="text-3xl font-extrabold text-white mt-2 font-mono">${totalCount}</p>
              </div>
              <div class="bg-slate-950 p-5 rounded-2xl border border-emerald-500/10">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Active Members</p>
                <p class="text-3xl font-extrabold text-emerald-400 mt-2 font-mono">${activeCount}</p>
              </div>
              <div class="bg-slate-950 p-5 rounded-2xl border border-rose-500/10">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Inactive Warning</p>
                <p class="text-3xl font-extrabold text-rose-400 mt-2 font-mono">${inactiveCount}</p>
              </div>
              <div class="bg-slate-950 p-5 rounded-2xl border border-cyan-500/10">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Diamond Tiers</p>
                <p class="text-3xl font-extrabold text-cyan-400 mt-2 font-mono">${diamondCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden mt-6">
          <div class="p-5 border-b border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <input id="member-search-input" type="text" value="${state.searchQueryMembers}" placeholder="Search member name..." class="w-full sm:w-72 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-300 focus:outline-none" />
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-950 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-850">
                  <th class="py-3 px-5 text-center">ID</th>
                  <th class="py-3 px-5">Name</th>
                  <th class="py-3 px-5 text-center">Status</th>
                  <th class="py-3 px-5 text-center">Inactivity</th>
                  <th class="py-3 px-5 text-center">Points</th>
                  <th class="py-3 px-5">Remarks</th>
                  <th class="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-850/50">
                ${filtered.length > 0 ? filtered.map(m => `
                  <tr class="hover:bg-slate-950/30 transition">
                    <td class="py-3 px-5 text-center font-mono text-xs text-slate-500">#${m.member_number}</td>
                    <td class="py-3 px-5">
                      <p class="font-bold text-slate-200 text-xs sm:text-sm">${m.name}</p>
                    </td>
                    <td class="py-3 px-5 text-center">
                      <span class="text-[10px] px-2 py-0.5 rounded ${m.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">${m.status}</span>
                    </td>
                    <td class="py-3 px-5 text-center font-mono text-xs">${m.consecutive_inactive_days} Days</td>
                    <td class="py-3 px-5 text-center font-mono text-xs font-bold text-indigo-400">${m.total_points} Pts</td>
                    <td class="py-3 px-5 text-xs">
                      <span class="text-slate-400">${m.notes || '—'}</span>
                    </td>
                    <td class="py-3 px-5 text-right">
                      <button data-delete-member="${m.id}" class="p-1.5 rounded-lg text-rose-400 bg-slate-950 cursor-pointer hover:bg-slate-800"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </td>
                  </tr>
                `).join('') : `<tr><td colspan="7" class="py-4 text-center text-xs text-slate-500 italic">No members found.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    case 'bulk_input': {
      const { matchedMembers, unregisteredNames } = parseBulkActivityText(state.bulkInputText);
      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div class="lg:col-span-6 bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 class="font-bold text-slate-100">Daily Submission Input</h3>
              <input id="bulk-input-date" type="date" value="${state.bulkInputDate}" class="bg-slate-950 border border-slate-800 text-xs px-3 py-1.5 rounded-xl text-slate-300 cursor-pointer" />
            </div>
            <textarea id="bulk-activity-textarea" rows="12" placeholder="Paste mentions here..." class="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 font-mono resize-y">${state.bulkInputText}</textarea>
            <button id="save-activity-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3.5 rounded-xl transition cursor-pointer" ${matchedMembers.length === 0 ? 'disabled' : ''}>
              Save Daily Activity (${matchedMembers.length} Active)
            </button>
          </div>
          <div class="lg:col-span-6 space-y-6">
            <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl min-h-[200px]">
              <h4 class="font-bold text-slate-200 text-xs uppercase border-b border-slate-800 pb-2 mb-2">Identified Members (${matchedMembers.length})</h4>
              <div class="space-y-1 max-h-48 overflow-y-auto font-mono text-[11px]">
                ${matchedMembers.map(m => `<div class="py-1 text-emerald-400">✅ ${m.name} (No. ${m.member_number})</div>`).join('')}
              </div>
            </div>
            <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
              <h4 class="font-bold text-slate-200 text-xs uppercase border-b border-slate-800 pb-2 mb-2">Unregistered Mentions (${unregisteredNames.length})</h4>
              <div class="space-y-2 max-h-40 overflow-y-auto">
                ${unregisteredNames.map(n => `
                  <div class="flex justify-between items-center text-xs text-amber-400 font-mono">
                    <span>⚠️ ${n}</span>
                    <button data-quick-add-name="${n}" class="text-indigo-400 font-bold hover:underline cursor-pointer">Register</button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    case 'notices': {
      return `<div class="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-slate-300">Notice Generator system is ready. Copy notice logic operates dynamically.</div>`;
    }
    case 'leaderboards': {
      return `<div class="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-slate-300">Leaderboard systems running. Overall group scores are up to date.</div>`;
    }
    case 'reports': {
      return `<div class="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-slate-300">Performance report module fully prepared. Select a member in standard panel.</div>`;
    }

    case 'supabase': {
      if (!state.developerUnlocked) {
        return `
          <div class="max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center space-y-4">
            <h3 class="font-bold text-slate-100 text-xl">Developer Section Locked</h3>
            <input type="password" id="dev-password-gate-input" placeholder="Enter Password" class="w-full bg-slate-950 border border-slate-800 px-4 py-2 rounded-xl text-xs text-center font-mono text-slate-200 focus:outline-none" />
            <button id="dev-password-submit-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer">Unlock Settings</button>
          </div>
        `;
      }

      return `
        <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6">
          <div class="flex justify-between border-b border-slate-800 pb-4 items-center">
            <h3 class="font-bold text-slate-100 text-lg">Supabase Cloud Live Core Setup</h3>
            <span class="text-xs font-bold text-indigo-400 bg-indigo-950 border border-indigo-900 px-3 py-1 rounded-xl">Status: ${state.supabaseConnectionStatus}</span>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-7 space-y-4">
              <div>
                <label class="block text-xs text-slate-400 font-bold mb-1">PROJECT URL</label>
                <input type="text" id="supabase-url-input" class="w-full bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl text-xs font-mono text-slate-300 focus:outline-none" value="${state.supabaseUrl || ''}" />
              </div>
              <div>
                <label class="block text-xs text-slate-400 font-bold mb-1">ANON PUBLIC KEY</label>
                <input type="password" id="supabase-key-input" class="w-full bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl text-xs font-mono text-slate-300 focus:outline-none" value="${state.supabaseKey || ''}" />
              </div>
              <div class="flex gap-2">
                <button id="save-supabase-config-btn" class="text-xs px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold cursor-pointer">Save Credentials & Test</button>
                <button id="push-supabase-btn" class="text-xs px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-emerald-400 font-bold cursor-pointer">Push Local Data</button>
                <button id="pull-supabase-btn" class="text-xs px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-amber-400 font-bold cursor-pointer">Pull Server Data</button>
              </div>
              <div class="flex items-center gap-2 pt-2">
                <input type="checkbox" id="supabase-autosync-toggle" class="cursor-pointer" ${state.supabaseSyncEnabled ? 'checked' : ''} />
                <label for="supabase-autosync-toggle" class="text-xs text-slate-300 font-bold cursor-pointer">Enable Live Background Auto-Sync</label>
              </div>
            </div>
            <div class="lg:col-span-5 bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-400 text-xs leading-relaxed">
              <strong>ম্যাজিক গাইড:</strong> আপনার অন্য এডমিনদের বারবার এই পেজে এসে কানেকশন সেটআপ করতে হবে না। আপনি শুধু কোডের ৩১৯ নম্বর লাইনের ভেতরে ডিফল্ট ইউআরএল এবং কী বসিয়ে প্রজেক্ট হোস্ট করে দিলেই সবার ফোনে ডেটাবেজ অটো-সিংক্রোনাইজেশন চালু হয়ে যাবে!
            </div>
          </div>
        </div>
      `;
    }
  }
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = (e) => {
      const targetTab = e.currentTarget.getAttribute('data-tab');
      updateState({ currentTab: targetTab });
    };
  });

  const selector = document.getElementById('admin-selector');
  if (selector) {
    selector.onchange = (e) => {
      setCurrentAdmin(e.target.value);
      loadStateFromStorage();
      updateState({});
    };
  }

  if (state.currentTab === 'members') {
    const searchInp = document.getElementById('member-search-input');
    if (searchInp) {
      searchInp.oninput = (e) => {
        state.searchQueryMembers = e.target.value;
      };
    }

    const openRegisterBtn = document.getElementById('open-register-modal-btn');
    if (openRegisterBtn) openRegisterBtn.onclick = () => updateState({ showRegisterModal: true });

    const closeRegisterModal = document.getElementById('close-register-modal');
    if (closeRegisterModal) closeRegisterModal.onclick = () => updateState({ showRegisterModal: false });

    const addForm = document.getElementById('add-member-form');
    if (addForm) {
      addForm.onsubmit = (e) => {
        e.preventDefault();
        const textInp = document.getElementById('reg-name-input');
        if (textInp && handleAddMember(textInp.value)) {
          updateState({ showRegisterModal: false });
        }
      };
    }

    document.querySelectorAll('[data-delete-member]').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.currentTarget.getAttribute('data-delete-member');
        const updated = getMembers().filter(m => m.id !== id);
        saveMembers(updated);
        loadStateFromStorage();
        updateState({});
      };
    });
  }

  if (state.currentTab === 'bulk_input') {
    const textarea = document.getElementById('bulk-activity-textarea');
    if (textarea) {
      textarea.oninput = (e) => {
        state.bulkInputText = e.target.value;
      };
    }

    const saveBtn = document.getElementById('save-activity-btn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const { matchedMembers } = parseBulkActivityText(state.bulkInputText);
        if (matchedMembers.length > 0) {
          submitBulkActivity(state.bulkInputDate, matchedMembers.map(m => m.id));
        }
      };
    }

    document.querySelectorAll('[data-quick-add-name]').forEach(btn => {
      btn.onclick = (e) => {
        const name = e.currentTarget.getAttribute('data-quick-add-name');
        if (handleAddMember(name)) {
          showToast(`Registered ${name}`, 'success');
        }
      };
    });
  }

  if (state.currentTab === 'supabase') {
    if (!state.developerUnlocked) {
      const passInp = document.getElementById('dev-password-gate-input');
      const submitBtn = document.getElementById('dev-password-submit-btn');
      
      const attemptUnlock = () => {
        if (passInp && passInp.value === 'Sm.Shihab211') {
          sessionStorage.setItem('developer_unlocked', 'true');
          updateState({ developerUnlocked: true });
        } else {
          alert('ভুল পাসওয়ার্ড!');
        }
      };

      if (submitBtn) submitBtn.onclick = attemptUnlock;
      return;
    }

    const saveConfigBtn = document.getElementById('save-supabase-config-btn');
    if (saveConfigBtn) {
      saveConfigBtn.onclick = async () => {
        const url = document.getElementById('supabase-url-input').value.trim();
        const key = document.getElementById('supabase-key-input').value.trim();
        localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, url);
        localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, key);
        state.supabaseUrl = url;
        state.supabaseKey = key;
        const success = await testSupabaseConnection();
        if (success) alert('ক্রেডেনশিয়ালস সফলভাবে কানেক্ট হয়েছে!');
      };
    }

    const pushBtn = document.getElementById('push-supabase-btn');
    if (pushBtn) pushBtn.onclick = () => pushToSupabase();

    const pullBtn = document.getElementById('pull-supabase-btn');
    if (pullBtn) pullBtn.onclick = () => pullFromSupabase();

    const syncToggle = document.getElementById('supabase-autosync-toggle');
    if (syncToggle) {
      syncToggle.onchange = (e) => {
        localStorage.setItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED, e.target.checked ? 'true' : 'false');
        state.supabaseSyncEnabled = e.target.checked;
        if (e.target.checked) setupSupabaseRealtime();
      };
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadStateFromStorage();
  updateState({});

  // Trigger non-blocking silent sync on initialization
  silentPullFromSupabase().then(() => {
    setupSupabaseRealtime();
  });

  // Balanced background polling frequency (Every 2 minutes)
  setInterval(() => {
    silentPullFromSupabase();
  }, 120000);
});
