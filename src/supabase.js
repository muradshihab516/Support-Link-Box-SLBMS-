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
export function healSyncQueue() {
  try {
    let queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE) || '[]');
    if (Array.isArray(queue) && queue.length > 0) {
      let changed = false;
      queue = queue.map(job => {
        if (job && job.table === 'members' && Array.isArray(job.data)) {
          let maxMemberNum = job.data.reduce((max, m) => (m && m.member_number && typeof m.member_number === 'number' && m.member_number > max) ? m.member_number : max, 0);
          job.data = job.data.map(m => {
            if (m && (m.member_number === undefined || m.member_number === null || typeof m.member_number !== 'number')) {
              maxMemberNum++;
              m.member_number = maxMemberNum;
              changed = true;
            }
            return m;
          });
        }
        return job;
      });
      if (changed) {
        localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
        console.log('Sync Queue healed of missing member numbers.');
      }
    }
  } catch (e) {
    console.error('Failed to heal sync queue:', e);
  }
}

export function initSupabaseConfig() {
  healSyncQueue();
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
// DIRECT DEBOUNCED SYNC ENGINE (Self-Healing, Multi-Browser Alignment)
// ----------------------------------------------------

const debounceTimers = {};

export function enqueueSyncJob(table, data) {
  if (localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) === 'false') return;

  const client = getSupabase();
  if (!client) return;

  if (debounceTimers[table]) {
    clearTimeout(debounceTimers[table]);
  }

  updateState({ supabaseSyncing: true });

  debounceTimers[table] = setTimeout(async () => {
    try {
      console.log(`Direct Sync: Saving table "${table}" to Supabase...`);
      const { error } = await client.from(table).upsert(data);
      if (error) {
        console.error(`Direct Sync error for ${table}:`, error);
        updateState({ 
          supabaseConnectionStatus: 'error',
          supabaseConnectionError: `সিঙ্ক ত্রুটি (${table}): ${error.message}`,
          supabaseSyncing: false
        });
      } else {
        updateState({ 
          supabaseConnectionStatus: 'connected',
          supabaseConnectionError: '',
          supabaseSyncing: false
        });
      }
    } catch (err) {
      console.error(`Direct Sync exception for ${table}:`, err);
      updateState({ supabaseSyncing: false });
    }
  }, 400); // 400ms debounce to pack multiple changes (e.g., bulk log entry)
}

export async function processSyncQueue() {
  // Dummy helper for backwards compatibility
  return;
}

// ----------------------------------------------------
// REALTIME LIVE SYNCHRONIZATION (Fetch-Based Source-of-Truth Alignment)
// ----------------------------------------------------

const realtimeDebounceTimers = {};

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
      console.log('Realtime change detected on "members":', payload);
      handleRealtimeChange('members', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, (payload) => {
      console.log('Realtime change detected on "activity_logs":', payload);
      handleRealtimeChange('activity_logs', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'badges' }, (payload) => {
      console.log('Realtime change detected on "badges":', payload);
      handleRealtimeChange('badges', payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_trails' }, (payload) => {
      console.log('Realtime change detected on "audit_trails":', payload);
      handleRealtimeChange('audit_trails', payload);
    })
    .subscribe((status) => {
      console.log('Supabase realtime connection status:', status);
    });
}

async function handleRealtimeTableSync(table) {
  if (realtimeDebounceTimers[table]) {
    clearTimeout(realtimeDebounceTimers[table]);
  }

  // 200ms debounce to group rapid successive broadcasts from other browser sessions
  realtimeDebounceTimers[table] = setTimeout(async () => {
    const client = getSupabase();
    if (!client) return;

    try {
      console.log(`Realtime Fetch: Re-aligning local table "${table}" with Supabase...`);
      const { data, error } = await client.from(table).select('*');
      if (error) {
        console.error(`Failed to fetch latest table "${table}" via realtime trigger:`, error);
        return;
      }

      if (data) {
        console.log(`Realtime Fetch: Successfully synchronized ${data.length} records for "${table}"`);
        saveLocalDataWithoutSync(table, data);
        triggerStateReload(table);
      }
    } catch (err) {
      console.error(`Exception during realtime table fetch "${table}":`, err);
    }
  }, 200);
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

  // Align local cache by downloading the entire table from Supabase directly
  handleRealtimeTableSync(table);
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
