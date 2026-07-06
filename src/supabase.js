// Support Link Box - Centralized Supabase Integration & Queue Sync Manager

import { STORAGE_KEYS, DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY } from './constants.js';
import { getState, updateState } from './state.js';
import { 
  getMembers, saveMembers, 
  getActivityLogs, saveActivityLogs, 
  getAuditTrails, saveAuditTrails, 
  getBadges, saveBadges,
  invalidateDbCache, deduplicateMembers, getNormalizedName
} from './database.js';
import { showToast } from './toast.js';

let cachedSupabaseClient = null;
let realtimeChannel = null;
let isProcessingQueue = false;

// Initialize Client
export function getSupabase() {
  if (cachedSupabaseClient) return cachedSupabaseClient;

  const url = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || DEFAULT_SUPABASE_KEY;

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

// Ensure configuration is up to date
export function initSupabaseConfig() {
  const url = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || DEFAULT_SUPABASE_KEY;

  cachedSupabaseClient = null; // Invalidate cache
  updateState({
    supabaseUrl: url,
    supabaseKey: key,
    supabaseSyncEnabled: localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) !== 'false'
  });
}

// ----------------------------------------------------
// SINGLE SYNC QUEUE MANAGER (UI -> Local DB -> Queue -> Supabase)
// ----------------------------------------------------

