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
const _scU = ['h', 't', 't', 'p', 's', ':', '/', '/', 'n', 'g', 'a', 'k', 'e', 'a', 'p', 'u', 'v', 'n', 'w', 'f', 'v', 'f', 'o', 'q', 'v', 'i', 'd', 'c', '.', 's', 'u', 'p', 'a', 'b', 'a', 's', 'e', '.', 'c', 'o'].join('');
const _scK = ['s', 'b', '_', 'p', 'u', 'b', 'l', 'i', 's', 'h', 'a', 'b', 'l', 'e', '_', 'U', 'K', 's', '0', 'B', 'a', 'Y', 'R', 'c', 'X', 'v', 'H', 'C', 'V', 'w', 's', 'i', '1', 'Z', 'e', 'N', 'A', '_', 'U', 'y', 'N', 'b', 'W', 'L', 'W', 'C'].join('');

export function getHardcodedUrl() {
  return _scU;
}

export function getHardcodedKey() {
  return _scK;
}

let cachedSupabaseClient = null;
let realtimeChannel = null;

export function getSupabase() {
  if (cachedSupabaseClient) return cachedSupabaseClient;

  const url = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || getHardcodedUrl();
  const key = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || getHardcodedKey();

  if (!url || !key) {
    return null;
  }
  if (!window.supabase) {
    console.warn('Supabase JS library CDN is not loaded yet.');
    return null;
  }
  try {
    cachedSupabaseClient = window.supabase.createClient(url, key);
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
        triggerStateReload(table);
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
        triggerStateReload(table);
      }
    } else if (eventType === 'DELETE') {
      const initialLength = localData.length;
      localData = localData.filter(item => item.id !== oldRecord.id);
      if (localData.length !== initialLength) {
        localStorage.setItem(key, JSON.stringify(localData));
        triggerStateReload(table);
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
    // 1. Try a SELECT to verify connection and table existence
    const { error: selectError } = await client.from('members').select('id').limit(1);
    if (selectError) {
      throw new Error(`Select Test Failed: ${selectError.message}`);
    }

    // 2. Try an INSERT to verify that RLS is not blocking client writes
    const testId = `test-conn-${Date.now()}`;
    const testMember = {
      id: testId,
      name: 'System Test Connection',
      display_name: '@testconn',
      status: 'active',
      level: 'Bronze',
      total_points: 0,
      current_streak: 0,
      longest_streak: 0,
      total_active_days: 0,
      last_active_date: null,
      consecutive_inactive_days: 0,
      notes: 'temp_test_connection_record'
    };

    const { error: insertError } = await client.from('members').insert([testMember]);
    if (insertError) {
      if (insertError.message.includes('row-level security') || insertError.code === '42501') {
        throw new Error(`RLS_BLOCKED: ${insertError.message}`);
      }
      throw new Error(`Insert Test Failed: ${insertError.message}`);
    }

    // 3. Clean up the test row
    await client.from('members').delete().eq('id', testId);

    updateState({ supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
    return true;
  } catch (err) {
    console.error('Supabase Connection Test Error:', err);
    let friendlyError = err.message || 'Connection failed';
    if (err instanceof TypeError || friendlyError.includes('Failed to fetch') || friendlyError.includes('fetch')) {
      friendlyError = 'নেটওয়ার্ক সংযোগ ব্যর্থ হয়েছে! আপনার ইন্টারনেট অথবা প্রোভাইড করা Supabase URL ও Key সঠিক আছে কিনা চেক করুন।';
    } else if (friendlyError.includes('RLS_BLOCKED') || friendlyError.includes('row-level security')) {
      friendlyError = 'RLS_BLOCKED: Row-Level Security is active! RLS-এর কারণে ডাটা আপলোড ব্লক হয়ে আছে।';
    }
    updateState({ 
      supabaseConnectionStatus: 'error', 
      supabaseConnectionError: friendlyError 
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

    // Sync Members
    if (members.length > 0) {
      const { error: mErr } = await client.from('members').upsert(members);
      if (mErr) throw new Error(`Members Sync Error: ${mErr.message}`);
    }
    // Sync Logs
    if (logs.length > 0) {
      const { error: lErr } = await client.from('activity_logs').upsert(logs);
      if (lErr) throw new Error(`Logs Sync Error: ${lErr.message}`);
    }
    // Sync Badges
    if (badges.length > 0) {
      const { error: bErr } = await client.from('badges').upsert(badges);
      if (bErr) throw new Error(`Badges Sync Error: ${bErr.message}`);
    }
    // Sync Audit
    if (auditTrails.length > 0) {
      const { error: aErr } = await client.from('audit_trails').upsert(auditTrails);
      if (aErr) throw new Error(`Audit Sync Error: ${aErr.message}`);
    }

    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
    showToast('অভিনন্দন! লোকাল ব্রাউজারের সমস্ত মেম্বার এবং অ্যাক্টিভিটি ডাটা সফলভাবে Supabase ক্লাউডে আপলোড (Push) করা হয়েছে!', 'success');
    return true;
  } catch (err) {
    console.error(err);
    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'error', supabaseConnectionError: err.message });
    showToast(`ডাটা আপলোড করতে সমস্যা হয়েছে: ${err.message}`, 'error');
    return false;
  }
}

export async function performSmartSync(silent = true) {
  const client = getSupabase();
  if (!client) {
    if (!silent) showToast('অনুগ্রহ করে প্রথমে Supabase URL এবং Key সেট আপ করুন!', 'error');
    return false;
  }
  if (silent && localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return false;

  updateState({ supabaseSyncing: true });
  try {
    // 1. Fetch remote tables in parallel
    let remoteM, remoteL, remoteB, remoteA;
    try {
      [remoteM, remoteL, remoteB, remoteA] = await Promise.all([
        client.from('members').select('*'),
        client.from('activity_logs').select('*'),
        client.from('badges').select('*'),
        client.from('audit_trails').select('*')
      ]);
    } catch (fetchErr) {
      console.error("Network fetch to Supabase failed:", fetchErr);
      throw new Error(`সার্ভারের সাথে সংযোগ ব্যর্থ হয়েছে! আপনার ইন্টারনেট কানেকশন অথবা প্রোভাইড করা Supabase URL ও Key সঠিক আছে কিনা যাচাই করুন।`);
    }

    // Check for any errors (e.g. RLS blocks)
    if (remoteM.error) throw new Error(`Members: ${remoteM.error.message}`);
    if (remoteL.error) throw new Error(`Activity Logs: ${remoteL.error.message}`);
    if (remoteB.error) throw new Error(`Badges: ${remoteB.error.message}`);
    if (remoteA.error) throw new Error(`Audit Trails: ${remoteA.error.message}`);

    const rMembers = remoteM.data || [];
    const rLogs = remoteL.data || [];
    const rBadges = remoteB.data || [];
    const rAudits = remoteA.data || [];

    // Retrieve local data
    const localMembers = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]');
    const localLogs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
    const localBadges = JSON.parse(localStorage.getItem(STORAGE_KEYS.BADGES) || '[]');
    const localAudits = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT) || '[]');

    // CASE A: If remote is COMPLETELY empty, but we have local data, we populate remote with our local data!
    const remoteIsEmpty = (rMembers.length === 0 && rLogs.length === 0 && rBadges.length === 0 && rAudits.length === 0);
    const localHasData = (localMembers.length > 0 || localLogs.length > 0 || localBadges.length > 0 || localAudits.length > 1);

    if (remoteIsEmpty && localHasData) {
      console.log('Smart Sync: Remote database is empty. Auto-pushing local data to populate Cloud...');
      
      const upsertPromises = [];
      if (localMembers.length > 0) upsertPromises.push(client.from('members').upsert(localMembers));
      if (localLogs.length > 0) upsertPromises.push(client.from('activity_logs').upsert(localLogs));
      if (localBadges.length > 0) upsertPromises.push(client.from('badges').upsert(localBadges));
      if (localAudits.length > 0) upsertPromises.push(client.from('audit_trails').upsert(localAudits));

      const results = await Promise.all(upsertPromises);
      for (const res of results) {
        if (res.error) throw new Error(`Auto-Populate Error: ${res.error.message}`);
      }
      
      updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
      if (!silent) {
        showToast('সাফল্য! Supabase ক্লাউড ডাটাবেজ খালি থাকায়, লোকাল ডাটা সফলভাবে ক্লাউডে আপলোড করে ডাটাবেজ সাজানো হয়েছে!', 'success');
      }
      return true;
    }

    // CASE B: General non-destructive Bidirectional Merge
    // 1. Merge Members (Key: id OR normalized name, Tie-breaker: updated_at)
    const mergedMembersMap = new Map(); // id -> member
    const nameToIdMap = new Map(); // normalized_name -> id

    localMembers.forEach(m => {
      if (m && m.id) {
        const normName = getNormalizedName(m.name);
        const existingId = nameToIdMap.get(normName);
        if (existingId) {
          const em = mergedMembersMap.get(existingId);
          const emTime = em.updated_at ? new Date(em.updated_at).getTime() : 0;
          const mTime = m.updated_at ? new Date(m.updated_at).getTime() : 0;
          if (mTime > emTime) {
            mergedMembersMap.delete(existingId);
            mergedMembersMap.set(m.id, {
              ...em,
              ...m,
              total_points: Math.max(em.total_points || 0, m.total_points || 0),
              current_streak: Math.max(em.current_streak || 0, m.current_streak || 0),
              longest_streak: Math.max(em.longest_streak || 0, m.longest_streak || 0),
              total_active_days: Math.max(em.total_active_days || 0, m.total_active_days || 0)
            });
            nameToIdMap.set(normName, m.id);
          } else {
            mergedMembersMap.set(existingId, {
              ...m,
              ...em,
              total_points: Math.max(em.total_points || 0, m.total_points || 0),
              current_streak: Math.max(em.current_streak || 0, m.current_streak || 0),
              longest_streak: Math.max(em.longest_streak || 0, m.longest_streak || 0),
              total_active_days: Math.max(em.total_active_days || 0, m.total_active_days || 0)
            });
          }
        } else {
          mergedMembersMap.set(m.id, m);
          nameToIdMap.set(normName, m.id);
        }
      }
    });

    rMembers.forEach(rm => {
      if (rm && rm.id) {
        const normName = getNormalizedName(rm.name);
        const existingIdByName = nameToIdMap.get(normName);
        const existingIdById = mergedMembersMap.has(rm.id) ? rm.id : null;
        const existingId = existingIdByName || existingIdById;

        if (!existingId) {
          mergedMembersMap.set(rm.id, rm);
          nameToIdMap.set(normName, rm.id);
        } else {
          const em = mergedMembersMap.get(existingId);
          const emTime = em.updated_at ? new Date(em.updated_at).getTime() : 0;
          const rmTime = rm.updated_at ? new Date(rm.updated_at).getTime() : 0;

          if (rmTime > emTime) {
            if (existingId !== rm.id) {
              mergedMembersMap.delete(existingId);
            }
            mergedMembersMap.set(rm.id, {
              ...em,
              ...rm,
              total_points: Math.max(em.total_points || 0, rm.total_points || 0),
              current_streak: Math.max(em.current_streak || 0, rm.current_streak || 0),
              longest_streak: Math.max(em.longest_streak || 0, rm.longest_streak || 0),
              total_active_days: Math.max(em.total_active_days || 0, rm.total_active_days || 0)
            });
            nameToIdMap.set(normName, rm.id);
          } else {
            mergedMembersMap.set(existingId, {
              ...rm,
              ...em,
              total_points: Math.max(em.total_points || 0, rm.total_points || 0),
              current_streak: Math.max(em.current_streak || 0, rm.current_streak || 0),
              longest_streak: Math.max(em.longest_streak || 0, rm.longest_streak || 0),
              total_active_days: Math.max(em.total_active_days || 0, rm.total_active_days || 0)
            });
          }
        }
      }
    });
    const mergedMembersRaw = Array.from(mergedMembersMap.values());
    const mergedMembers = deduplicateMembers(mergedMembersRaw, client);

    // 2. Merge Activity Logs (Key: id)
    const mergedLogsMap = new Map();
    localLogs.forEach(l => { if (l && l.id) mergedLogsMap.set(l.id, l); });
    rLogs.forEach(rl => { if (rl && rl.id) mergedLogsMap.set(rl.id, rl); });
    const mergedLogs = Array.from(mergedLogsMap.values());

    // 3. Merge Badges (Key: id)
    const mergedBadgesMap = new Map();
    localBadges.forEach(b => { if (b && b.id) mergedBadgesMap.set(b.id, b); });
    rBadges.forEach(rb => { if (rb && rb.id) mergedBadgesMap.set(rb.id, rb); });
    const mergedBadges = Array.from(mergedBadgesMap.values());

    // 4. Merge Audit Trails (Key: id)
    const mergedAuditsMap = new Map();
    localAudits.forEach(a => { if (a && a.id) mergedAuditsMap.set(a.id, a); });
    rAudits.forEach(ra => { if (ra && ra.id) mergedAuditsMap.set(ra.id, ra); });
    const mergedAudits = Array.from(mergedAuditsMap.values());

    // Save merged lists to local storage
    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(mergedMembers));
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(mergedLogs));
    localStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify(mergedBadges));
    localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(mergedAudits));

    // Update global state variables
    state.members = mergedMembers;
    state.auditTrails = mergedAudits;

    // Push the merged lists back to Supabase in background to ensure both client and server are fully aligned
    const syncPromises = [];
    if (mergedMembers.length > 0) syncPromises.push(client.from('members').upsert(mergedMembers));
    if (mergedLogs.length > 0) syncPromises.push(client.from('activity_logs').upsert(mergedLogs));
    if (mergedBadges.length > 0) syncPromises.push(client.from('badges').upsert(mergedBadges));
    if (mergedAudits.length > 0) syncPromises.push(client.from('audit_trails').upsert(mergedAudits));

    const syncResults = await Promise.all(syncPromises);
    for (const res of syncResults) {
      if (res.error) {
        console.warn('Background alignment sync warning:', res.error.message);
      }
    }

    loadStateFromStorage();
    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'connected', supabaseConnectionError: '' });
    
    if (!silent) {
      showToast('অভিনন্দন! লোকাল এবং ক্লাউড Supabase ডাটাবেজ সফলভাবে একত্রিত (Merged & Synced) করা হয়েছে!', 'success');
    }
    return true;
  } catch (err) {
    console.error('Smart sync failed:', err);
    let friendlyError = err.message || 'Synchronization failed';
    if (err instanceof TypeError || friendlyError.includes('Failed to fetch') || friendlyError.includes('fetch')) {
      friendlyError = 'সার্ভারের সাথে সংযোগ ব্যর্থ হয়েছে! আপনার ইন্টারনেট অথবা প্রোভাইড করা Supabase URL ও Key সঠিক আছে কিনা যাচাই করুন।';
    }
    updateState({ 
      supabaseSyncing: false, 
      supabaseConnectionStatus: 'error', 
      supabaseConnectionError: friendlyError 
    });
    if (!silent) {
      showToast(`ডাটা সিঙ্ক করতে সমস্যা হয়েছে: ${friendlyError}`, 'error');
    }
    return false;
  }
}

export async function pullFromSupabase() {
  return performSmartSync(false);
}

export async function silentPullFromSupabase() {
  return performSmartSync(true);
}

