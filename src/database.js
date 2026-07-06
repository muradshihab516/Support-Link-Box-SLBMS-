// Support Link Box - High Performance Local Database with Memory Caching

import { STORAGE_KEYS } from './constants.js';

// Local Memory Cache
const dbCache = {
  members: null,
  logs: null,
  audit: null,
  badges: null
};

// Database Initializer
export function initializeDatabase() {
  // Purge legacy demo data if detected to ensure a completely clean start
  try {
    const existingMembersRaw = localStorage.getItem(STORAGE_KEYS.MEMBERS);
    if (existingMembersRaw) {
      const existingMembers = JSON.parse(existingMembersRaw);
      const hasLegacyDemo = Array.isArray(existingMembers) && existingMembers.some(m => 
        m && (m.name === 'Rahi Ahmed Rabiul' || m.name === 'HM Jakaria Ahmed' || m.id === 'member-1')
      );
      if (hasLegacyDemo) {
        localStorage.removeItem(STORAGE_KEYS.MEMBERS);
        localStorage.removeItem(STORAGE_KEYS.LOGS);
        localStorage.removeItem(STORAGE_KEYS.AUDIT);
        localStorage.removeItem(STORAGE_KEYS.BADGES);
        console.log('Legacy demo database detected and successfully purged from LocalStorage.');
      }
    }
  } catch (e) {
    console.error('Error checking or purging legacy demo database:', e);
  }

  // Ensure initial empty values exist
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

// Low-level safe background persistence
function asyncSaveToLocalStorage(key, data) {
  setTimeout(() => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.error(`Failed to persist key "${key}" to localStorage:`, err);
    }
  }, 0);
}

// Getters and Setters using Memory Caching
export function getMembers() {
  if (dbCache.members !== null) {
    return dbCache.members;
  }
  initializeDatabase();
  try {
    let rawMembers = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || '[]');
    if (Array.isArray(rawMembers)) {
      let maxMemberNum = rawMembers.reduce((max, m) => (m && m.member_number && typeof m.member_number === 'number' && m.member_number > max) ? m.member_number : max, 0);
      let healed = false;
      rawMembers = rawMembers.map(m => {
        if (!m) return m;
        let changed = false;
        if (!m.id) {
          m.id = generateUUID();
          changed = true;
        }
        if (!m.name) {
          m.name = 'Unknown Member';
          changed = true;
        }
        if (m.member_number === undefined || m.member_number === null || typeof m.member_number !== 'number') {
          maxMemberNum++;
          m.member_number = maxMemberNum;
          changed = true;
        }
        if (changed) {
          healed = true;
        }
        return m;
      }).filter(Boolean);

      if (healed) {
        localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(rawMembers));
      }
      dbCache.members = rawMembers;
    } else {
      dbCache.members = [];
    }
  } catch (err) {
    console.error('Failed to parse members from storage, resetting:', err);
    dbCache.members = [];
  }
  return dbCache.members;
}

export function saveMembers(members, skipQueue = false) {
  dbCache.members = members;
  asyncSaveToLocalStorage(STORAGE_KEYS.MEMBERS, members);
  if (!skipQueue) {
    enqueueSyncJob('members', members);
  }
}

export function getActivityLogs() {
  if (dbCache.logs !== null) {
    return dbCache.logs;
  }
  try {
    dbCache.logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]');
  } catch (err) {
    console.error('Failed to parse logs from storage, resetting:', err);
    dbCache.logs = [];
  }
  return dbCache.logs;
}

export function saveActivityLogs(logs, skipQueue = false) {
  dbCache.logs = logs;
  asyncSaveToLocalStorage(STORAGE_KEYS.LOGS, logs);
  if (!skipQueue) {
    enqueueSyncJob('activity_logs', logs);
  }
}

export function getAuditTrails() {
  if (dbCache.audit !== null) {
    return dbCache.audit;
  }
  try {
    dbCache.audit = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT) || '[]');
  } catch (err) {
    console.error('Failed to parse audits from storage, resetting:', err);
    dbCache.audit = [];
  }
  return dbCache.audit;
}

export function saveAuditTrails(trails, skipQueue = false) {
  dbCache.audit = trails;
  asyncSaveToLocalStorage(STORAGE_KEYS.AUDIT, trails);
  if (!skipQueue) {
    enqueueSyncJob('audit_trails', trails);
  }
}

export function getBadges() {
  if (dbCache.badges !== null) {
    return dbCache.badges;
  }
  try {
    dbCache.badges = JSON.parse(localStorage.getItem(STORAGE_KEYS.BADGES) || '[]');
  } catch (err) {
    console.error('Failed to parse badges from storage, resetting:', err);
    dbCache.badges = [];
  }
  return dbCache.badges;
}

export function saveBadges(badges, skipQueue = false) {
  dbCache.badges = badges;
  asyncSaveToLocalStorage(STORAGE_KEYS.BADGES, badges);
  if (!skipQueue) {
    enqueueSyncJob('badges', badges);
  }
}

// Invalidate Cache (used on real-time external updates)
export function invalidateDbCache(table) {
  if (table === 'members') dbCache.members = null;
  else if (table === 'activity_logs') dbCache.logs = null;
  else if (table === 'audit_trails') dbCache.audit = null;
  else if (table === 'badges') dbCache.badges = null;
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

// Date helper algorithms
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

// Generate secure collision-resistant unique identifiers
export function generateUUID() {
  if (typeof self !== 'undefined' && self.crypto && typeof self.crypto.randomUUID === 'function') {
    return self.crypto.randomUUID();
  }
  // Fallback
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

// Deduplication engine with strict log and badge alignment
export function deduplicateMembers(members, client = null) {
  const uniqueMembers = [];
  const seenNormalizedNames = new Set();
  const duplicatesToDelete = [];

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
    
    const idMap = new Map();
    sorted.forEach(m => {
      const norm = getNormalizedName(m.name);
      const survivor = uniqueMembers.find(u => getNormalizedName(u.name) === norm);
      if (survivor && survivor.id !== m.id) {
        idMap.set(m.id, survivor.id);
      }
    });

    const logs = getActivityLogs();
    let logsUpdated = false;
    logs.forEach(l => {
      if (idMap.has(l.member_id)) {
        l.member_id = idMap.get(l.member_id);
        l.updated_at = new Date().toISOString();
        logsUpdated = true;
      }
    });
    if (logsUpdated) {
      saveActivityLogs(logs, true);
    }

    const badges = getBadges();
    let badgesUpdated = false;
    badges.forEach(b => {
      if (idMap.has(b.member_id)) {
        b.member_id = idMap.get(b.member_id);
        b.updated_at = new Date().toISOString();
        badgesUpdated = true;
      }
    });
    if (badgesUpdated) {
      saveBadges(badges, true);
    }

    // Process external remote deletion of duplicates if client exists
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

// Integrated with the global Sync Queue in /src/supabase.js
let syncEnqueueCallback = null;
export function registerSyncEnqueueHandler(handler) {
  syncEnqueueCallback = handler;
}

function enqueueSyncJob(table, data) {
  if (syncEnqueueCallback) {
    syncEnqueueCallback(table, data);
  }
}

export function getCurrentAdmin() {
  return localStorage.getItem(STORAGE_KEYS.CURRENT_ADMIN) || 'shihab@linkbox.com';
}

export function setCurrentAdmin(email) {
  localStorage.setItem(STORAGE_KEYS.CURRENT_ADMIN, email);
}