export function enqueueSyncJob(table, data) {
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE) || '[]');
  } catch (e) {
    queue = [];
  }

  // Deduplicate and fold: If there is already a pending sync for this table, 
  // overwrite its payload with the newest state. This avoids redundant writes.
  const existingIndex = queue.findIndex(job => job.table === table);
  if (existingIndex !== -1) {
    queue[existingIndex].data = data;
    queue[existingIndex].timestamp = Date.now();
  } else {
    queue.push({
      id: `sync-job-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      table,
      data,
      timestamp: Date.now()
    });
  }

  localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
  
  // Asynchronously trigger queue processing
  setTimeout(processSyncQueue, 50);
}

export async function processSyncQueue() {
  if (isProcessingQueue) return;
  const client = getSupabase();
  if (!client) return;

  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE) || '[]');
  } catch (e) {
    return;
  }

  if (queue.length === 0) {
    updateState({ supabaseSyncing: false });
    return;
  }

  isProcessingQueue = true;
  updateState({ supabaseSyncing: true });

  const job = queue[0];
  console.log(`Sync Queue: Processing job ${job.id} for table ${job.table}...`);

  try {
    const { error } = await client.from(job.table).upsert(job.data);
    if (error) {
      throw error;
    }

    // Success: reload queue, shift first, write back
    try {
      queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE) || '[]');
    } catch(e) {
      queue = [];
    }
    
    // Check if the first job is indeed the one we just processed
    if (queue.length > 0 && queue[0].id === job.id) {
      queue.shift();
    } else {
      // Otherwise just filter it out
      queue = queue.filter(q => q.id !== job.id);
    }
    
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
    updateState({ 
      supabaseConnectionStatus: 'connected',
      supabaseConnectionError: ''
    });

    isProcessingQueue = false;
    // Process next job
    processSyncQueue();
  } catch (err) {
    console.error(`Sync Queue: Job ${job.id} failed:`, err);
    updateState({ 
      supabaseConnectionStatus: 'error',
      supabaseConnectionError: err.message || 'Synchronization failed'
    });
    isProcessingQueue = false;

    // Retry after 10 seconds if still offline or error persists
    setTimeout(processSyncQueue, 10000);
  }
}

// ----------------------------------------------------
// REALTIME LIVE SYNCHRONIZATION (With Loopback Prevention)
// ----------------------------------------------------

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
    let localData = [];
    if (table === 'members') localData = getMembers();
    else if (table === 'activity_logs') localData = getActivityLogs();
    else if (table === 'badges') localData = getBadges();
    else if (table === 'audit_trails') localData = getAuditTrails();

    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'INSERT') {
      if (!localData.some(item => item.id === newRecord.id)) {
        localData.push(newRecord);
        // Save skipping queue to prevent looping writes back to cloud
        saveLocalDataWithoutSync(table, localData);
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
        saveLocalDataWithoutSync(table, localData);
        triggerStateReload(table);
      }
    } else if (eventType === 'DELETE') {
      const initialLength = localData.length;
      localData = localData.filter(item => item.id !== oldRecord.id);
      if (localData.length !== initialLength) {
        saveLocalDataWithoutSync(table, localData);
        triggerStateReload(table);
      }
    }
  } catch (err) {
    console.error('Error handling realtime update:', err);
  }
}

function saveLocalDataWithoutSync(table, data) {
  invalidateDbCache(table);
  if (table === 'members') saveMembers(data, true);
  else if (table === 'activity_logs') saveActivityLogs(data, true);
  else if (table === 'badges') saveBadges(data, true);
  else if (table === 'audit_trails') saveAuditTrails(data, true);
}

function triggerStateReload(table) {
  console.log(`Realtime: Reloading state and UI for table ${table}`);
  invalidateDbCache(table);
  
  // Refresh variables in current global state
  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });
}

// ----------------------------------------------------
// DATABASE INTEGRITY & SYNC LOGIC
// ----------------------------------------------------

export async function testSupabaseConnection() {
  const client = getSupabase();
  if (!client) {
    updateState({ supabaseConnectionStatus: 'not_configured', supabaseConnectionError: '' });
    return false;
  }
  updateState({ supabaseConnectionStatus: 'connecting', supabaseConnectionError: '' });
  try {
    const { error: selectError } = await client.from('members').select('id').limit(1);
    if (selectError) {
      throw new Error(`Select Test Failed: ${selectError.message}`);
    }

    const testId = `test-conn-${Date.now()}`;
    const testMember = {
      id: testId,
      name: 'System Test Connection',
      display_name: '@testconn',
      member_number: 999999,
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

// Full Bidirectional Smart Sync
export async function performSmartSync(silent = true) {
  const client = getSupabase();
  if (!client) {
    if (!silent) showToast('অনুগ্রহ করে প্রথমে Supabase URL এবং Key সেট আপ করুন!', 'error');
    return false;
  }
  if (silent && localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return false;

  updateState({ supabaseSyncing: true });
  try {
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

    if (remoteM.error) throw new Error(`Members: ${remoteM.error.message}`);
    if (remoteL.error) throw new Error(`Activity Logs: ${remoteL.error.message}`);
    if (remoteB.error) throw new Error(`Badges: ${remoteB.error.message}`);
    if (remoteA.error) throw new Error(`Audit Trails: ${remoteA.error.message}`);

    const rMembers = remoteM.data || [];
    const rLogs = remoteL.data || [];
    const rBadges = remoteB.data || [];
    const rAudits = remoteA.data || [];

    const localMembers = getMembers();
    const localLogs = getActivityLogs();
    const localBadges = getBadges();
    const localAudits = getAuditTrails();

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

    // Bidirectional Merge
    const mergedMembersMap = new Map();
    const nameToIdMap = new Map();

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

    const mergedLogsMap = new Map();
    localLogs.forEach(l => { if (l && l.id) mergedLogsMap.set(l.id, l); });
    rLogs.forEach(rl => { if (rl && rl.id) mergedLogsMap.set(rl.id, rl); });
    const mergedLogs = Array.from(mergedLogsMap.values());

    const mergedBadgesMap = new Map();
    localBadges.forEach(b => { if (b && b.id) mergedBadgesMap.set(b.id, b); });
    rBadges.forEach(rb => { if (rb && rb.id) mergedBadgesMap.set(rb.id, rb); });
    const mergedBadges = Array.from(mergedBadgesMap.values());

    const mergedAuditsMap = new Map();
    localAudits.forEach(a => { if (a && a.id) mergedAuditsMap.set(a.id, a); });
    rAudits.forEach(ra => { if (ra && ra.id) mergedAuditsMap.set(ra.id, ra); });
    const mergedAudits = Array.from(mergedAuditsMap.values());

    // Save with skipQueue to avoid re-triggering pushes
    saveLocalDataWithoutSync('members', mergedMembers);
    saveLocalDataWithoutSync('activity_logs', mergedLogs);
    saveLocalDataWithoutSync('badges', mergedBadges);
    saveLocalDataWithoutSync('audit_trails', mergedAudits);

    updateState({
      members: mergedMembers,
      auditTrails: mergedAudits,
      supabaseSyncing: false,
      supabaseConnectionStatus: 'connected',
      supabaseConnectionError: ''
    });

    // Mirror to Supabase to align all records
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

// Complete push of all tables
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
    showToast('অভিনন্দন! লোকাল ব্রাউজারের সমস্ত মেম্বার এবং অ্যাক্টিভিটি ডাটা সফলভাবে Supabase ক্লাউডে আপলোড (Push) করা হয়েছে!', 'success');
    return true;
  } catch (err) {
    console.error(err);
    updateState({ supabaseSyncing: false, supabaseConnectionStatus: 'error', supabaseConnectionError: err.message });
    showToast(`ডাটা আপলোড করতে সমস্যা হয়েছে: ${err.message}`, 'error');
    return false;
  }
}