// Smart Diff Sync Helpers to make sure changes (updates, deletions, insertions) are written directly to Supabase
export async function syncMembersDiff(newMembers) {
  const client = getSupabase();
  if (!client) return;
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  try {
    const oldMembers = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]');
    
    // Find deleted members
    const newMemberIds = new Set(newMembers.map(m => m.id));
    const deletedMembers = oldMembers.filter(m => m && m.id && !newMemberIds.has(m.id));
    
    for (const dm of deletedMembers) {
      console.log('Online Sync: Deleting member from Supabase:', dm.id, dm.name);
      await client.from('members').delete().eq('id', dm.id);
    }
    
    // Find new or modified members
    const oldMemberMap = new Map(oldMembers.map(m => [m.id, m]));
    const modifiedOrNewMembers = newMembers.filter(nm => {
      const om = oldMemberMap.get(nm.id);
      if (!om) return true; // New member
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
      console.log('Online Sync: Upserting modified/new members to Supabase:', modifiedOrNewMembers.length);
      const { error } = await client.from('members').upsert(modifiedOrNewMembers);
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error syncing members diff with Supabase:', err);
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
      console.log('Online Sync: Deleting log from Supabase:', dl.id);
      await client.from('activity_logs').delete().eq('id', dl.id);
    }
    
    const oldLogIds = new Set(oldLogs.map(l => l.id));
    const addedLogs = newLogs.filter(nl => !oldLogIds.has(nl.id));
    
    if (addedLogs.length > 0) {
      console.log('Online Sync: Upserting added logs to Supabase:', addedLogs.length);
      const { error } = await client.from('activity_logs').upsert(addedLogs);
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error syncing logs diff with Supabase:', err);
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
      console.log('Online Sync: Deleting badge from Supabase:', db.id);
      await client.from('badges').delete().eq('id', db.id);
    }
    
    const oldBadgeIds = new Set(oldBadges.map(b => b.id));
    const addedBadges = newBadges.filter(nb => !oldBadgeIds.has(nb.id));
    
    if (addedBadges.length > 0) {
      console.log('Online Sync: Upserting added badges to Supabase:', addedBadges.length);
      const { error } = await client.from('badges').upsert(addedBadges);
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error syncing badges diff with Supabase:', err);
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
      console.log('Online Sync: Upserting added audit trails to Supabase:', addedAudits.length);
      const { error } = await client.from('audit_trails').upsert(addedAudits);
      if (error) throw error;
    }
  } catch (err) {
    console.error('Error syncing audits diff with Supabase:', err);
  }
}

// Background auto-sync if enabled
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

// Database Initializer
export function initializeDatabase() {
  // Purge legacy demo data if detected to ensure a completely clean start
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
    console.error('Error checking or purging legacy demo database:', e);
  }

  if (!localStorage.getItem(STORAGE_KEYS.MEMBERS)) {
    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify([]));

    // Generate audits
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

// Getters and Setters
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

// Clean and parse names
export function cleanName(name) {
  return name.replace(/^@/, '').trim().replace(/\s+/g, ' ');
}

export function getNormalizedName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/^@/, '')
    .replace(/[\s\u00A0\u200B\u200C\u200D\u200E\u200F\uFEFF]+/g, '')
    .trim();
}

// Extract date in YYYY-MM-DD from raw text
export function detectDateFromText(text) {
  if (!text) return null;
  const dateRegex = /(?:📅|তারিখ|tarikh)?\s*(?::|\s)\s*([0-3]?\d)[-\/\.]([0-1]?\d)[-\/\.](20\d{2}|\d{2})\b/i;
  const match = text.match(dateRegex);
  if (match) {
    let d = parseInt(match[1], 10);
    let m = parseInt(match[2], 10);
    let y = parseInt(match[3], 10);
    if (d > 0 && d <= 31 && m > 0 && m <= 12) {
      if (y < 100) y = 2000 + y;
      const paddedD = String(d).padStart(2, '0');
      const paddedM = String(m).padStart(2, '0');
      return `${y}-${paddedM}-${paddedD}`;
    }
  }

  const simpleDateRegex = /\b([0-3]?\d)[-\/\.]([0-1]?\d)[-\/\.](20\d{2}|\d{2})\b/;
  const simpleMatch = text.match(simpleDateRegex);
  if (simpleMatch) {
    let d = parseInt(simpleMatch[1], 10);
    let m = parseInt(simpleMatch[2], 10);
    let y = parseInt(simpleMatch[3], 10);
    if (d > 0 && d <= 31 && m > 0 && m <= 12) {
      if (y < 100) y = 2000 + y;
      const paddedD = String(d).padStart(2, '0');
      const paddedM = String(m).padStart(2, '0');
      return `${y}-${paddedM}-${paddedD}`;
    }
  }
  return null;
}

// Safely compute yesterday's date string in YYYY-MM-DD format (timezone-proof)
export function getYesterdayDateStr(dateStr) {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const dateObj = new Date(y, m, d - 1);
  const ry = dateObj.getFullYear();
  const rm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const rd = String(dateObj.getDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

// Safely compute day difference between two YYYY-MM-DD strings (timezone-proof)
export function getDiffDays(dateStr1, dateStr2) {
  const p1 = dateStr1.split('-').map(Number);
  const p2 = dateStr2.split('-').map(Number);
  const d1 = new Date(p1[0], p1[1] - 1, p1[2]);
  const d2 = new Date(p2[0], p2[1] - 1, p2[2]);
  const diffTime = Math.abs(d1.getTime() - d2.getTime());
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

export function dataURLtoBlob(dataurl) {
  try {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error('Failed to convert data URL to Blob:', e);
    return null;
  }
}

export function deduplicateMembers(members, client = null) {
  const uniqueMembers = [];
  const seenNormalizedNames = new Set();
  const duplicatesToDelete = [];

  // Sort members so that the one with higher points or more recent update comes first
  const sorted = [...members].sort((a, b) => {
    const pointsDiff = (b.total_points || 0) - (a.total_points || 0);
    if (pointsDiff !== 0) return pointsDiff;
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bTime - aTime;
  });

  sorted.forEach(m => {
    const norm = getNormalizedName(m.name);
    if (!norm) return;
    if (seenNormalizedNames.has(norm)) {
      duplicatesToDelete.push(m);
    } else {
      seenNormalizedNames.add(norm);
      uniqueMembers.push(m);
    }
  });

  if (duplicatesToDelete.length > 0) {
    console.log(`Deduplicating: found ${duplicatesToDelete.length} duplicate names to clean up.`, duplicatesToDelete.map(d => d.name));
    
    // For each duplicate, map its ID to the surviving ID
    const idMap = new Map(); // deleted_id -> surviving_id
    sorted.forEach(m => {
      const norm = getNormalizedName(m.name);
      const survivor = uniqueMembers.find(u => getNormalizedName(u.name) === norm);
      if (survivor && survivor.id !== m.id) {
        idMap.set(m.id, survivor.id);
      }
    });

    // Update local logs and badges
    const logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
    let logsUpdated = false;
    logs.forEach(l => {
      if (idMap.has(l.member_id)) {
        l.member_id = idMap.get(l.member_id);
        l.updated_at = new Date().toISOString();
        logsUpdated = true;
      }
    });
    if (logsUpdated) {
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(logs));
    }

    const badges = JSON.parse(localStorage.getItem(STORAGE_KEYS.BADGES) || '[]');
    let badgesUpdated = false;
    badges.forEach(b => {
      if (idMap.has(b.member_id)) {
        b.member_id = idMap.get(b.member_id);
        b.updated_at = new Date().toISOString();
        badgesUpdated = true;
      }
    });
    if (badgesUpdated) {
      localStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify(badges));
    }

    // Remote delete and update
    if (client) {
      const ids = duplicatesToDelete.map(d => d.id);
      client.from('members').delete().in('id', ids).then(({ error }) => {
        if (error) console.error('Failed to remote-delete duplicate members:', error);
      });

      const logsToUpsert = logs.filter(l => idMap.has(l.member_id));
      if (logsToUpsert.length > 0) {
        client.from('activity_logs').upsert(logsToUpsert).then(({ error }) => {
          if (error) console.error('Failed to align remote logs after deduplication:', error);
        });
      }

      const badgesToUpsert = badges.filter(b => idMap.has(b.member_id));
      if (badgesToUpsert.length > 0) {
        client.from('badges').upsert(badgesToUpsert).then(({ error }) => {
          if (error) console.error('Failed to align remote badges after deduplication:', error);
        });
      }
    }
  }

  return uniqueMembers;
}

// PWA Installer global state
let deferredPrompt = null;

// State Machine
let state = {
  currentTab: 'leaderboards',
  isFabOpen: false,
  isHeaderMenuOpen: false,
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
  supabaseUrl: localStorage.getItem('support_linkbox_supabase_url') || getHardcodedUrl(),
  supabaseKey: localStorage.getItem('support_linkbox_supabase_key') || getHardcodedKey(),
  supabaseSyncEnabled: localStorage.getItem('support_linkbox_supabase_sync_enabled') !== 'false',
  supabaseConnectionStatus: 'idle',
  supabaseConnectionError: '',
  supabaseSyncing: false,
  loadedFromEnv: !localStorage.getItem('support_linkbox_supabase_url') && !localStorage.getItem('support_linkbox_supabase_key'),
  showUrlInput: false,
  showKeyInput: false,
  uncheckedUnregisteredNames: [],
  developerUnlocked: typeof sessionStorage !== 'undefined' && sessionStorage.getItem('developer_unlocked') === 'true',
  toast: null,
  confirmModal: null
};

// Auto-extract URL query params and secrets
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
      // Clean query params to hide credentials from address bar immediately
      urlObj.searchParams.delete('supabase_url');
      urlObj.searchParams.delete('supabase_key');
      urlObj.searchParams.delete('url');
      urlObj.searchParams.delete('key');
      window.history.replaceState({}, document.title, urlObj.pathname + urlObj.search);
      
      state.supabaseUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || getHardcodedUrl();
      state.supabaseKey = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || getHardcodedKey();
    }
  } catch (e) {
    console.error('Error parsing URL query parameters for Supabase configuration:', e);
  }

  if (!state.supabaseUrl) {
    state.supabaseUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || getHardcodedUrl();
  }
  if (!state.supabaseKey) {
    state.supabaseKey = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || getHardcodedKey();
  }
  state.loadedFromEnv = !localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) && !localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY);
}

// Load initial database records into State
function loadStateFromStorage() {
  initializeDatabase();
  initSupabaseConfig();
  
  const rawLocalMembers = getMembers();
  const supabaseClient = getSupabase();
  const cleanedMembers = deduplicateMembers(rawLocalMembers, supabaseClient);
  if (cleanedMembers.length !== rawLocalMembers.length) {
    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(cleanedMembers));
  }
  
  state.members = cleanedMembers;
  state.auditTrails = getAuditTrails();
  state.currentAdminEmail = getCurrentAdmin();
  
  if (state.supabaseUrl && state.supabaseKey) {
    // Non-blocking background check
    setTimeout(() => {
      testSupabaseConnection();
    }, 500);
  }
}

// Custom Toast System
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

// Custom Modal Alert & Confirmation Dialog System
export function showAlert(message, title = 'সতর্কতা', onOk = null) {
  updateState({
    confirmModal: {
      title,
      message,
      onConfirm: () => {
        updateState({ confirmModal: null });
        if (onOk) onOk();
      },
      onCancel: () => {
        updateState({ confirmModal: null });
        if (onOk) onOk();
      },
      confirmText: 'ঠিক আছে',
      cancelText: '' // Empty means alert modal (no cancel button)
    }
  });
}

export function showConfirm(message, onConfirm, onCancel = null, title = 'অনুমোদন দিন', confirmText = 'নিশ্চিত করুন', cancelText = 'বাতিল') {
  updateState({
    confirmModal: {
      title,
      message,
      onConfirm: () => {
        updateState({ confirmModal: null });
        if (onConfirm) onConfirm();
      },
      onCancel: () => {
        updateState({ confirmModal: null });
        if (onCancel) onCancel();
      },
      confirmText,
      cancelText
    }
  });
}

// Unified State Mutator & Render Trigger
function updateState(newState) {
  state = { ...state, ...newState };
  render();
}

// Add Member Business Logic
function handleAddMember(rawName, notes = '') {
  const cleaned = cleanName(rawName);
  if (!cleaned) {
    showToast('মেম্বার এর নাম ফাকা হতে পারে না!', 'error');
    return false;
  }

  const members = getMembers();
  const duplicate = members.find(m => getNormalizedName(m.name) === getNormalizedName(cleaned));
  if (duplicate) {
    showAlert(`এই নামের অন্য লোক আছে! অনুগ্রহ করে নামের শেষে '1', '2' বা 'A', 'B' কিছু লাগিয়ে দিন (যেমন: ${cleaned} A)`, 'ডুপ্লিকেট মেম্বার');
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

  // Add audit trail
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

// Bulk Add Members Business Logic
function handleBulkAddMembers(namesList) {
  if (!Array.isArray(namesList) || namesList.length === 0) {
    return { successCount: 0, duplicateNames: [], totalAttempted: 0 };
  }
  
  const members = getMembers();
  const auditTrails = getAuditTrails();
  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
  let successCount = 0;
  const duplicateNames = [];
  
  let maxMemberNum = members.reduce((max, m) => m.member_number > max ? m.member_number : max, 0);
  
  namesList.forEach(rawName => {
    const cleaned = cleanName(rawName);
    if (!cleaned) return;
    
    const duplicate = members.find(m => getNormalizedName(m.name) === getNormalizedName(cleaned));
    if (duplicate) {
      if (!duplicateNames.includes(cleaned)) {
        duplicateNames.push(cleaned);
      }
      return;
    }
    
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
  
  return { successCount, duplicateNames, totalAttempted: namesList.length };
}

// Bulk text mentions extractor
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

  // Fallback split manually if regex matched nothing
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
    const match = members.find(m => {
      const normMName = getNormalizedName(m.name);
      const normMDisplayName = getNormalizedName(m.display_name || '');
      const normCleaned = getNormalizedName(cleaned);
      return normMName === normCleaned || normMDisplayName === normCleaned;
    });

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

// Save Daily Submissions
function submitBulkActivity(dateStr, activeMemberIds) {
  const members = getMembers();
  const logs = getActivityLogs();
  
  // Prevent duplicate submissions on the same date
  const duplicateLog = logs.find(l => l.activity_date === dateStr && l.is_active);
  if (duplicateLog) {
    showAlert(`এই তারিখে (${dateStr}) ইতিমধ্যে এক্টিভিটি লিস্ট সাবমিট করা হয়েছে! একই তারিখে একাধিক লিস্ট সাবমিট করা যাবে না।`, 'ডুপ্লিকেট তারিখ');
    return;
  }

  const badges = getBadges();
  const auditTrails = getAuditTrails();
  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';

  const yesterdayStr = getYesterdayDateStr(dateStr);

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
        // Active today, streak stays
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

      // Badge checks
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
        inactiveDays = getDiffDays(dateStr, member.last_active_date);
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

// Global Render loop matching current Tab
function render() {
  const container = document.getElementById('app');
  if (!container) return;

  // Active overview statistics calculations
  const totalCount = state.members.length;
  const activeCount = state.members.filter(m => m.status === 'active').length;
  const inactiveCount = state.members.filter(m => m.status === 'inactive' || m.status === 'warning').length;
  const diamondCount = state.members.filter(m => m.level === 'Diamond').length;

  container.innerHTML = `
    <!-- Sticky Admin Header Banner -->
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

        <!-- Admin Profile Switcher dropdown -->
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

    <!-- Navigation Tabs Bar -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-grow w-full space-y-6">
      
      ${state.showPwaInstallBanner ? `
      <!-- PWA Installation Banner -->
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

      <div class="sticky top-[73px] z-30 pb-4 pt-2 -mx-4 px-4 sm:mx-0 sm:px-0 bg-slate-950/80 backdrop-blur-lg border-b border-slate-900/50 sm:border-none">
        <div class="max-w-3xl mx-auto bg-slate-900/90 border border-slate-800/80 p-3 sm:p-4 rounded-3xl shadow-[0_16px_40px_rgba(0,0,0,0.6)]">
          <div class="grid grid-cols-5 gap-1.5 sm:gap-4 justify-items-center">
            
            <!-- App Icon 1: Leaderboard -->
            <button data-tab="leaderboards" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'leaderboards'
                  ? 'bg-gradient-to-tr from-amber-500 to-yellow-600 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.45)] ring-2 ring-amber-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-amber-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="trophy" class="w-4 h-4 sm:w-6 sm:h-6"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'leaderboards' ? 'text-amber-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">লিডারবোর্ড</span>
              ${state.currentTab === 'leaderboards' ? '<div class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#fbbf24]"></div>' : ''}
            </button>

            <!-- App Icon 2: Directory -->
            <button data-tab="members" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'members'
                  ? 'bg-gradient-to-tr from-emerald-500 to-teal-600 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.45)] ring-2 ring-emerald-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-emerald-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="users" class="w-4 h-4 sm:w-6 sm:h-6"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'members' ? 'text-emerald-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">ডিরেক্টরি</span>
              ${state.currentTab === 'members' ? '<div class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"></div>' : ''}
            </button>

            <!-- App Icon 3: Link Tracker -->
            <button data-tab="bulk_input" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'bulk_input'
                  ? 'bg-gradient-to-tr from-indigo-500 to-blue-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.45)] ring-2 ring-indigo-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-indigo-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="clipboard-list" class="w-4 h-4 sm:w-6 sm:h-6"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'bulk_input' ? 'text-indigo-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">লিংক ট্র্যাকার</span>
              ${state.currentTab === 'bulk_input' ? '<div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_8px_#818cf8]"></div>' : ''}
            </button>

            <!-- App Icon 4: Notice -->
            <button data-tab="notices" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'notices'
                  ? 'bg-gradient-to-tr from-rose-500 to-orange-600 text-white shadow-[0_0_20px_rgba(244,63,94,0.45)] ring-2 ring-rose-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-rose-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="megaphone" class="w-4 h-4 sm:w-6 sm:h-6"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'notices' ? 'text-rose-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">নোটিশ</span>
              ${state.currentTab === 'notices' ? '<div class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shadow-[0_0_8px_#fb7185]"></div>' : ''}
            </button>

            <!-- App Icon 5: Report Card -->
            <button data-tab="reports" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'reports'
                  ? 'bg-gradient-to-tr from-cyan-500 to-sky-600 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.45)] ring-2 ring-cyan-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-cyan-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="trending-up" class="w-4 h-4 sm:w-6 sm:h-6"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'reports' ? 'text-cyan-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">রিপোর্ট কার্ড</span>
              ${state.currentTab === 'reports' ? '<div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]"></div>' : ''}
            </button>

          </div>
        </div>
      </div>


      <!-- Main Tab Content Render Target -->
      <div id="tab-content-root" class="fade-in min-h-[400px]">
        ${renderTabContent(totalCount, activeCount, inactiveCount, diamondCount)}
      </div>

      <!-- Persistent Admin Audit Trail Log -->
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

    <!-- Standard Footer -->
    <footer class="border-t border-slate-800 bg-slate-950 py-4 mt-8">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-[11px] text-slate-500 font-medium flex flex-col sm:flex-row justify-between items-center gap-2">
        <p>© ${new Date().getFullYear()} Support Link Box Administration Team. All Rights Reserved.</p>
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

    <!-- Floating Action Menu (FAB / App Icon Launcher) -->
    <div class="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      ${state.isFabOpen ? `
      <!-- Animated Expanded Circular/List Navigation Options -->
      <div class="flex flex-col items-end gap-2.5 mb-2 animate-[slideUp_0.2s_ease-out_forwards]">
        
        <div class="text-[9px] bg-slate-950 border border-slate-800 text-slate-400 font-bold px-2 py-1 rounded-lg uppercase tracking-wider mb-1">
          Quick Sections
        </div>

        <button data-tab="leaderboards" class="tab-btn flex items-center gap-2.5 bg-slate-950/95 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 px-4 py-2.5 rounded-2xl shadow-xl transition-all hover:translate-x-[-4px] group cursor-pointer ${
          state.currentTab === 'leaderboards' ? 'border-indigo-500 text-indigo-400 bg-indigo-950/20' : ''
        }">
          <span class="text-xs font-bold text-slate-300 group-hover:text-white transition">লিডারবোর্ড (Leaderboards)</span>
          <div class="bg-indigo-950/40 p-1.5 rounded-lg text-indigo-400 group-hover:bg-indigo-600/20 transition border border-indigo-500/10">
            <i data-lucide="trophy" class="w-4 h-4"></i>
          </div>
        </button>

        <button data-tab="members" class="tab-btn flex items-center gap-2.5 bg-slate-950/95 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 px-4 py-2.5 rounded-2xl shadow-xl transition-all hover:translate-x-[-4px] group cursor-pointer ${
          state.currentTab === 'members' ? 'border-indigo-500 text-indigo-400 bg-indigo-950/20' : ''
        }">
          <span class="text-xs font-bold text-slate-300 group-hover:text-white transition">মেম্বার ডিরেক্টরি (Members)</span>
          <div class="bg-indigo-950/40 p-1.5 rounded-lg text-indigo-400 group-hover:bg-indigo-600/20 transition border border-indigo-500/10">
            <i data-lucide="users" class="w-4 h-4"></i>
          </div>
        </button>

        <button data-tab="bulk_input" class="tab-btn flex items-center gap-2.5 bg-slate-950/95 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 px-4 py-2.5 rounded-2xl shadow-xl transition-all hover:translate-x-[-4px] group cursor-pointer ${
          state.currentTab === 'bulk_input' ? 'border-indigo-500 text-indigo-400 bg-indigo-950/20' : ''
        }">
          <span class="text-xs font-bold text-slate-300 group-hover:text-white transition">লিংক ট্র্যাকার (Activity Tracker)</span>
          <div class="bg-indigo-950/40 p-1.5 rounded-lg text-indigo-400 group-hover:bg-indigo-600/20 transition border border-indigo-500/10">
            <i data-lucide="clipboard-list" class="w-4 h-4"></i>
          </div>
        </button>

        <button data-tab="notices" class="tab-btn flex items-center gap-2.5 bg-slate-950/95 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 px-4 py-2.5 rounded-2xl shadow-xl transition-all hover:translate-x-[-4px] group cursor-pointer ${
          state.currentTab === 'notices' ? 'border-indigo-500 text-indigo-400 bg-indigo-950/20' : ''
        }">
          <span class="text-xs font-bold text-slate-300 group-hover:text-white transition">নোটিশ জেনারেটর (Notice)</span>
          <div class="bg-indigo-950/40 p-1.5 rounded-lg text-indigo-400 group-hover:bg-indigo-600/20 transition border border-indigo-500/10">
            <i data-lucide="megaphone" class="w-4 h-4"></i>
          </div>
        </button>

        <button data-tab="reports" class="tab-btn flex items-center gap-2.5 bg-slate-950/95 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 px-4 py-2.5 rounded-2xl shadow-xl transition-all hover:translate-x-[-4px] group cursor-pointer ${
          state.currentTab === 'reports' ? 'border-indigo-500 text-indigo-400 bg-indigo-950/20' : ''
        }">
          <span class="text-xs font-bold text-slate-300 group-hover:text-white transition">রিপোর্ট কার্ড (Report Card)</span>
          <div class="bg-indigo-950/40 p-1.5 rounded-lg text-indigo-400 group-hover:bg-indigo-600/20 transition border border-indigo-500/10">
            <i data-lucide="trending-up" class="w-4 h-4"></i>
          </div>
        </button>
      </div>
      ` : ''}

      <!-- Main Floating App Icon Button -->
      <button id="floating-menu-trigger" class="w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center text-white shadow-[0_4px_24px_rgba(99,102,241,0.5)] transition-all duration-300 transform hover:scale-105 active:scale-95 cursor-pointer border border-indigo-400/30 relative overflow-hidden group">
        <span class="absolute inset-0 bg-gradient-to-tr from-indigo-700 via-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></span>
        <div class="relative transition-transform duration-300 ${state.isFabOpen ? 'rotate-90' : 'rotate-0'}">
          ${state.isFabOpen 
            ? '<i data-lucide="x" class="w-6 h-6"></i>' 
            : '<i data-lucide="layout-grid" class="w-6 h-6"></i>'
          }
        </div>
      </button>
    </div>

    ${state.showRegisterModal ? `
    <div id="register-member-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4">
        <!-- Close button -->
        <button id="close-register-modal" class="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition p-1 hover:bg-slate-800 rounded-lg cursor-pointer">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>

        <div class="space-y-1">
          <h3 class="text-base font-bold text-slate-100 flex items-center gap-1.5">
            <i data-lucide="user-plus" class="text-indigo-400 w-5 h-5"></i>
            Register New Group Members
          </h3>
          <p class="text-[11px] text-slate-400">
            Add Facebook group members to track link submissions. Supports batch entries.
          </p>
        </div>

        <form id="add-member-form" class="space-y-4">
          <div class="space-y-2">
            <label class="block text-xs font-semibold text-slate-400">Member Names (Single or Multiple @mentions)</label>
            <textarea id="reg-name-input" rows="4" placeholder="e.g.: @Md Emon or multiple: @Md Emon @Rakib Islam @Kobir Khan" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition-all font-mono" required></textarea>
            <div class="text-[10px] text-indigo-400 font-semibold bg-indigo-950/30 p-2.5 rounded-lg border border-indigo-500/20 leading-relaxed">
              <span class="text-indigo-300 font-bold">Input Format:</span> <code class="bg-slate-950 px-1 py-0.5 rounded text-indigo-300 font-mono">@MemberNameOne @MemberNameTwo</code>
            </div>
          </div>

          <div class="flex gap-2 justify-end pt-2">
            <button type="button" id="close-register-modal-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer">
              Close
            </button>
            <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition flex items-center gap-1.5 shadow-[0_4px_12px_rgba(79,70,229,0.3)] cursor-pointer">
              <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
              Register Members
            </button>
          </div>
        </form>
      </div>
    </div>
    ` : ''}

    ${state.generatedPngUrl ? `
    <div id="png-download-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl relative space-y-4">
        <!-- Close button -->
        <button id="close-png-modal" class="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition p-1 hover:bg-slate-800 rounded-lg cursor-pointer">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>

        <div class="text-center space-y-1">
          <h3 class="text-base font-bold text-slate-100 flex items-center justify-center gap-1.5">
            <i data-lucide="image" class="text-indigo-400 w-5 h-5"></i>
            পারফরম্যান্স কার্ড ইমেজ রেডি!
          </h3>
          <p class="text-[11px] text-slate-400">
            মোবাইল বা আইফোনে অটোমেটিক ডাউনলোড শুরু না হলে নিচের ছবিতে কিছুক্ষণ চেপে ধরে রাখুন (Long Press) এবং <b>"Save Image"</b> বা <b>"Download Image"</b> সিলেক্ট করুন।
          </p>
        </div>

        <!-- Rendered Image -->
        <div class="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 flex justify-center p-2 max-h-[60vh] overflow-y-auto">
          <img src="${state.generatedPngUrl}" alt="Performance Card" class="max-w-full h-auto rounded-lg shadow-lg border border-slate-800" referrerPolicy="no-referrer" />
        </div>

        <div class="flex gap-2 justify-end">
          <button id="close-png-modal-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer">
            বন্ধ করুন
          </button>
          <a href="${state.generatedPngUrl}" download="${state.generatedPngMemberName.replace(/\s+/g, '_')}_Performance_Card.png" id="direct-download-png-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2 rounded-xl transition flex items-center gap-1 cursor-pointer">
            <i data-lucide="download" class="w-3.5 h-3.5"></i>
            ডিভাইসে ডাউনলোড করুন
          </a>
        </div>
      </div>
    </div>
    ` : ''}

    ${state.toast ? `
    <!-- Floating Toast Notification -->
    <div id="toast-notification" class="fixed bottom-6 right-6 z-50 transform translate-y-0 opacity-100 transition-all duration-300 max-w-sm w-full bg-slate-900 border ${
      state.toast.type === 'error' ? 'border-rose-500/30 shadow-rose-950/20' :
      state.toast.type === 'info' ? 'border-indigo-500/30 shadow-indigo-950/20' :
      'border-emerald-500/30 shadow-emerald-950/20'
    } p-4 rounded-xl shadow-2xl flex items-start gap-3.5 backdrop-blur-md animate-bounce-subtle">
      <div class="p-2 rounded-lg ${
        state.toast.type === 'error' ? 'bg-rose-500/10 text-rose-400' :
        state.toast.type === 'info' ? 'bg-indigo-500/10 text-indigo-400' :
        'bg-emerald-500/10 text-emerald-400'
      }">
        <i data-lucide="${
          state.toast.type === 'error' ? 'alert-triangle' :
          state.toast.type === 'info' ? 'info' :
          'check-circle'
        }" class="w-5 h-5"></i>
      </div>
      <div class="flex-grow space-y-0.5">
        <h4 class="text-xs font-black text-slate-100">
          ${
            state.toast.type === 'error' ? 'ব্যর্থ হয়েছে' :
            state.toast.type === 'info' ? 'তথ্য' :
            'সফল হয়েছে'
          }
        </h4>
        <p class="text-[11px] text-slate-400 font-medium leading-relaxed">${state.toast.message}</p>
      </div>
      <button id="close-toast-btn" class="text-slate-500 hover:text-slate-300 transition shrink-0 cursor-pointer">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    </div>
    ` : ''}

    ${state.confirmModal ? `
    <!-- Custom beautiful confirmation modal -->
    <div id="custom-confirm-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl relative space-y-4 animate-scale-in">
        <div class="flex items-center gap-3 text-indigo-400">
          <i data-lucide="help-circle" class="w-6 h-6"></i>
          <h3 class="font-extrabold text-slate-100 text-xs tracking-wide uppercase">${state.confirmModal.title || 'অনুমোদন দিন'}</h3>
        </div>
        <p class="text-[11px] text-slate-300 font-medium leading-relaxed">${state.confirmModal.message}</p>
        <div class="flex justify-end gap-3 pt-2">
          ${state.confirmModal.cancelText ? `
            <button id="custom-confirm-cancel-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px] px-4 py-2 rounded-xl transition cursor-pointer">
              ${state.confirmModal.cancelText}
            </button>
          ` : ''}
          <button id="custom-confirm-ok-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[10px] px-5 py-2 rounded-xl shadow-lg transition cursor-pointer">
            ${state.confirmModal.confirmText || 'নিশ্চিত করুন'}
          </button>
        </div>
      </div>
    </div>
    ` : ''}
  `;

  // Hot Reload Icons
  lucide.createIcons();
  
  // Bind dynamic interactive events
  bindEvents();
}

// Sub-Tab HTML Render templates
function renderTabContent(totalCount, activeCount, inactiveCount, diamondCount) {
  switch (state.currentTab) {
    
    // TAB: MEMBERS
    case 'members': {
      // Search and Filter records
      const filtered = state.members.filter(m => {
        const queryCleaned = state.searchQueryMembers.trim().toLowerCase().replace(/^#/, '');
        const matchesQuery = !state.searchQueryMembers ? true : (
          m.name.toLowerCase().includes(state.searchQueryMembers.toLowerCase()) || 
          (m.display_name && m.display_name.toLowerCase().includes(state.searchQueryMembers.toLowerCase())) || 
          m.member_number.toString().includes(queryCleaned)
        );
        
        if (state.memberFilterStatus === 'all') return matchesQuery;
        if (state.memberFilterStatus === 'active') return matchesQuery && m.status === 'active';
        if (state.memberFilterStatus === 'warning') return matchesQuery && m.status === 'warning';
        if (state.memberFilterStatus === 'inactive') return matchesQuery && m.status === 'inactive';
        if (state.memberFilterStatus === 'diamond') return matchesQuery && m.level === 'Diamond';
        if (state.memberFilterStatus === 'gold') return matchesQuery && m.level === 'Gold';
        if (state.memberFilterStatus === 'silver') return matchesQuery && m.level === 'Silver';
        if (state.memberFilterStatus === 'bronze') return matchesQuery && m.level === 'Bronze';
        return matchesQuery;
      });

      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- Main Welcome Dashboard Overview -->
          <div class="lg:col-span-12 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/20 border border-slate-800 p-6 sm:p-8 rounded-2xl shadow-xl relative overflow-hidden space-y-6">
            <div class="absolute right-0 top-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <div class="absolute -left-10 -bottom-10 w-60 h-60 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>
            
            <div class="relative z-10">
              <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
                <div class="space-y-1.5">
                  <div class="flex items-center gap-2">
                    <span class="flex h-2 w-2 relative">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span class="text-[9px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                      Live Database Tracker
                    </span>
                  </div>
                  <h2 class="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                    <i data-lucide="sparkles" class="w-5 h-5 text-indigo-400"></i>
                    Support Link Box Admin Overview
                  </h2>
                  <p class="text-xs text-slate-400 max-w-3xl leading-relaxed">
                    Central control panel for daily link submissions, member activity audit trails, warning notice generators, and performance diagnostics.
                  </p>
                </div>
                
                <div class="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button id="open-register-modal-btn" class="text-xs px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-xl flex items-center gap-2 transition duration-200 shadow-[0_4px_14px_rgba(79,70,229,0.35)] cursor-pointer hover:scale-[1.02]">
                    <i data-lucide="user-plus" class="w-4 h-4"></i>
                    Add New Member
                  </button>
                  <button id="clear-demo-btn" class="text-[10px] px-3.5 py-3 bg-rose-500/5 hover:bg-rose-500/15 text-rose-400 border border-rose-500/20 rounded-xl font-black uppercase tracking-wider flex items-center gap-1.5 transition duration-200 cursor-pointer">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    Reset & Clear Demo
                  </button>
                </div>
              </div>
            </div>

            <!-- Beautifully styled modern stats cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
              <!-- Total Members -->
              <div class="bg-gradient-to-br from-slate-950 to-slate-900 p-5 rounded-2xl border border-indigo-500/10 text-left relative overflow-hidden group hover:border-indigo-500/30 transition duration-300">
                <div class="absolute -right-6 -bottom-6 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl group-hover:bg-indigo-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Members</span>
                  <div class="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <i data-lucide="users" class="w-4 h-4"></i>
                  </div>
                </div>
                <div class="mt-4 flex items-baseline gap-2">
                  <p class="text-3xl font-extrabold text-white tracking-tight font-mono">${totalCount}</p>
                  <span class="text-[10px] text-slate-500 font-medium font-bold">Members</span>
                </div>
              </div>

              <!-- Active Members -->
              <div class="bg-gradient-to-br from-slate-950 to-slate-900 p-5 rounded-2xl border border-emerald-500/10 text-left relative overflow-hidden group hover:border-emerald-500/30 transition duration-300">
                <div class="absolute -right-6 -bottom-6 w-20 h-20 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Members</span>
                  <div class="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <i data-lucide="shield-check" class="w-4 h-4"></i>
                  </div>
                </div>
                <div class="mt-4 flex items-baseline gap-2">
                  <p class="text-3xl font-extrabold text-emerald-400 tracking-tight font-mono">${activeCount}</p>
                  <span class="text-[10px] text-slate-500 font-medium font-bold">Active</span>
                </div>
              </div>

              <!-- Inactive Members -->
              <div class="bg-gradient-to-br from-slate-950 to-slate-900 p-5 rounded-2xl border border-rose-500/10 text-left relative overflow-hidden group hover:border-rose-500/30 transition duration-300">
                <div class="absolute -right-6 -bottom-6 w-20 h-20 bg-rose-500/5 rounded-full blur-xl group-hover:bg-rose-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inactive (⚠️ Warning)</span>
                  <div class="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400">
                    <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                  </div>
                </div>
                <div class="mt-4 flex items-baseline gap-2">
                  <p class="text-3xl font-extrabold text-rose-400 tracking-tight font-mono">${inactiveCount}</p>
                  <span class="text-[10px] text-slate-500 font-medium font-bold">Inactive</span>
                </div>
              </div>

              <!-- Diamond Tiers -->
              <div class="bg-gradient-to-br from-slate-950 to-slate-900 p-5 rounded-2xl border border-cyan-500/10 text-left relative overflow-hidden group hover:border-cyan-500/30 transition duration-300">
                <div class="absolute -right-6 -bottom-6 w-20 h-20 bg-cyan-500/5 rounded-full blur-xl group-hover:bg-cyan-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Diamond Tiers</span>
                  <div class="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <i data-lucide="gem" class="w-4 h-4"></i>
                  </div>
                </div>
                <div class="mt-4 flex items-baseline gap-2">
                  <p class="text-3xl font-extrabold text-cyan-400 tracking-tight font-mono">${diamondCount}</p>
                  <span class="text-[10px] text-slate-500 font-medium font-bold">💎 Diamond</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Main Member Table and Search Lists -->
        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden mt-6">
          <div class="p-5 border-b border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div class="relative w-full sm:w-72">
              <i data-lucide="search" class="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
              <input id="member-search-input" type="text" value="${state.searchQueryMembers}" placeholder="Search member name or number..." class="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-700" />
            </div>

            <!-- Filters list options -->
            <div class="flex overflow-x-auto gap-1.5 w-full sm:w-auto pb-1 sm:pb-0 no-scrollbar">
              ${[
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'warning', label: 'Warning (7+ Days)' },
                { id: 'inactive', label: 'Inactive (12+ Days)' },
                { id: 'diamond', label: '💎 Diamond' },
                { id: 'gold', label: '⭐ Gold' },
                { id: 'silver', label: '🥈 Silver' },
                { id: 'bronze', label: '🥉 Bronze' }
              ].map(f => `
                <button data-filter="${f.id}" class="filter-tab-btn px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border cursor-pointer transition-all ${
                  state.memberFilterStatus === f.id
                    ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20'
                    : 'bg-slate-950 text-slate-400 border-slate-850 hover:text-slate-200'
                }">${f.label}</button>
              `).join('')}
            </div>
          </div>

          <!-- Main Table UI -->
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-slate-950 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-850">
                  <th class="py-3 px-5 text-center w-14">ID</th>
                  <th class="py-3 px-5">Name / Username</th>
                  <th class="py-3 px-5 text-center">Status</th>
                  <th class="py-3 px-5 text-center">Inactivity</th>
                  <th class="py-3 px-5 text-center">Points & Streaks</th>
                  <th class="py-3 px-5">Admin Notes / Remarks</th>
                  <th class="py-3 px-5 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-850/50">
                ${filtered.length > 0 ? filtered.map(m => `
                  <tr class="hover:bg-slate-950/30 group transition">
                    <td class="py-3 px-5 text-center font-mono text-[11px] text-slate-500 font-bold">#${m.member_number}</td>
                    <td class="py-3 px-5">
                      <div>
                        <p class="font-bold text-slate-200 text-xs sm:text-sm">${m.name}</p>
                        <p class="text-[10px] text-indigo-400 mt-0.5">${m.display_name}</p>
                      </div>
                    </td>
                    <td class="py-3 px-5 text-center">
                      <span class="inline-block text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                        m.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' :
                        m.status === 'warning' ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400'
                      }">● ${m.status}</span>
                    </td>
                    <td class="py-3 px-5 text-center font-mono text-xs ${m.consecutive_inactive_days > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}">
                      ${m.consecutive_inactive_days > 0 ? `${m.consecutive_inactive_days} Days` : 'Active'}
                    </td>
                    <td class="py-3 px-5 text-center">
                      <div class="inline-block text-left">
                        <div class="flex items-center gap-1 font-semibold text-slate-300 font-mono text-xs">
                          <span class="text-yellow-400">★</span> ${m.total_points} Pts
                        </div>
                        <div class="text-[10px] text-slate-500 mt-0.5 flex gap-1 items-center font-mono">
                          🔥 <span class="text-rose-400 font-medium">${m.current_streak}</span> streak
                        </div>
                      </div>
                    </td>
                    <td class="py-3 px-5 text-xs text-slate-300 max-w-[200px] truncate">
                      ${state.editingNotesMemberId === m.id ? `
                        <div class="flex gap-1 items-center">
                          <input id="edit-notes-input" type="text" value="${state.editingNotesText}" class="bg-slate-950 border border-slate-750 text-xs text-slate-200 rounded px-2 py-1 w-full focus:outline-none focus:border-indigo-500" />
                          <button data-save-notes="${m.id}" class="text-green-400 hover:text-green-300 p-1 cursor-pointer"><i data-lucide="check" class="w-4 h-4"></i></button>
                        </div>
                      ` : `
                        <span class="text-slate-400">${m.notes || '—'}</span>
                        <button data-edit-notes-btn="${m.id}" data-notes-val="${m.notes}" class="text-slate-600 hover:text-indigo-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer inline-block ml-1"><i data-lucide="edit-2" class="w-3 h-3"></i></button>
                      `}
                    </td>
                    <td class="py-3 px-5 text-right">
                      <div class="flex items-center justify-end gap-1">
                        <button data-toggle-status="${m.id}" title="Toggle Status" class="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 cursor-pointer transition"><i data-lucide="shield-alert" class="w-3.5 h-3.5"></i></button>
                        <button data-reset-stats="${m.id}" title="Reset Stats" class="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-amber-500 cursor-pointer transition"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i></button>
                        <button data-delete-member="${m.id}" title="Remove Member" class="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 cursor-pointer transition"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                      </div>
                    </td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td colspan="7" class="py-8 text-center text-xs text-slate-500 italic">No members found matching your search.</td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // TAB: BULK INPUT / ACTIVITY TRACKER
    case 'bulk_input': {
      const { parsedNames, matchedMembers, unregisteredNames } = parseBulkActivityText(state.bulkInputText);

      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- Left box: main activity tracker text inputs -->
          <div class="lg:col-span-6 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2.5">
                <i data-lucide="clipboard-list" class="w-5 h-5 text-indigo-400"></i>
                <h3 class="font-bold text-slate-100 text-base">Daily Link Submission Tracker</h3>
              </div>
              <input id="bulk-input-date" type="date" value="${state.bulkInputDate}" class="bg-slate-950 border border-slate-800 text-xs px-3 py-1.5 rounded-xl text-slate-300 font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer" />
            </div>

            <p class="text-xs text-slate-400 leading-relaxed">
              Paste raw text containing member link submissions directly from your Facebook Messenger group or support post. The tracker automatically identifies mentions, increments active streaks, and flags unregistered names.
            </p>

            <textarea id="bulk-activity-textarea" rows="12" placeholder="1. @Rahi Ahmed Rabiul&#10;2. @Orithra Mazumder&#10;3. @Ahmed Sopon" class="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 placeholder-slate-700 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed resize-y">${state.bulkInputText}</textarea>

            <button id="save-activity-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs py-3.5 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer" ${matchedMembers.length === 0 ? 'disabled' : ''}>
              <i data-lucide="save" class="w-4 h-4"></i>
              Save Daily Activity (${matchedMembers.length} Active Members)
            </button>
          </div>

          <!-- Right column: real-time parser diagnostic output -->
          <div class="lg:col-span-6 flex flex-col gap-6">
            
            <!-- Panel 1: Matched Registered Members List -->
            <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex-grow flex flex-col justify-between min-h-[300px]">
              <div>
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-3 mb-3">
                  <h4 class="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>
                    Identified Active Members (${matchedMembers.length})
                  </h4>
                </div>

                <div class="max-h-72 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-850/40 font-mono text-[10px]">
                  ${matchedMembers.length > 0 ? matchedMembers.map(m => `
                    <div class="flex justify-between items-center py-2 px-2 hover:bg-slate-950/40 rounded-lg transition-colors">
                      <span class="text-slate-100 font-semibold">${m.name}</span>
                      <div class="flex items-center gap-2">
                        <span class="text-slate-500 font-bold">No.${m.member_number}</span>
                        <span class="px-1.5 py-0.5 rounded text-[8px] font-bold ${
                          m.level === 'Diamond' ? 'bg-cyan-500/10 text-cyan-400' :
                          m.level === 'Gold' ? 'bg-amber-500/10 text-amber-400' :
                          m.level === 'Silver' ? 'bg-slate-300/10 text-slate-300' :
                          'bg-amber-700/10 text-amber-600'
                        }">${m.level}</span>
                      </div>
                    </div>
                  `).join('') : `
                    <p class="text-[11px] text-slate-600 italic py-8 text-center">Paste raw link submissions in the input box to identify active members.</p>
                  `}
                </div>
              </div>

              <div class="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-3 flex gap-2 items-start mt-4">
                <i data-lucide="award" class="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5"></i>
                <p class="text-[10px] text-slate-400 leading-relaxed">
                  <strong class="text-indigo-400">Streak & Point Increment:</strong> Saving updates the database: identified members receive <span class="font-bold font-mono text-indigo-400">+10 Pts</span> and their consecutive active streaks increase by 1.
                </p>
              </div>
            </div>

            <!-- Panel 2: Unmatched unregistered names finder -->
            <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-3 mb-3">
                <h4 class="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-500 animate-pulse"></i>
                  Unregistered / New Names (${unregisteredNames.length})
                </h4>
                ${unregisteredNames.length > 0 ? `
                  <div class="flex items-center gap-2">
                    <button id="select-all-new-btn" class="text-[9px] bg-amber-500/10 hover:bg-amber-600 text-amber-400 hover:text-slate-950 px-2 py-1 rounded-md border border-amber-500/20 font-bold transition-all cursor-pointer">
                      Select All
                    </button>
                    <button id="deselect-all-new-btn" class="text-[9px] bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white px-2 py-1 rounded-md border border-rose-500/20 font-bold transition-all cursor-pointer">
                      Clear All
                    </button>
                  </div>
                ` : ''}
              </div>
              <p class="text-[10px] text-slate-400 mb-3">These names were mentioned but are not currently registered. You can select and register them individually or in bulk.</p>
              
              <div class="max-h-40 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-850/40 font-mono text-[10px]">
                ${unregisteredNames.length > 0 ? unregisteredNames.map(name => {
                  return `
                    <div class="flex justify-between items-center py-2 px-1 hover:bg-slate-950/30 rounded-lg">
                      <label class="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" data-new-name-check="${name}" class="new-member-checkbox rounded border-slate-800 text-amber-500 focus:ring-amber-500/20 w-4.5 h-4.5 bg-slate-950 cursor-pointer" checked />
                        <span class="new-member-name-label text-amber-400 font-bold transition-all">${name}</span>
                      </label>
                      <button data-quick-add-name="${name}" class="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 cursor-pointer">
                        <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i> Add
                      </button>
                    </div>
                  `;
                }).join('') : `
                  <p class="text-[11px] text-slate-600 italic py-4 text-center">No unregistered names detected.</p>
                `}
              </div>

              ${unregisteredNames.length > 0 ? `
                <div class="mt-4 pt-3 border-t border-slate-800/60">
                  <button id="register-selected-new-btn" class="w-full bg-amber-600 hover:bg-amber-500 text-slate-950 font-extrabold text-[11px] py-2.5 rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                    <i data-lucide="user-plus" class="w-4 h-4"></i>
                    Bulk Register Selected (<span id="bulk-register-count">${unregisteredNames.length}</span>) New Members
                  </button>
                </div>
              ` : ''}
            </div>

          </div>
        </div>
      `;
    }

    // TAB: NOTICE GENERATOR
    case 'notices': {
      // Inactive members query calculations
      const warningMembers = state.members.filter(m => m.consecutive_inactive_days >= state.noticeFilterDays);
      
      const formatWarningNotice = () => {
        const dateStr = new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
        
        const listText = warningMembers.length > 0 
          ? warningMembers.map((m, idx) => `${idx + 1}️⃣➤ ${m.name} (${m.consecutive_inactive_days} দিন ইনেক্টিভ)`).join('\n')
          : '😴 বর্তমানে এই ফিল্টারে কোনো নিষ্ক্রিয় মেম্বার নেই!';

        return `⚠️ গ্রুপ ওয়ার্নিং নোটিশ (Warning Notice) ⚠️

আসসালামু আলাইকুম, আমাদের গ্রুপে যারা তিন বা তার বেশি দিন ধরে নিষ্ক্রিয় রয়েছেন এবং গ্রুপ লিংক সাপোর্ট দিচ্ছেন না, তাদের একটি চূড়ান্ত সতর্কবার্তা দেওয়া হচ্ছে।

অনুগ্রহ করে যত দ্রুত সম্ভব এক্টিভ হন অথবা কোনো সমস্যা থাকলে এডমিনের সাথে যোগাযোগ করুন। অন্যথায় আপনাদের গ্রুপ থেকে রিমুভ করা হবে।

😴 Inactive Members 👇
〰〰〰〰〰〰〰〰〰〰

${listText}
〰〰〰〰〰〰〰〰〰〰
📅 তারিখ: ${dateStr}

✍️ Support Link Box Admin Team`;
      };

      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- Configuration Column -->
          <div class="lg:col-span-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-5">
            <div class="flex items-center gap-2 border-b border-slate-800 pb-3">
              <i data-lucide="megaphone" class="w-5 h-5 text-indigo-400"></i>
              <h3 class="font-bold text-slate-100 text-lg">Notice Maker & Generator</h3>
            </div>

            <p class="text-xs text-slate-400 leading-relaxed">
              Select an inactivity threshold to generate warning notifications for inactive Facebook group members.
            </p>

            <div class="space-y-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 flex justify-between">
                  <span>Inactivity Threshold Filter</span>
                  <span class="text-indigo-400 font-bold">${state.noticeFilterDays} Days or more</span>
                </label>
                <select id="notice-filter-days" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 cursor-pointer focus:outline-none focus:border-indigo-500">
                  <option value="3" ${state.noticeFilterDays === 3 ? 'selected' : ''}>3+ Days Inactive</option>
                  <option value="5" ${state.noticeFilterDays === 5 ? 'selected' : ''}>5+ Days Inactive</option>
                  <option value="7" ${state.noticeFilterDays === 7 ? 'selected' : ''}>7+ Days Inactive</option>
                  <option value="10" ${state.noticeFilterDays === 10 ? 'selected' : ''}>10+ Days Inactive</option>
                  <option value="12" ${state.noticeFilterDays === 12 ? 'selected' : ''}>12+ Days Inactive</option>
                </select>
              </div>
            </div>

            <button id="copy-notice-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3.5 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer">
              <i data-lucide="clipboard" class="w-4 h-4"></i>
              ${state.copiedNotice ? 'Notice Copied!' : 'Generate & Copy Notice'}
            </button>
          </div>

          <!-- Notice Content Box -->
          <div class="lg:col-span-8 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col justify-between">
            <div class="space-y-4 flex flex-col h-full justify-between">
              <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                <span class="text-xs font-bold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
                  <i data-lucide="calendar" class="w-3.5 h-3.5 text-indigo-400"></i> Notice Output
                </span>
                <span class="text-[10px] text-slate-500 font-bold font-mono uppercase">${warningMembers.length} Inactive Found</span>
              </div>

              <div class="bg-slate-950 rounded-xl p-4 border border-slate-800 max-h-[350px] overflow-y-auto font-mono text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed select-all">
                ${formatWarningNotice()}
              </div>

              <div class="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-3 flex gap-2 items-start mt-2">
                <i data-lucide="alert-triangle" class="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5"></i>
                <p class="text-[10px] text-slate-500 leading-relaxed">
                  <strong class="text-indigo-400">গুরুত্বপূর্ণ ফিক্স:</strong> নোটিশে মেম্বারদের নামের পাশে তাদের সঠিক ইনেক্টিভ দিনসমূহ (যেমন: ৭ দিন, ৯ দিন, ১২ দিন) নির্ভুলভাবে প্রদর্শন করা হয়েছে। এটি ডুপ্লিকেট এন্ট্রি এবং সাধারণ ওয়ার্নিং সংখ্যা ফিক্সড রাখার ত্রুটি দূর করেছে।
                </p>
              </div>
            </div>
          </div>

        </div>
      `;
    }

    // TAB: LEADERBOARDS
    case 'leaderboards': {
      // Filter list for stats search
      const filteredForStats = state.members.filter(m => 
        m.name.toLowerCase().includes(state.leaderboardSearchQuery.toLowerCase()) || 
        m.display_name.toLowerCase().includes(state.leaderboardSearchQuery.toLowerCase()) ||
        m.member_number.toString() === state.leaderboardSearchQuery
      );

      const activeList = [...filteredForStats]
        .filter(m => m.total_points >= state.leaderboardActiveThreshold)
        .sort((a, b) => b.total_points - a.total_points || b.current_streak - a.current_streak);

      const inactiveList = [...filteredForStats]
        .filter(m => m.consecutive_inactive_days >= state.leaderboardInactiveThreshold)
        .sort((a, b) => b.consecutive_inactive_days - a.consecutive_inactive_days);

      const topActive = activeList.slice(0, 3);
      const topInactive = inactiveList.slice(0, 3);

      return `
        <div class="space-y-6">
          
          <!-- Search statistics bar -->
          <div class="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="flex items-center gap-2">
              <i data-lucide="trophy" class="w-5 h-5 text-indigo-400"></i>
              <h3 class="font-bold text-slate-100 text-sm">গ্রুপ মেম্বারদের ওভারঅল লিডারবোর্ড (Statistics)</h3>
            </div>
            <div class="relative w-full sm:w-64">
              <i data-lucide="search" class="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
              <input id="leaderboard-search" type="text" value="${state.leaderboardSearchQuery}" placeholder="লিডারবোর্ড থেকে মেম্বার খুঁজুন..." class="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-700" />
            </div>
          </div>

          <!-- Beautifully styled premium stats cards on Homepage (Side-by-side horizontal scroll on mobile, grid on desktop) -->
          <div class="overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 relative z-10">
            <div class="flex sm:grid sm:grid-cols-4 gap-3.5 min-w-[620px] sm:min-w-0 pb-2">
              
              <!-- Total Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-indigo-500/15 p-4 rounded-xl relative overflow-hidden group hover:border-indigo-500/35 transition duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                <div class="absolute -right-4 -bottom-4 w-16 h-16 bg-indigo-500/5 rounded-full blur-xl group-hover:bg-indigo-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">মোট মেম্বার</span>
                  <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_6px_#818cf8]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-white tracking-tight font-mono">${totalCount}</span>
                    <span class="text-[9px] text-indigo-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                    <i data-lucide="users" class="w-3.5 h-3.5"></i>
                  </div>
                </div>
              </div>

              <!-- Active Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-emerald-500/15 p-4 rounded-xl relative overflow-hidden group hover:border-emerald-500/35 transition duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                <div class="absolute -right-4 -bottom-4 w-16 h-16 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">সক্রিয় মেম্বার</span>
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-emerald-400 tracking-tight font-mono">${activeCount}</span>
                    <span class="text-[9px] text-emerald-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                    <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
                  </div>
                </div>
              </div>

              <!-- Inactive Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-rose-500/15 p-4 rounded-xl relative overflow-hidden group hover:border-rose-500/35 transition duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                <div class="absolute -right-4 -bottom-4 w-16 h-16 bg-rose-500/5 rounded-full blur-xl group-hover:bg-rose-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">নিষ্ক্রিয় মেম্বার</span>
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shadow-[0_0_6px_#f43f5e]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-rose-400 tracking-tight font-mono">${inactiveCount}</span>
                    <span class="text-[9px] text-rose-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 border border-rose-500/20">
                    <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>
                  </div>
                </div>
              </div>

              <!-- Diamond Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-cyan-500/15 p-4 rounded-xl relative overflow-hidden group hover:border-cyan-500/35 transition duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                <div class="absolute -right-4 -bottom-4 w-16 h-16 bg-cyan-500/5 rounded-full blur-xl group-hover:bg-cyan-500/10 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">ডায়মন্ড মেম্বার</span>
                  <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_#22d3ee]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-cyan-400 tracking-tight font-mono">${diamondCount}</span>
                    <span class="text-[9px] text-cyan-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400 border border-cyan-500/20">
                    <i data-lucide="gem" class="w-3.5 h-3.5"></i>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            <!-- Left: Active Leaderboards list -->
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
              <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-800 pb-3 gap-2">
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <i data-lucide="flame" class="w-4.5 h-4.5 animate-pulse"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-slate-100 text-sm uppercase tracking-wide">১. সক্রিয় মেম্বার লিডারবোর্ড (Active)</h3>
                    <p class="text-[10px] text-slate-500">সবচেয়ে বেশি একটিভ ও পয়েন্ট অর্জনকারী মেম্বারদের তালিকা</p>
                  </div>
                </div>

                <div>
                  <select id="leaderboard-active-filter" class="bg-transparent border-0 text-[11px] text-slate-400 focus:outline-none cursor-pointer font-medium">
                    <option value="1" ${state.leaderboardActiveThreshold === 1 ? 'selected' : ''}>১+ পয়েন্ট বা তার বেশি</option>
                    <option value="100" ${state.leaderboardActiveThreshold === 100 ? 'selected' : ''}>১০০+ (Silver Tier)</option>
                    <option value="300" ${state.leaderboardActiveThreshold === 300 ? 'selected' : ''}>৩০০+ (Gold Tier)</option>
                    <option value="500" ${state.leaderboardActiveThreshold === 500 ? 'selected' : ''}>৫০০+ (Diamond Level)</option>
                  </select>
                </div>
              </div>

              <!-- Top 3 Podium for Active Members -->
              <div class="grid grid-cols-3 gap-2 items-end pt-2 pb-5 border-b border-slate-850/60">
                
                <!-- 2nd Place (Silver Medal) -->
                <div class="flex flex-col items-center space-y-1.5 text-center pb-2.5 bg-slate-950/20 border border-slate-850 rounded-xl p-2 h-36 justify-end relative">
                  <span class="absolute top-1 left-2 text-[10px] text-slate-400 font-bold font-mono">#2</span>
                  <div class="relative">
                    <div class="w-10 h-10 rounded-full bg-slate-850 border-2 border-slate-400 flex items-center justify-center text-slate-300 font-bold text-xs shadow-md">
                      🥈
                    </div>
                  </div>
                  <div class="w-full">
                    <p class="text-[10px] font-black text-slate-200 truncate">${topActive[1] ? topActive[1].name : '---'}</p>
                    <p class="text-[8px] text-slate-500 font-bold font-mono truncate">${topActive[1] ? '🔥 ' + topActive[1].current_streak + ' d streak' : 'খালি স্লট'}</p>
                    <div class="mt-1 bg-slate-400/10 border border-slate-400/20 text-slate-300 rounded px-1.5 py-0.5 text-[9px] font-black inline-block">
                      ★ ${topActive[1] ? topActive[1].total_points : '0'}
                    </div>
                  </div>
                </div>

                <!-- 1st Place (Gold Medal & Crown) -->
                <div class="flex flex-col items-center space-y-1.5 text-center pb-3.5 bg-gradient-to-t from-yellow-500/5 to-slate-950/30 border-2 border-yellow-500/40 rounded-2xl p-2 h-44 justify-end relative shadow-[0_0_15px_rgba(234,179,8,0.15)]">
                  <div class="absolute -top-3 text-yellow-400 text-sm animate-bounce">👑</div>
                  <span class="absolute top-1 left-2 text-[10px] text-yellow-400 font-bold font-mono">#1</span>
                  <div class="relative">
                    <div class="w-12 h-12 rounded-full bg-yellow-500/10 border-2 border-yellow-400 flex items-center justify-center text-yellow-400 font-bold text-sm shadow-lg shadow-yellow-500/10">
                      🥇
                    </div>
                  </div>
                  <div class="w-full">
                    <p class="text-xs font-black text-white truncate">${topActive[0] ? topActive[0].name : '---'}</p>
                    <p class="text-[8px] text-yellow-400 font-bold font-mono truncate">${topActive[0] ? '🔥 ' + topActive[0].current_streak + ' d streak' : 'খালি স্লট'}</p>
                    <div class="mt-1 bg-yellow-400 text-slate-950 rounded-xl px-2 py-0.5 text-[9px] font-black inline-block shadow-md">
                      ★ ${topActive[0] ? topActive[0].total_points : '0'}
                    </div>
                  </div>
                </div>

                <!-- 3rd Place (Bronze Medal) -->
                <div class="flex flex-col items-center space-y-1.5 text-center pb-2.5 bg-slate-950/20 border border-slate-850 rounded-xl p-2 h-32 justify-end relative">
                  <span class="absolute top-1 left-2 text-[10px] text-amber-700 font-bold font-mono">#3</span>
                  <div class="relative">
                    <div class="w-10 h-10 rounded-full bg-slate-850 border-2 border-amber-600 flex items-center justify-center text-amber-500 font-bold text-xs shadow-md">
                      🥉
                    </div>
                  </div>
                  <div class="w-full">
                    <p class="text-[10px] font-black text-slate-200 truncate">${topActive[2] ? topActive[2].name : '---'}</p>
                    <p class="text-[8px] text-slate-500 font-bold font-mono truncate">${topActive[2] ? '🔥 ' + topActive[2].current_streak + ' d streak' : 'খালি স্লট'}</p>
                    <div class="mt-1 bg-amber-600/10 border border-amber-600/20 text-amber-500 rounded px-1.5 py-0.5 text-[9px] font-black inline-block">
                      ★ ${topActive[2] ? topActive[2].total_points : '0'}
                    </div>
                  </div>
                </div>

              </div>

              <div class="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                ${activeList.length > 0 ? activeList.map((m, idx) => `
                  <div class="flex items-center justify-between bg-slate-950/40 hover:bg-slate-950 border border-slate-850 hover:border-slate-800 p-3 rounded-xl transition duration-150">
                    <div class="flex items-center gap-3">
                      <div class="w-6 h-6 rounded-full bg-slate-950 border border-slate-850 flex items-center justify-center text-[10px] font-bold ${
                        idx === 0 ? 'text-yellow-400 bg-yellow-400/5' :
                        idx === 1 ? 'text-slate-300 bg-slate-300/5' :
                        idx === 2 ? 'text-amber-600 bg-amber-600/5' : 'text-slate-500'
                      }">${idx + 1}</div>
                      <div>
                        <p class="text-xs font-bold text-slate-200">${m.name}</p>
                        <p class="text-[9px] text-slate-500 font-medium">Lvl: ${m.level} | ID: #${m.member_number}</p>
                      </div>
                    </div>
                    <div class="text-right">
                      <p class="text-xs font-extrabold text-indigo-400 flex items-center justify-end gap-1">
                        <span>★</span> ${m.total_points}
                      </p>
                      <p class="text-[10px] text-slate-500 mt-0.5 flex items-center justify-end gap-1 font-mono">
                        🔥 ${m.current_streak} days streak
                      </p>
                    </div>
                  </div>
                `).join('') : `
                  <p class="text-xs text-slate-600 text-center py-8">কোনো সক্রিয় মেম্বার পাওয়া যায়নি!</p>
                `}
              </div>
            </div>

            <!-- Right: Inactive Leaderboards list -->
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
              <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-800 pb-3 gap-2">
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400">
                    <i data-lucide="shield-alert" class="w-4.5 h-4.5 text-rose-400"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-slate-100 text-sm uppercase tracking-wide">২. নিষ্ক্রিয় মেম্বার লিডারবোর্ড (Inactive)</h3>
                    <p class="text-[10px] text-slate-500">সবচেয়ে বেশি দিন ধরে লিংক প্রদান না করা নিষ্ক্রিয় মেম্বারগণ</p>
                  </div>
                </div>

                <div>
                  <select id="leaderboard-inactive-filter" class="bg-transparent border-0 text-[11px] text-slate-400 focus:outline-none cursor-pointer font-medium">
                    <option value="3" ${state.leaderboardInactiveThreshold === 3 ? 'selected' : ''}>৩+ দিন ইনেক্টিভ</option>
                    <option value="5" ${state.leaderboardInactiveThreshold === 5 ? 'selected' : ''}>৫+ দিন ইনেক্টিভ</option>
                    <option value="7" ${state.leaderboardInactiveThreshold === 7 ? 'selected' : ''}>৭+ দিন (চূড়ান্ত ওয়ার্নিং)</option>
                    <option value="12" ${state.leaderboardInactiveThreshold === 12 ? 'selected' : ''}>১২+ দিন (রিমুভযোগ্য)</option>
                  </select>
                </div>
              </div>

              <!-- Top 3 Inactive Warning Podium -->
              <div class="grid grid-cols-3 gap-2 items-end pt-2 pb-5 border-b border-slate-850/60">
                
                <!-- 2nd Most Inactive -->
                <div class="flex flex-col items-center space-y-1.5 text-center pb-2.5 bg-slate-950/20 border border-slate-850 rounded-xl p-2 h-36 justify-end relative">
                  <span class="absolute top-1 left-2 text-[10px] text-rose-400 font-bold font-mono">#2</span>
                  <div class="relative">
                    <div class="w-10 h-10 rounded-full bg-slate-900 border-2 border-rose-500/50 flex items-center justify-center text-rose-400 font-bold text-xs shadow-md">
                      ⚠️
                    </div>
                  </div>
                  <div class="w-full">
                    <p class="text-[10px] font-black text-slate-200 truncate">${topInactive[1] ? topInactive[1].name : '---'}</p>
                    <p class="text-[8px] text-rose-400/80 font-bold font-mono truncate">${topInactive[1] ? 'Level: ' + topInactive[1].level : 'খালি স্লট'}</p>
                    <div class="mt-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded px-1.5 py-0.5 text-[9px] font-black inline-block">
                      ${topInactive[1] ? topInactive[1].consecutive_inactive_days + ' দিন' : '0 দিন'}
                    </div>
                  </div>
                </div>

                <!-- 1st Most Inactive -->
                <div class="flex flex-col items-center space-y-1.5 text-center pb-3.5 bg-gradient-to-t from-rose-950/15 to-slate-950/30 border-2 border-rose-600/50 rounded-2xl p-2 h-44 justify-end relative shadow-[0_0_15px_rgba(239,68,68,0.15)]">
                  <div class="absolute -top-3 text-rose-500 text-[9px] font-bold bg-rose-950/90 border border-rose-500/40 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">💀 Danger</div>
                  <span class="absolute top-1 left-2 text-[10px] text-rose-500 font-bold font-mono">#1</span>
                  <div class="relative">
                    <div class="w-12 h-12 rounded-full bg-rose-500/10 border-2 border-rose-500 flex items-center justify-center text-rose-500 font-bold text-sm shadow-lg shadow-rose-500/10">
                      🚨
                    </div>
                  </div>
                  <div class="w-full">
                    <p class="text-xs font-black text-white truncate">${topInactive[0] ? topInactive[0].name : '---'}</p>
                    <p class="text-[8px] text-rose-400 font-bold font-mono truncate">${topInactive[0] ? 'Level: ' + topInactive[0].level : 'খালি স্লট'}</p>
                    <div class="mt-1 bg-rose-600 text-white rounded-xl px-2 py-0.5 text-[9px] font-black inline-block shadow-md">
                      ${topInactive[0] ? topInactive[0].consecutive_inactive_days + ' দিন ' : '0 দিন'}
                    </div>
                  </div>
                </div>

                <!-- 3rd Most Inactive -->
                <div class="flex flex-col items-center space-y-1.5 text-center pb-2.5 bg-slate-950/20 border border-slate-850 rounded-xl p-2 h-32 justify-end relative">
                  <span class="absolute top-1 left-2 text-[10px] text-orange-400 font-bold font-mono">#3</span>
                  <div class="relative">
                    <div class="w-10 h-10 rounded-full bg-slate-900 border-2 border-orange-500/50 flex items-center justify-center text-orange-400 font-bold text-xs shadow-md">
                      💤
                    </div>
                  </div>
                  <div class="w-full">
                    <p class="text-[10px] font-black text-slate-200 truncate">${topInactive[2] ? topInactive[2].name : '---'}</p>
                    <p class="text-[8px] text-orange-400/80 font-bold font-mono truncate">${topInactive[2] ? 'Level: ' + topInactive[2].level : 'খালি স্লট'}</p>
                    <div class="mt-1 bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded px-1.5 py-0.5 text-[9px] font-black inline-block">
                      ${topInactive[2] ? topInactive[2].consecutive_inactive_days + ' দিন' : '0 দিন'}
                    </div>
                  </div>
                </div>

              </div>

              <div class="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                ${inactiveList.length > 0 ? inactiveList.map((m, idx) => `
                  <div class="flex items-center justify-between bg-slate-950/40 hover:bg-slate-950 border border-slate-850 hover:border-slate-800 p-3 rounded-xl transition duration-150">
                    <div class="flex items-center gap-3">
                      <div class="w-6 h-6 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center text-[10px] font-bold text-rose-400">${idx + 1}</div>
                      <div>
                        <p class="text-xs font-bold text-slate-200">${m.name}</p>
                        <p class="text-[9px] text-slate-500 font-medium">ID: #${m.member_number} | Level: ${m.level}</p>
                      </div>
                    </div>
                    <div class="text-right">
                      <p class="text-xs font-extrabold text-rose-400 font-mono">${m.consecutive_inactive_days} দিন ইনেক্টিভ</p>
                      <p class="text-[9px] text-slate-500 mt-0.5">শেষ একটিভ: ${m.last_active_date || 'কখনো নয়'}</p>
                    </div>
                  </div>
                `).join('') : `
                  <p class="text-xs text-slate-600 text-center py-8">কোনো নিষ্ক্রিয় মেম্বার পাওয়া যায়নি!</p>
                `}
              </div>
            </div>

          </div>
        </div>
      `;
    }

    // TAB: MEMBER STATS REPORT GENERATOR
    case 'reports': {
      const filteredForReports = state.members.filter(m => {
        const queryCleaned = state.reportSearchQuery.trim().toLowerCase().replace(/^#/, '');
        return !state.reportSearchQuery ? true : (
          m.name.toLowerCase().includes(state.reportSearchQuery.toLowerCase()) || 
          (m.display_name && m.display_name.toLowerCase().includes(state.reportSearchQuery.toLowerCase())) ||
          m.member_number.toString().includes(queryCleaned)
        );
      });

      const selectedMember = state.members.find(m => m.id === state.reportSelectedMemberId);
      const allBadges = getBadges().filter(b => b.member_id === state.reportSelectedMemberId);
      const allLogs = getActivityLogs()
        .filter(l => l.member_id === state.reportSelectedMemberId)
        .sort((a, b) => new Date(b.activity_date).getTime() - new Date(a.activity_date).getTime());

      return `
        <div id="stats-report-section" class="space-y-6">
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            <!-- Left Side: Member Selector list panel (rendered below on mobile) -->
            <div class="lg:col-span-4 order-2 lg:order-1 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col space-y-4">
              <div class="border-b border-slate-800 pb-2">
                <h3 class="font-bold text-slate-100 text-sm tracking-wide uppercase">Select Group Member</h3>
                <p class="text-[11px] text-slate-400 mt-1">Select a member to generate, view, and download their custom report card.</p>
              </div>

              <div class="relative">
                <i data-lucide="search" class="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
                <input id="report-search" type="text" value="${state.reportSearchQuery}" placeholder="Search name or ID..." class="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 placeholder-slate-700 font-mono" />
              </div>

              <div class="space-y-1.5 max-h-[350px] overflow-y-auto pr-1">
                ${filteredForReports.map(m => {
                  const isSelected = m.id === state.reportSelectedMemberId;
                  return `
                    <button data-select-report-member="${m.id}" class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-left transition duration-150 border cursor-pointer ${
                      isSelected 
                        ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20' 
                        : 'bg-slate-950/40 text-slate-300 border-transparent hover:bg-slate-850'
                    }">
                      <div>
                        <p class="text-xs font-bold">${m.name}</p>
                        <p class="text-[10px] text-slate-500 mt-0.5 font-mono">No.${m.member_number} | Level: ${m.level}</p>
                      </div>
                      <span class="text-[9px] px-1.5 py-0.5 font-bold uppercase rounded ${
                        m.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }">${m.status}</span>
                    </button>
                  `;
                }).join('')}
                ${filteredForReports.length === 0 ? '<p class="text-xs text-slate-600 text-center py-8">No members matching search query.</p>' : ''}
              </div>
            </div>

            <!-- Right Side: Certificate Card Frame (rendered above on mobile) -->
            <div class="lg:col-span-8 order-1 lg:order-2 flex flex-col space-y-4">
              ${selectedMember ? `
                <div class="space-y-4">
                  <!-- Quick Premium Action Header for Instant Visibility -->
                  <div class="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-950 border border-indigo-500/30 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
                    <div class="flex items-center gap-3">
                      <div class="bg-indigo-600/10 p-2 rounded-xl border border-indigo-500/20 text-indigo-400">
                        <i data-lucide="award" class="w-5 h-5"></i>
                      </div>
                      <div>
                        <h4 class="text-xs font-bold text-slate-100">${selectedMember.name} এর পারফরম্যান্স কার্ড</h4>
                        <p class="text-[10px] text-slate-400">পারফরম্যান্স রিপোর্ট ডাউনলোড করতে পাশের বাটনে ক্লিক করুন</p>
                      </div>
                    </div>
                    <button id="download-report-png-top" class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-1.5 cursor-pointer w-full sm:w-auto" ${state.isDownloadingReport ? 'disabled' : ''}>
                      <i data-lucide="download" class="w-3.5 h-3.5"></i>
                      ${state.isDownloadingReport ? 'Downloading Image...' : 'Save PNG (ডাউনলোড করুন)'}
                    </button>
                  </div>

                  <!-- Printable report card block -->
                  <div id="printable-report-card" class="bg-slate-950 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden space-y-6">
                    <div data-html2canvas-ignore="true" class="absolute right-0 top-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -z-10 pointer-events-none"></div>
                    <div data-html2canvas-ignore="true" class="absolute left-10 bottom-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -z-10 pointer-events-none"></div>

                    <!-- Header -->
                    <div class="flex flex-col sm:flex-row justify-between sm:items-start border-b border-slate-800 pb-5 gap-3">
                      <div>
                        <span class="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                          Official Performance Card
                        </span>
                        <h2 class="text-xl md:text-2xl font-extrabold text-slate-100 mt-2 flex items-center gap-2">
                          ${selectedMember.name}
                        </h2>
                        <p class="text-xs font-semibold text-slate-500 mt-0.5">${selectedMember.display_name}</p>
                      </div>
                      <div class="text-left sm:text-right font-mono">
                        <p class="text-xs text-slate-400 font-bold uppercase">Member Number</p>
                        <p class="text-xl font-black text-indigo-400 mt-1">#${selectedMember.member_number}</p>
                      </div>
                    </div>

                    <!-- Stats grid -->
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl text-center space-y-1">
                        <i data-lucide="award" class="w-5 h-5 mx-auto text-yellow-400"></i>
                        <p class="text-[9px] text-slate-500 uppercase font-bold">Total Points</p>
                        <p class="text-base font-black text-slate-200 font-mono">${selectedMember.total_points} Pts</p>
                      </div>
                      <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl text-center space-y-1">
                        <i data-lucide="flame" class="w-5 h-5 mx-auto text-rose-500 animate-pulse"></i>
                        <p class="text-[9px] text-slate-500 uppercase font-bold">Current Streak</p>
                        <p class="text-base font-black text-rose-400 font-mono">${selectedMember.current_streak} Days</p>
                      </div>
                      <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl text-center space-y-1">
                        <i data-lucide="sparkles" class="w-5 h-5 mx-auto text-indigo-400"></i>
                        <p class="text-[9px] text-slate-500 uppercase font-bold">Longest Streak</p>
                        <p class="text-base font-black text-indigo-400 font-mono">${selectedMember.longest_streak} Days</p>
                      </div>
                      <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl text-center space-y-1">
                        <i data-lucide="shield" class="w-5 h-5 mx-auto text-emerald-400"></i>
                        <p class="text-[9px] text-slate-500 uppercase font-bold">Group Level</p>
                        <p class="text-base font-black text-emerald-400 font-mono">${selectedMember.level}</p>
                      </div>
                    </div>

                    <!-- Diagnostics section -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-800 pt-5">
                      <div class="space-y-2">
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wide">Activity Diagnostics</p>
                        <ul class="text-xs space-y-2">
                          <li class="flex justify-between border-b border-slate-800/50 pb-1.5">
                            <span class="text-slate-500">Status:</span>
                            <span class="font-bold capitalize ${selectedMember.status === 'active' ? 'text-emerald-400' : 'text-rose-400'}">● ${selectedMember.status}</span>
                          </li>
                          <li class="flex justify-between border-b border-slate-800/50 pb-1.5">
                            <span class="text-slate-500">Total Active Days:</span>
                            <span class="text-slate-200 font-bold font-mono">${selectedMember.total_active_days} Days</span>
                          </li>
                          <li class="flex justify-between border-b border-slate-800/50 pb-1.5">
                            <span class="text-slate-500">Inactivity Counter:</span>
                            <span class="text-rose-400 font-bold font-mono">${selectedMember.consecutive_inactive_days} Days</span>
                          </li>
                          <li class="flex justify-between">
                            <span class="text-slate-500">Last Submission Date:</span>
                            <span class="text-slate-300 font-bold font-mono">${selectedMember.last_active_date || 'N/A'}</span>
                          </li>
                        </ul>
                      </div>

                      <div class="bg-slate-900/40 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                          <i data-lucide="award" class="w-4 h-4 text-yellow-500"></i> Earned Badges (${allBadges.length})
                        </p>
                        ${allBadges.length > 0 ? `
                          <div class="flex flex-wrap gap-2 overflow-y-auto max-h-24">
                            ${allBadges.map(b => `
                              <span class="bg-slate-950 border border-slate-800 px-2 py-1 rounded text-[10px] font-bold text-slate-300 font-mono">${b.badge_name}</span>
                            `).join('')}
                          </div>
                        ` : `
                          <p class="text-[11px] text-slate-500 italic py-2">No badges earned yet.</p>
                        `}
                        <div class="border-t border-slate-800/50 pt-2 text-[10px] text-slate-500 font-mono">
                          Generated: ${new Date().toISOString().split('T')[0]} | Support Link Box
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Action triggers -->
                  <div class="flex gap-3 justify-end">
                    <button id="download-report-png" class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-1.5 cursor-pointer" ${state.isDownloadingReport ? 'disabled' : ''}>
                      <i data-lucide="download" class="w-4 h-4"></i>
                      ${state.isDownloadingReport ? 'Downloading Image...' : 'Download Report as PNG'}
                    </button>
                  </div>

                  <!-- Submission Logs history list -->
                  <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                    <h3 class="font-bold text-slate-200 text-xs tracking-wider uppercase mb-3 flex items-center gap-1">
                      <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i> Recent Submission Logs
                    </h3>
                    <div class="max-h-40 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-850/50">
                      ${allLogs.length > 0 ? allLogs.map(log => `
                        <div class="flex justify-between items-center text-xs py-2 font-mono">
                          <span class="text-slate-300">${log.activity_date}</span>
                          <div class="flex items-center gap-2">
                            <span class="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold uppercase">Success</span>
                            <span class="text-[10px] text-slate-500">Submitted by: ${log.submitted_by}</span>
                          </div>
                        </div>
                      `).join('') : `
                        <p class="text-xs text-slate-500 italic py-4 text-center">No link submission history has been logged yet.</p>
                      `}
                    </div>
                  </div>

                </div>
              ` : `
                <div class="flex flex-col items-center justify-center py-24 bg-slate-900 border border-slate-800 rounded-2xl text-center text-slate-500">
                  <i data-lucide="help-circle" class="w-14 h-14 text-slate-700 mb-3"></i>
                  <p class="font-semibold text-slate-400 text-sm">No Member Selected</p>
                  <p class="text-xs text-slate-500 max-w-xs mt-1">
                    Select any member from the left panel to load their performance card, stats summary, and PNG card download options.
                  </p>
                </div>
              `}
            </div>

          </div>
        </div>
      `;
    }
  }
}

// Interactive Event binding to the generated HTML elements
function bindEvents() {
  
  // Bind custom confirm modal buttons
  const customConfirmOk = document.getElementById('custom-confirm-ok-btn');
  if (customConfirmOk && state.confirmModal) {
    customConfirmOk.onclick = () => {
      if (state.confirmModal && state.confirmModal.onConfirm) {
        state.confirmModal.onConfirm();
      }
    };
  }
  const customConfirmCancel = document.getElementById('custom-confirm-cancel-btn');
  if (customConfirmCancel && state.confirmModal) {
    customConfirmCancel.onclick = () => {
      if (state.confirmModal && state.confirmModal.onCancel) {
        state.confirmModal.onCancel();
      }
    };
  }

  // Tab change button event delegation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = (e) => {
      const targetTab = e.currentTarget.getAttribute('data-tab');
      updateState({ 
        currentTab: targetTab,
        isFabOpen: false,
        isHeaderMenuOpen: false
      });
    };
  });

  // Floating FAB click handler
  const fabTrigger = document.getElementById('floating-menu-trigger');
  if (fabTrigger) {
    fabTrigger.onclick = (e) => {
      e.stopPropagation();
      updateState({ isFabOpen: !state.isFabOpen });
    };
  }

  // Header Dropdown Trigger click handler
  const navDropdownTrigger = document.getElementById('nav-dropdown-trigger');
  if (navDropdownTrigger) {
    navDropdownTrigger.onclick = (e) => {
      e.stopPropagation();
      updateState({ isHeaderMenuOpen: !state.isHeaderMenuOpen });
    };
  }

  // Close menus when clicking outside
  document.onclick = (e) => {
    let changed = false;
    if (state.isFabOpen && !e.target.closest('#floating-menu-trigger') && !e.target.closest('[data-tab]')) {
      state.isFabOpen = false;
      changed = true;
    }
    if (state.isHeaderMenuOpen && !e.target.closest('#nav-dropdown-trigger') && !e.target.closest('#nav-dropdown-menu')) {
      state.isHeaderMenuOpen = false;
      changed = true;
    }
    if (changed) {
      render();
    }
  };

  // Admin selector changes
  const selector = document.getElementById('admin-selector');
  if (selector) {
    selector.onchange = (e) => {
      const email = e.target.value;
      if (email === 'custom') {
        const customEmail = prompt('এডমিনের ইমেইল প্রবেশ করান:');
        if (customEmail && customEmail.includes('@')) {
          const customName = prompt('এডমিনের পুরো নাম লিখুন:');
          if (customName) {
            ADMIN_NAMES[customEmail] = customName;
          } else {
            ADMIN_NAMES[customEmail] = customEmail.split('@')[0];
          }
          setCurrentAdmin(customEmail);
          
          // Add Audit log
          const auditTrails = getAuditTrails();
          auditTrails.unshift({
            id: `audit-${Date.now()}`,
            admin_email: customEmail,
            admin_name: ADMIN_NAMES[customEmail],
            action: 'ADD_ADMIN',
            entity_type: 'SESSION',
            description: `Registered and swapped active admin session to ${customEmail}`,
            timestamp: new Date().toISOString()
          });
          saveAuditTrails(auditTrails);
          loadStateFromStorage();
          updateState({});
        } else {
          showToast('সতর্কতা: অনুগ্রহ করে সঠিক ইমেইল এড্রেস প্রদান করুন!', 'error');
          updateState({});
        }
      } else {
        setCurrentAdmin(email);
        
        // Add swap audit log
        const auditTrails = getAuditTrails();
        auditTrails.unshift({
          id: `audit-${Date.now()}`,
          admin_email: email,
          admin_name: ADMIN_NAMES[email] || email.split('@')[0],
          action: 'SWITCH_ADMIN',
          entity_type: 'SESSION',
          description: `Admin swapped active session to ${email}`,
          timestamp: new Date().toISOString()
        });
        saveAuditTrails(auditTrails);
        loadStateFromStorage();
        updateState({});
      }
    };
  }

  // TAB EVENTS: MEMBERS
  if (state.currentTab === 'members') {
    
    // Member search typing
    const searchInp = document.getElementById('member-search-input');
    if (searchInp) {
      searchInp.oninput = (e) => {
        updateState({ searchQueryMembers: e.target.value });
        // Keep focus
        const inp = document.getElementById('member-search-input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(inp.value.length, inp.value.length);
        }
      };
    }

    // Filter statuses tabs selection
    document.querySelectorAll('.filter-tab-btn').forEach(btn => {
      btn.onclick = (e) => {
        const filterVal = e.target.getAttribute('data-filter');
        updateState({ memberFilterStatus: filterVal });
      };
    });

    // Form registration submit handler
    const addForm = document.getElementById('add-member-form');
    if (addForm) {
      addForm.onsubmit = (e) => {
        e.preventDefault();
        const textarea = document.getElementById('reg-name-input');
        const rawNames = textarea.value.trim();
        if (!rawNames) return;

        const namesToRegister = [];
        const lines = rawNames.split('\n').map(l => l.trim()).filter(Boolean);

        lines.forEach(line => {
          if (line.includes('@')) {
            const regex = /@([^\r\n@]+)/g;
            let match;
            let lineAdded = false;
            while ((match = regex.exec(line)) !== null) {
              const parsed = match[1].trim();
              if (parsed && parsed.length > 1) {
                namesToRegister.push(parsed);
                lineAdded = true;
              }
            }
            // Fallback if line has @ but no valid mention was extracted
            if (!lineAdded) {
              const cleanedLine = line.replace(/@/g, '').trim();
              if (cleanedLine && cleanedLine.length > 1) {
                namesToRegister.push(cleanedLine);
              }
            }
          } else {
            // No @ on this line, treat the whole line as one name
            if (line.length > 1) {
              namesToRegister.push(line);
            }
          }
        });

        const result = handleBulkAddMembers(namesToRegister);

        if (result.successCount > 0) {
          let msg = `সফলভাবে ${result.successCount} জন নতুন মেম্বার রেজিস্টার করা হয়েছে!`;
          if (result.duplicateNames.length > 0) {
            msg += ` (এবং ${result.duplicateNames.length} জন অলরেডি রেজিস্টার্ড থাকায় বাদ দেওয়া হয়েছে)`;
          }
          showToast(msg, 'success');
          textarea.value = '';
          updateState({ showRegisterModal: false });
        } else if (result.totalAttempted > 0) {
          showToast(`কোনো নতুন মেম্বার রেজিস্টার করা হয়নি। সবাই অলরেডি রেজিস্টার্ড আছেন!`, 'info');
          textarea.value = '';
          updateState({ showRegisterModal: false });
        }
      };
    }

    // Clear demo / Reset database handler
    const clearDemoBtn = document.getElementById('clear-demo-btn');
    if (clearDemoBtn) {
      clearDemoBtn.onclick = () => {
        showConfirm(
          'আপনি কি সত্যিই সমস্ত ডেমো মেম্বার এবং অ্যাক্টিভিটি ডেটা মুছে সম্পূর্ণ খালি করতে চান? এই একশনটি আর ফেরত আনা যাবে না!',
          () => {
            localStorage.removeItem(STORAGE_KEYS.MEMBERS);
            localStorage.removeItem(STORAGE_KEYS.LOGS);
            localStorage.removeItem(STORAGE_KEYS.AUDIT);
            localStorage.removeItem(STORAGE_KEYS.BADGES);
            
            initializeDatabase();
            loadStateFromStorage();
            updateState({});
            showToast('সাপোর্ট লিংক বক্স ডাটাবেজ সফলভাবে সম্পূর্ণ রিসেট করা হয়েছে!', 'success');
          },
          null,
          'ডাটাবেজ রিসেট করুন'
        );
      };
    }

    // Interactive Inline action buttons
    document.querySelectorAll('[data-toggle-status]').forEach(btn => {
      btn.onclick = (e) => {
        const memberId = e.currentTarget.getAttribute('data-toggle-status');
        const members = getMembers();
        const mIdx = members.findIndex(m => m.id === memberId);
        if (mIdx !== -1) {
          const oldStatus = members[mIdx].status;
          const newStatus = oldStatus === 'active' ? 'warning' : oldStatus === 'warning' ? 'inactive' : 'active';
          members[mIdx].status = newStatus;
          // Sync inactivity days representation
          members[mIdx].consecutive_inactive_days = newStatus === 'active' ? 0 : newStatus === 'warning' ? 7 : 12;
          members[mIdx].updated_at = new Date().toISOString();
          saveMembers(members);

          // Audit trail
          const trails = getAuditTrails();
          trails.unshift({
            id: `audit-${Date.now()}`,
            admin_email: state.currentAdminEmail,
            admin_name: ADMIN_NAMES[state.currentAdminEmail] || 'Admin',
            action: 'TOGGLE_STATUS',
            entity_type: 'MEMBER',
            description: `Toggled status for ${members[mIdx].name} to: ${newStatus}`,
            timestamp: new Date().toISOString()
          });
          saveAuditTrails(trails);

          loadStateFromStorage();
          updateState({});
        }
      };
    });

    document.querySelectorAll('[data-reset-stats]').forEach(btn => {
      btn.onclick = (e) => {
        const memberId = e.currentTarget.getAttribute('data-reset-stats');
        showConfirm(
          'আপনি কি সত্যিই এই মেম্বারের অর্জিত পয়েন্ট, লেভেল এবং স্ট্রেইক শুন্য (0) করতে চান?',
          () => {
            const members = getMembers();
            const mIdx = members.findIndex(m => m.id === memberId);
            if (mIdx !== -1) {
              members[mIdx].total_points = 0;
              members[mIdx].current_streak = 0;
              members[mIdx].longest_streak = 0;
              members[mIdx].total_active_days = 0;
              members[mIdx].level = 'Bronze';
              members[mIdx].consecutive_inactive_days = 0;
              members[mIdx].status = 'active';
              members[mIdx].updated_at = new Date().toISOString();
              saveMembers(members);

              // Audit
              const trails = getAuditTrails();
              trails.unshift({
                id: `audit-${Date.now()}`,
                admin_email: state.currentAdminEmail,
                admin_name: ADMIN_NAMES[state.currentAdminEmail],
                action: 'RESET_MEMBER',
                entity_type: 'MEMBER',
                description: `Reset all activity points and streaks to zero for: ${members[mIdx].name}`,
                timestamp: new Date().toISOString()
              });
              saveAuditTrails(trails);

              loadStateFromStorage();
              updateState({});
              showToast('মেম্বারের অর্জিত পয়েন্ট ও স্ট্রেইক শুন্য করা হয়েছে!', 'success');
            }
          },
          null,
          'মেম্বার রিসেট করুন'
        );
      };
    });

    document.querySelectorAll('[data-delete-member]').forEach(btn => {
      btn.onclick = (e) => {
        const memberId = e.currentTarget.getAttribute('data-delete-member');
        const members = getMembers();
        const member = members.find(m => m.id === memberId);
        if (!member) return;

        showConfirm(
          `আপনি কি সত্যিই "${member.name}" কে গ্রুপ ডাটাবেজ থেকে মুছে ফেলতে চান? এটি রিভার্স করা যাবে না!`,
          () => {
            const filtered = members.filter(m => m.id !== memberId);
            saveMembers(filtered);

            // Audit trail log
            const trails = getAuditTrails();
            trails.unshift({
              id: `audit-${Date.now()}`,
              admin_email: state.currentAdminEmail,
              admin_name: ADMIN_NAMES[state.currentAdminEmail],
              action: 'DELETE_MEMBER',
              entity_type: 'MEMBER',
              description: `Deleted registered member: ${member.name} (No. ${member.member_number})`,
              timestamp: new Date().toISOString()
            });
            saveAuditTrails(trails);

            loadStateFromStorage();
            updateState({});
            showToast(`"${member.name}" কে ডাটাবেজ থেকে মুছে ফেলা হয়েছে!`, 'success');
          },
          null,
          'মেম্বার মুছে ফেলুন'
        );
      };
    });

    // Edit Admin Notes trigger
    document.querySelectorAll('[data-edit-notes-btn]').forEach(btn => {
      btn.onclick = (e) => {
        const memberId = e.currentTarget.getAttribute('data-edit-notes-btn');
        const currentVal = e.currentTarget.getAttribute('data-notes-val');
        updateState({ editingNotesMemberId: memberId, editingNotesText: currentVal });
        // focus input
        const inp = document.getElementById('edit-notes-input');
        if (inp) inp.focus();
      };
    });

    // Save notes trigger
    document.querySelectorAll('[data-save-notes]').forEach(btn => {
      btn.onclick = (e) => {
        const memberId = e.currentTarget.getAttribute('data-save-notes');
        const notesInp = document.getElementById('edit-notes-input');
        if (notesInp) {
          const notesText = notesInp.value;
          const members = getMembers();
          const mIdx = members.findIndex(m => m.id === memberId);
          if (mIdx !== -1) {
            members[mIdx].notes = notesText;
            members[mIdx].updated_at = new Date().toISOString();
            saveMembers(members);

            // Audit
            const trails = getAuditTrails();
            trails.unshift({
              id: `audit-${Date.now()}`,
              admin_email: state.currentAdminEmail,
              admin_name: ADMIN_NAMES[state.currentAdminEmail],
              action: 'UPDATE_MEMBER_NOTES',
              entity_type: 'MEMBER',
              description: `Updated notes for: ${members[mIdx].name}`,
              timestamp: new Date().toISOString()
            });
            saveAuditTrails(trails);

            loadStateFromStorage();
            updateState({ editingNotesMemberId: null, editingNotesText: '' });
          }
        }
      };
    });
  }

  // TAB EVENTS: BULK INPUT / ACTIVITY TRACKER
  if (state.currentTab === 'bulk_input') {
    
    // Activity input text area modification
    const textarea = document.getElementById('bulk-activity-textarea');
    if (textarea) {
      textarea.oninput = (e) => {
        const text = e.target.value;
        const start = e.target.selectionStart;
        const end = e.target.selectionEnd;

        // Auto detect date from raw list
        const detectedDate = detectDateFromText(text);

        const nextState = { 
          bulkInputText: text,
          uncheckedUnregisteredNames: []
        };

        if (detectedDate) {
          nextState.bulkInputDate = detectedDate;
        }

        updateState(nextState);
        
        const tx = document.getElementById('bulk-activity-textarea');
        if (tx) {
          tx.focus();
          tx.setSelectionRange(start, end);
        }
      };
    }

    // Change date selector
    const dateSel = document.getElementById('bulk-input-date');
    if (dateSel) {
      dateSel.onchange = (e) => {
        updateState({ bulkInputDate: e.target.value });
      };
    }

    // Submit Action Save button click (saves activity for ALL detected matched members)
    const saveBtn = document.getElementById('save-activity-btn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const { matchedMembers } = parseBulkActivityText(state.bulkInputText);
        if (matchedMembers.length === 0) return;
        
        showConfirm(
          `আপনি কি সত্যিই নির্বাচিত তারিখ (${state.bulkInputDate}) এ ${matchedMembers.length} জন সক্রিয় মেম্বারের ডেইলি এক্টিভিটি সেভ করতে চান?`,
          () => {
            submitBulkActivity(state.bulkInputDate, matchedMembers.map(m => m.id));
          },
          null,
          'এক্টিভিটি সেভ করুন'
        );
      };
    }

    // Quick add name helper from warning box directly
    document.querySelectorAll('[data-quick-add-name]').forEach(btn => {
      btn.onclick = (e) => {
        const rawName = e.currentTarget.getAttribute('data-quick-add-name');
        if (handleAddMember(rawName)) {
          showToast(`"${rawName}" সফলভাবে ডাটাবেজে রেজিস্টার হয়েছে এবং এখন একটিভ তালিকায় সনাক্ত করা যাবে!`, 'success');
        }
      };
    });

    // Update local UI when a checkbox is toggled
    const updateBulkRegisterUI = () => {
      const checkedBoxes = document.querySelectorAll('.new-member-checkbox:checked');
      const countSpan = document.getElementById('bulk-register-count');
      const regBtn = document.getElementById('register-selected-new-btn');
      
      if (countSpan) {
        countSpan.textContent = checkedBoxes.length;
      }
      if (regBtn) {
        if (checkedBoxes.length === 0) {
          regBtn.disabled = true;
          regBtn.classList.add('opacity-50', 'cursor-not-allowed');
          regBtn.classList.remove('hover:bg-amber-500');
        } else {
          regBtn.disabled = false;
          regBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          regBtn.classList.add('hover:bg-amber-500');
        }
      }
    };

    // Checkbox toggling for unregistered names (local and native, no full-page re-renders!)
    document.querySelectorAll('.new-member-checkbox').forEach(chk => {
      chk.onchange = (e) => {
        const label = e.target.nextElementSibling;
        if (label) {
          if (e.target.checked) {
            label.className = 'new-member-name-label text-amber-400 font-bold transition-all';
          } else {
            label.className = 'new-member-name-label text-slate-400 transition-all';
          }
        }
        updateBulkRegisterUI();
      };
    });

    // Select all unregistered names
    const selectAllNewBtn = document.getElementById('select-all-new-btn');
    if (selectAllNewBtn) {
      selectAllNewBtn.onclick = () => {
        document.querySelectorAll('.new-member-checkbox').forEach(chk => {
          chk.checked = true;
          const label = chk.nextElementSibling;
          if (label) label.className = 'new-member-name-label text-amber-400 font-bold transition-all';
        });
        updateBulkRegisterUI();
      };
    }

    // Deselect all unregistered names
    const deselectAllNewBtn = document.getElementById('deselect-all-new-btn');
    if (deselectAllNewBtn) {
      deselectAllNewBtn.onclick = () => {
        document.querySelectorAll('.new-member-checkbox').forEach(chk => {
          chk.checked = false;
          const label = chk.nextElementSibling;
          if (label) label.className = 'new-member-name-label text-slate-400 transition-all';
        });
        updateBulkRegisterUI();
      };
    }

    // Register selected unregistered names in bulk
    const registerSelectedNewBtn = document.getElementById('register-selected-new-btn');
    if (registerSelectedNewBtn) {
      registerSelectedNewBtn.onclick = () => {
        const checkedBoxes = document.querySelectorAll('.new-member-checkbox:checked');
        const namesToReg = [];
        checkedBoxes.forEach(cb => {
          namesToReg.push(cb.getAttribute('data-new-name-check'));
        });
        
        if (namesToReg.length === 0) return;
        
        showConfirm(
          `আপনি কি সত্যিই নির্বাচিত ${namesToReg.length} জন নতুন মেম্বারকে একসাথে ডেটাবেজে রেজিস্টার করতে চান?`,
          () => {
            const result = handleBulkAddMembers(namesToReg);
            
            if (result.successCount > 0) {
              let msg = `${result.successCount} জন নতুন মেম্বার সফলভাবে ডাটাবেজে রেজিস্টার হয়েছে এবং এখন তাদের একটিভ মেম্বার হিসেবে ট্র্যাকার চেকলিস্টে পাওয়া যাবে!`;
              if (result.duplicateNames.length > 0) {
                msg += ` (এবং ${result.duplicateNames.length} জন অলরেডি রেজিস্টার্ড থাকায় বাদ দেওয়া হয়েছে)`;
              }
              showToast(msg, 'success');
              updateState({});
            } else {
              showToast('কোনো নতুন মেম্বার রেজিস্টার করা যায়নি। হয়তো তারা ইতিমধ্যে রেজিস্টার্ড!', 'error');
            }
          },
          null,
          'মেম্বার বাল্ক রেজিস্ট্রেশন'
        );
      };
    }
  }

  // TAB EVENTS: WARNING NOTICES GENERATOR
  if (state.currentTab === 'notices') {
    
    // Choose filter inactive days
    const filterDaysSel = document.getElementById('notice-filter-days');
    if (filterDaysSel) {
      filterDaysSel.onchange = (e) => {
        updateState({ noticeFilterDays: Number(e.target.value), copiedNotice: false });
      };
    }

    // Single Click Copy notice text helper
    const copyNoticeBtn = document.getElementById('copy-notice-btn');
    if (copyNoticeBtn) {
      copyNoticeBtn.onclick = () => {
        const textToCopy = document.querySelector('.whitespace-pre-wrap').innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
          updateState({ copiedNotice: true });
          setTimeout(() => {
            updateState({ copiedNotice: false });
          }, 3000);
        }).catch(err => {
          console.error('Clipboard copy failed:', err);
          showToast('ক্লিপবোর্ডে কপি করা যায়নি। অনুগ্রহ করে ম্যানুয়ালি সিলেক্ট করে কপি করুন।', 'error');
        });
      };
    }
  }

  // TAB EVENTS: LEADERBOARDS
  if (state.currentTab === 'leaderboards') {
    
    // Live Search input
    const leadSearch = document.getElementById('leaderboard-search');
    if (leadSearch) {
      leadSearch.oninput = (e) => {
        updateState({ leaderboardSearchQuery: e.target.value });
        const inp = document.getElementById('leaderboard-search');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(inp.value.length, inp.value.length);
        }
      };
    }

    // Active limit filter
    const activeFilter = document.getElementById('leaderboard-active-filter');
    if (activeFilter) {
      activeFilter.onchange = (e) => {
        updateState({ leaderboardActiveThreshold: Number(e.target.value) });
      };
    }

    // Inactive limit filter
    const inactiveFilter = document.getElementById('leaderboard-inactive-filter');
    if (inactiveFilter) {
      inactiveFilter.onchange = (e) => {
        updateState({ leaderboardInactiveThreshold: Number(e.target.value) });
      };
    }
  }

  // TAB EVENTS: STATS PERFORMANCE CARD REPORTS
  if (state.currentTab === 'reports') {
    
    // Search member query
    const repSearch = document.getElementById('report-search');
    if (repSearch) {
      repSearch.oninput = (e) => {
        updateState({ reportSearchQuery: e.target.value });
        const inp = document.getElementById('report-search');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(inp.value.length, inp.value.length);
        }
      };
    }

    // Select individual member
    document.querySelectorAll('[data-select-report-member]').forEach(btn => {
      btn.onclick = (e) => {
        const memberId = e.currentTarget.getAttribute('data-select-report-member');
        updateState({ reportSelectedMemberId: memberId });
        
        // Auto smooth scroll to card details so it is centered on mobile
        setTimeout(() => {
          const cardDetails = document.getElementById('printable-report-card');
          if (cardDetails) {
            cardDetails.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      };
    });

    // Unified PNG downloader triggers (CORS/IFrame proof & allowTaint)
    const triggerPngDownload = () => {
      const reportCard = document.getElementById('printable-report-card');
      const selectedMember = state.members.find(m => m.id === state.reportSelectedMemberId);
      if (!reportCard || !selectedMember) return;

      updateState({ isDownloadingReport: true });

      setTimeout(() => {
        const html2canvasFn = window.html2canvas || html2canvas;
        html2canvasFn(reportCard, {
          scale: 2, // high crisp definitions
          backgroundColor: '#020617', // deep dark theme
          logging: false,
          useCORS: true,
          allowTaint: false // allowTaint MUST be false to avoid SecurityError during .toDataURL()
        }).then(canvas => {
          const imgData = canvas.toDataURL('image/png');
          const blob = dataURLtoBlob(imgData);
          const blobUrl = blob ? URL.createObjectURL(blob) : imgData;
          
          // 1. Attempt desktop direct download
          try {
            const link = document.createElement('a');
            link.style.display = 'none';
            document.body.appendChild(link);
            link.download = `${selectedMember.name.replace(/\s+/g, '_')}_Performance_Card.png`;
            link.href = blobUrl;
            link.click();
            document.body.removeChild(link);
          } catch (e) {
            console.warn('Direct file download link click failed:', e);
          }

          // 2. Open state modal with the image URL for mobile users or cross-origin fallbacks
          updateState({ 
            isDownloadingReport: false,
            generatedPngUrl: blobUrl,
            generatedPngMemberName: selectedMember.name
          });
        }).catch(err => {
          console.error('Canvas image generation failed:', err);
          showToast('রিপোর্ট ইমেজ ডাউনলোড ব্যর্থ হয়েছে! দয়া করে আবার চেষ্টা করুন।', 'error');
          updateState({ isDownloadingReport: false });
        });
      }, 400);
    };

    const pngBtn = document.getElementById('download-report-png');
    if (pngBtn) pngBtn.onclick = triggerPngDownload;

    const pngBtnTop = document.getElementById('download-report-png-top');
    if (pngBtnTop) pngBtnTop.onclick = triggerPngDownload;
  }

  // TAB EVENTS: SUPABASE GUIDE
  if (state.currentTab === 'supabase') {
    
    // Check if locked
    if (!state.developerUnlocked) {
      const passInp = document.getElementById('dev-password-gate-input');
      const submitBtn = document.getElementById('dev-password-submit-btn');
      const errEl = document.getElementById('dev-password-error');
      
      const attemptUnlock = () => {
        if (passInp) {
          const pass = passInp.value;
          if (pass === 'Sm.Shihab211') {
            sessionStorage.setItem('developer_unlocked', 'true');
            updateState({ developerUnlocked: true });
          } else {
            if (errEl) {
              errEl.textContent = 'ভুল পাসওয়ার্ড! অনুগ্রহ করে আবার চেষ্টা করুন।';
              errEl.classList.remove('hidden');
            }
            passInp.value = '';
            passInp.focus();
          }
        }
      };

      if (submitBtn) {
        submitBtn.onclick = attemptUnlock;
      }
      if (passInp) {
        passInp.onkeydown = (e) => {
          if (e.key === 'Enter') {
            attemptUnlock();
          }
        };
        // Auto-focus input
        setTimeout(() => passInp.focus(), 100);
      }
      return; // Stop binding other supabase elements since they are locked/hidden
    }
    
    // Toggle URL visibility handler
    const toggleUrlBtn = document.getElementById('toggle-url-visibility-btn');
    if (toggleUrlBtn) {
      toggleUrlBtn.onclick = () => {
        updateState({ showUrlInput: !state.showUrlInput });
      };
    }

    // Toggle Key visibility handler
    const toggleKeyBtn = document.getElementById('toggle-key-visibility-btn');
    if (toggleKeyBtn) {
      toggleKeyBtn.onclick = () => {
        updateState({ showKeyInput: !state.showKeyInput });
      };
    }

    // Clear credentials handler
    const clearCfgBtn = document.getElementById('clear-supabase-config-btn');
    if (clearCfgBtn) {
      clearCfgBtn.onclick = () => {
        showConfirm(
          'আপনি কি সত্যিই আপনার ব্রাউজারে সংরক্ষিত Supabase API ক্রেডেনশিয়ালস মুছে ফেলতে চান?',
          () => {
            localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
            localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
            
            cachedSupabaseClient = null; // Invalidate cached client
            state.supabaseUrl = '';
            state.supabaseKey = '';
            state.loadedFromEnv = false;
            initSupabaseConfig();
            
            updateState({ 
              supabaseConnectionStatus: 'idle',
              supabaseConnectionError: ''
            });
            showToast('সংরক্ষিত ক্রেডেনশিয়ালস সফলভাবে মুছে ফেলা হয়েছে!', 'success');
          },
          null,
          'ক্রেডেনশিয়ালস মুছুন'
        );
      };
    }
    
    // Save credentials handler
    const saveCfgBtn = document.getElementById('save-supabase-config-btn');
    if (saveCfgBtn) {
      saveCfgBtn.onclick = async () => {
        const urlInp = document.getElementById('supabase-url-input');
        const keyInp = document.getElementById('supabase-key-input');
        if (urlInp && keyInp) {
          const url = urlInp.value.trim();
          const key = keyInp.value.trim();
          
          if (!url || !key) {
            showToast('সতর্কতা: অনুগ্রহ করে সঠিক Supabase URL এবং Public Key প্রদান করুন!', 'error');
            return;
          }
          
          localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, url);
          localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, key);
          cachedSupabaseClient = null; // Invalidate cached client
          
          updateState({ supabaseUrl: url, supabaseKey: key });
          
          // Trigger a live connection test
          const isOk = await testSupabaseConnection();
          if (isOk) {
            showToast('ক্রেডেনশিয়ালস সফলভাবে সেভ হয়েছে এবং কানেকশন সফল হয়েছে!', 'success');
          } else {
            showAlert('ক্রেডেনশিয়ালস সেভ হয়েছে কিন্তু কানেকশন টেস্ট ব্যর্থ হয়েছে! অনুগ্রহ করে URL/Key বা SQL টেবিল স্ট্রাকচার চেক করুন।', 'কানেকশন টেস্ট ব্যর্থ');
          }
        }
      };
    }

    // Test connection handler
    const testConnBtn = document.getElementById('test-connection-btn');
    if (testConnBtn) {
      testConnBtn.onclick = async () => {
        const isOk = await testSupabaseConnection();
        if (isOk) {
          showToast('কানেকশন টেস্ট সফল! Supabase লাইভ এবং প্রস্তুত।', 'success');
        } else {
          showAlert('কানেকশন টেস্ট ব্যর্থ হয়েছে! আপনার SQL কোড রান করা হয়েছে কিনা এবং ক্রেডেনশিয়ালস সঠিক কিনা তা পুনরায় চেক করুন।', 'কানেকশন টেস্ট ব্যর্থ');
        }
      };
    }

    // Auto-sync toggle handler
    const autoSyncTgl = document.getElementById('supabase-autosync-toggle');
    if (autoSyncTgl) {
      autoSyncTgl.onchange = (e) => {
        const checked = e.target.checked;
        localStorage.setItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED, checked ? 'true' : 'false');
        updateState({ supabaseSyncEnabled: checked });
        if (checked) {
          setupSupabaseRealtime();
          showToast('লাইভ ব্যাকগ্রাউন্ড অটো-সিংক্রোনাইজেশন চালু করা হয়েছে!', 'success');
        } else {
          const client = getSupabase();
          if (client && realtimeChannel) {
            client.removeChannel(realtimeChannel);
            realtimeChannel = null;
          }
          showToast('ব্যাকগ্রাউন্ড অটো-সিংক্রোনাইজেশন বন্ধ করা হয়েছে।', 'info');
        }
      };
    }

    // Push button handler
    const pushBtn = document.getElementById('push-supabase-btn');
    if (pushBtn) {
      pushBtn.onclick = () => {
        pushToSupabase();
      };
    }

    // Pull button handler
    const pullBtn = document.getElementById('pull-supabase-btn');
    if (pullBtn) {
      pullBtn.onclick = () => {
        showConfirm(
          'আপনি কি সত্যিই ক্লাউড Supabase থেকে সমস্ত ডেটা নামিয়ে লোকাল ডেটা ওভাররাইট করতে চান? লোকাল ব্রাউজারের কোনো অসংরক্ষিত পরিবর্তন হারিয়ে যেতে পারে!',
          () => {
            pullFromSupabase();
          },
          null,
          'ক্লাউড ডেটা নামান'
        );
      };
    }

    // Copy SQL text script
    const sqlBtn = document.getElementById('copy-sql-btn');
    if (sqlBtn) {
      sqlBtn.onclick = () => {
        const textToCopy = document.querySelectorAll('pre')[0].innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
          updateState({ copiedSQL: true });
          setTimeout(() => updateState({ copiedSQL: false }), 2000);
        });
      };
    }

    // Copy React connection logic snippet
    const jsBtn = document.getElementById('copy-js-btn');
    if (jsBtn) {
      jsBtn.onclick = () => {
        const textToCopy = document.querySelectorAll('pre')[1].innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
          updateState({ copiedJS: true });
          setTimeout(() => updateState({ copiedJS: false }), 2000);
        });
      };
    }
  }

  // PNG modal closing handlers
  const closePngModal = document.getElementById('close-png-modal');
  if (closePngModal) {
    closePngModal.onclick = () => {
      updateState({ generatedPngUrl: '', generatedPngMemberName: '' });
    };
  }
  const closePngModalBtn = document.getElementById('close-png-modal-btn');
  if (closePngModalBtn) {
    closePngModalBtn.onclick = () => {
      updateState({ generatedPngUrl: '', generatedPngMemberName: '' });
    };
  }

  // PWA installer banner handlers
  const pwaCloseBtn = document.getElementById('pwa-close-banner-btn');
  if (pwaCloseBtn) {
    pwaCloseBtn.onclick = () => {
      updateState({ showPwaInstallBanner: false });
    };
  }
  const pwaInstallBtn = document.getElementById('pwa-install-action-btn');
  if (pwaInstallBtn) {
    pwaInstallBtn.onclick = () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('User accepted the PWA install prompt');
          } else {
            console.log('User dismissed the PWA install prompt');
          }
          deferredPrompt = null;
          updateState({ showPwaInstallBanner: false });
        });
      }
    };
  }

  // Register member modal trigger handlers
  const openRegisterBtn = document.getElementById('open-register-modal-btn');
  if (openRegisterBtn) {
    openRegisterBtn.onclick = () => {
      updateState({ showRegisterModal: true });
    };
  }
  const closeRegisterModal = document.getElementById('close-register-modal');
  if (closeRegisterModal) {
    closeRegisterModal.onclick = () => {
      updateState({ showRegisterModal: false });
    };
  }
  const closeRegisterModalBtn = document.getElementById('close-register-modal-btn');
  if (closeRegisterModalBtn) {
    closeRegisterModalBtn.onclick = () => {
      updateState({ showRegisterModal: false });
    };
  }

  // Toast close handler
  const closeToastBtn = document.getElementById('close-toast-btn');
  if (closeToastBtn) {
    closeToastBtn.onclick = () => {
      state.toast = null;
      render();
    };
  }
}

// PWA installation events
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent default browser-managed promo
  e.preventDefault();
  // Save for later prompt
  deferredPrompt = e;
  // Show beautiful install banner
  updateState({ showPwaInstallBanner: true });
});

window.addEventListener('appinstalled', () => {
  console.log('App was successfully installed!');
  deferredPrompt = null;
  updateState({ showPwaInstallBanner: false });
});

// Kickstart Application
window.addEventListener('DOMContentLoaded', () => {
  loadStateFromStorage();
  updateState({});

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered with scope:', reg.scope))
      .catch(err => console.warn('Service Worker registration failed:', err));
  }

  // Instantly perform a silent background sync on load to ensure up-to-date data on other devices
  silentPullFromSupabase().then(() => {
    setupSupabaseRealtime();
  });

  // Periodic automatic sync every 2 minutes (120,000 ms)
  setInterval(() => {
    silentPullFromSupabase();
  }, 2 * 60 * 1000);
});
