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

// Low-level safe database persistence
function saveToLocalStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Failed to persist key "${key}" to localStorage:`, err);
  }
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
  saveToLocalStorage(STORAGE_KEYS.MEMBERS, members);
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
  saveToLocalStorage(STORAGE_KEYS.LOGS, logs);
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
  saveToLocalStorage(STORAGE_KEYS.AUDIT, trails);
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
  saveToLocalStorage(STORAGE_KEYS.BADGES, badges);
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
export function removeDiacritics(str) {
  if (!str) return '';
  try {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    return str;
  }
}

export function normalizeFancyUnicode(str) {
  if (!str) return '';
  try {
    let res = str.normalize('NFKD');
    return removeDiacritics(res);
  } catch (e) {
    return str;
  }
}

// Strip extraneous noise, links, tags, and disambiguation artifacts from a raw name candidate
export function cleanName(name) {
  if (!name) return '';
  let cleaned = name.trim();
  
  // Continuously strip leading list bullets, numbers, emoji digits, prefixes, @ and bullets
  // Handles: 1., ১২., 1️⃣➤, 9️⃣1️⃣➤, 🔟➤, @, •, *, -, ➤, etc.
  cleaned = cleaned.replace(/^(\d+\uFE0F?\u20E3|🔟|[\s0-9০-৯①-⑩❶-❿➤•*\-–—~#_.:=/@|\\])+/u, '').trim();
  cleaned = cleaned.replace(/^[\s@➤•*\-–—~#_.:=/|\\]+/, '').trim();
  
  // Remove trailing URLs (e.g. http://..., https://..., fb.com/..., fb.me/...)
  cleaned = cleaned.replace(/\s*https?:\/\/[^\s]+/gi, '').trim();
  cleaned = cleaned.replace(/\s*www\.[^\s]+/gi, '').trim();
  cleaned = cleaned.replace(/\s*fb\.(?:me|com)\/[^\s]+/gi, '').trim();

  // Remove annotations in parentheses, square brackets, or curly braces (e.g. (FB), [Link], (3 days gap), (active), {done})
  cleaned = cleaned.replace(/\s*\([^)]*\)/g, '').trim();
  cleaned = cleaned.replace(/\s*\[[^\]]*\]/g, '').trim();
  cleaned = cleaned.replace(/\s*\{[^}]*\}/g, '').trim();

  // Remove trailing status notes / separator comments (e.g. : done, - done, / 1 link, | active, ✓, ✅, - 2 links)
  cleaned = cleaned.replace(/\s*[-:—–/|✓✔✅]+\s*(done|link|links|active|post|posts|sub|gap|\d+\s*(link|links)?|\d+)?\s*$/gi, '').trim();
  cleaned = cleaned.replace(/\s+(done|active|link|links|submitted|ok|checked|pass)$/gi, '').trim();

  // Remove trailing occurrence/disambiguation numbers (e.g. "Jakaria 1", "Jakaria #2", "Jakaria_1")
  cleaned = cleaned.replace(/[\s_]+#?\d+$/g, '').trim();

  // Remove leading/trailing punctuation and unicode spaces
  cleaned = cleaned.replace(/^[.,:;!?'"`~/\-_|\\+*^%$#@!<>]+|[.,:;!?'"`~/\-_|\\+*^%$#@!<>]+$/g, '').trim();
  cleaned = cleaned.replace(/[\s\u00A0\u200B\u200C\u200D\u200E\u200F\uFEFF\u3000]+/g, ' ').trim();
  
  return cleaned;
}

export function getNormalizedName(name) {
  if (!name) return '';
  const cleaned = cleanName(name);
  return cleaned.toLowerCase()
    .replace(/^@+/, '')
    .replace(/[\s\u00A0\u200B\u200C\u200D\u200E\u200F\uFEFF\u3000]+/g, '')
    .trim();
}

export function getUltraNormalizedName(name) {
  if (!name) return '';
  const cleaned = cleanName(name);
  const fancyDecomposed = normalizeFancyUnicode(cleaned);
  return fancyDecomposed.toLowerCase()
    .replace(/^@+/, '')
    .replace(/[.\-_'"`~,;:!?()\[\]{}|\\/+=*^%$#@!<>]/g, '')
    .replace(/[卝ヅシツʚʆɞヽ・T🅾️⭐⚡✨👑🔥💎✦★☆✓✔✕✖]/g, '')
    .replace(/[\s\u00A0\u200B\u200C\u200D\u200E\u200F\uFEFF\u3000]+/g, '')
    .trim();
}

// Canonical token normalizer for Bangladeshi & social media names
export const HONORIFIC_VARIANTS = {
  md: ['md', 'm.d.', 'm.d', 'md.', 'mohammad', 'mohammed', 'muhammad', 'muhammed', 'mohammod', 'muhammod', 'mohamad', 'muhamad'],
  sm: ['sm', 's.m.', 's.m', 'sm.', 's m', 's. m.'],
  hm: ['hm', 'h.m.', 'h.m', 'hm.', 'h m', 'h. m.'],
  sk: ['sk', 'sk.', 'sheikh', 'shaikh', 'sek', 'sekh'],
  mst: ['mst', 'mst.', 'most', 'most.', 'musammat', 'mosammat'],
  dr: ['dr', 'dr.', 'doctor'],
  engr: ['engr', 'engr.', 'engineer'],
  kazi: ['kazi', 'qazi', 'quazi', 'kaazi'],
  syed: ['syed', 'sayed', 'sayeed', 'sayid'],
  al: ['al', 'el', 'al-', 'el-']
};

export const COMMON_SPELLING_VARIANTS = {
  hossain: ['hossain', 'hosain', 'hussain', 'husain', 'hosein', 'hosen', 'husen'],
  shakil: ['shakil', 'shakhil', 'sakil', 'shaqil', 'saqil', 'shakill'],
  shihab: ['shihab', 'sihab', 'shehab', 'sehab'],
  rabiul: ['rabiul', 'robiul', 'rabyul', 'robyul'],
  hasan: ['hasan', 'hassan', 'hasen', 'hassen'],
  ahmed: ['ahmed', 'ahmad', 'ahmod', 'ahmet'],
  islam: ['islam', 'easlam', 'eslam'],
  rahman: ['rahman', 'rohman', 'rahmaan', 'rohmaan'],
  swapon: ['swapon', 'sopon', 'shapon', 'swapan', 'sapon'],
  orithra: ['orithra', 'orittra', 'oritra', 'oriktra', 'orintra'],
  sohel: ['sohel', 'suhel', 'soyel', 'suyel'],
  rana: ['rana', 'ronah', 'raana'],
  khan: ['khan', 'khaan'],
  alamin: ['alamin', 'al-amin', 'al amin', 'al_amin'],
  chowdhury: ['chowdhury', 'choudhury', 'choudhuri', 'chowdhuri', 'chy'],
  mostofa: ['mostofa', 'mostafa', 'mustafa', 'mustapha'],
  mahfuz: ['mahfuz', 'mahfuzur', 'mahfuzul', 'mahfooz'],
  tanvir: ['tanvir', 'tanveer', 'tanver'],
  jahid: ['jahid', 'zahid', 'jahed', 'zahed'],
  faisal: ['faisal', 'faysal', 'faishal', 'feysal'],
  parvez: ['parvez', 'pervez', 'parvej', 'pervej'],
  mizan: ['mizan', 'mizanur', 'mijan', 'mijanur'],
  ashik: ['ashik', 'asik', 'ashiq', 'asiq'],
  tamim: ['tamim', 'tameem'],
  tarek: ['tarek', 'tareq', 'tarik', 'tariq'],
  mehedi: ['mehedi', 'mahadi', 'mahedi', 'mehedy'],
  monir: ['monir', 'monirul', 'manir', 'manirul'],
  sumon: ['sumon', 'shumon', 'soumon'],
  ripon: ['ripon', 'ripan', 'repon'],
  mithu: ['mithu', 'mithun', 'meethu'],
  babu: ['babu', 'baabu', 'bhabu']
};

// Break a name into canonicalized tokens
export function getCanonicalTokens(name) {
  if (!name) return [];
  const cleaned = cleanName(name);
  const ultra = normalizeFancyUnicode(cleaned)
    .toLowerCase()
    .replace(/[.\-_'"`~,;:!?()\[\]{}|\\/+=*^%$#@!<>]/g, ' ')
    .replace(/[\s\u00A0\u200B\u200C\u200D\u200E\u200F\uFEFF\u3000]+/g, ' ')
    .trim();

  const words = ultra.split(' ').filter(w => w.length > 0);

  return words.map(w => {
    // Check honorifics
    for (const [canonical, variants] of Object.entries(HONORIFIC_VARIANTS)) {
      if (variants.includes(w)) {
        return canonical;
      }
    }
    // Check common spelling variations
    for (const [canonical, variants] of Object.entries(COMMON_SPELLING_VARIANTS)) {
      if (variants.includes(w)) {
        return canonical;
      }
    }
    return w;
  });
}

// Canonical concatenated string (e.g. "Md. Jakaria Hossain" -> "mdjakariahome")
export function getCanonicalNormalizedString(name) {
  const tokens = getCanonicalTokens(name);
  return tokens.join('');
}

// Calculate comprehensive similarity ratio (0 to 1) with token-awareness
export function calculateNameSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const clean1 = cleanName(str1);
  const clean2 = cleanName(str2);
  if (clean1.toLowerCase() === clean2.toLowerCase()) return 1.0;

  const ultra1 = getUltraNormalizedName(str1);
  const ultra2 = getUltraNormalizedName(str2);
  if (!ultra1 || !ultra2) return 0;
  if (ultra1 === ultra2) return 1.0;

  const canon1 = getCanonicalNormalizedString(str1);
  const canon2 = getCanonicalNormalizedString(str2);
  if (canon1 && canon2 && canon1 === canon2) return 0.98;

  // Substring containment on ultra / canonical strings
  if (ultra1.includes(ultra2) || ultra2.includes(ultra1)) {
    const lenRatio = Math.min(ultra1.length, ultra2.length) / Math.max(ultra1.length, ultra2.length);
    if (lenRatio >= 0.60) return 0.90 + (lenRatio * 0.08);
  }
  if (canon1 && canon2 && (canon1.includes(canon2) || canon2.includes(canon1))) {
    const lenRatio = Math.min(canon1.length, canon2.length) / Math.max(canon1.length, canon2.length);
    if (lenRatio >= 0.60) return 0.90 + (lenRatio * 0.08);
  }

  // Token Jaccard similarity & overlap
  const tokens1 = getCanonicalTokens(str1);
  const tokens2 = getCanonicalTokens(str2);
  
  if (tokens1.length > 0 && tokens2.length > 0) {
    const coreTokens1 = tokens1.filter(t => !['md', 'mst', 'sm', 'hm', 'sk', 'dr', 'engr'].includes(t));
    const coreTokens2 = tokens2.filter(t => !['md', 'mst', 'sm', 'hm', 'sk', 'dr', 'engr'].includes(t));
    
    // Core tokens exact match (e.g. "Md. Jakaria" vs "Jakaria")
    if (coreTokens1.length > 0 && coreTokens2.length > 0) {
      const coreSet1 = new Set(coreTokens1);
      const coreSet2 = new Set(coreTokens2);
      const intersection = coreTokens1.filter(t => coreSet2.has(t));
      const union = new Set([...coreTokens1, ...coreTokens2]);
      const jaccard = intersection.length / union.size;
      
      if (jaccard === 1.0) {
        return 0.95;
      } else if (jaccard >= 0.66 && intersection.length >= 2) {
        return 0.88;
      }
    }
  }

  // Levenshtein distance on canonical or ultra
  const s1 = canon1 || ultra1;
  const s2 = canon2 || ultra2;
  const track = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));
  for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
  for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;
  for (let j = 1; j <= s2.length; j += 1) {
    for (let i = 1; i <= s1.length; i += 1) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }
  const distance = track[s2.length][s1.length];
  const maxLen = Math.max(s1.length, s2.length);
  return Math.max(0, 1 - (distance / maxLen));
}

// Multi-tier member lookup engine with AI-grade precision
export function findMatchingMember(rawName, membersList) {
  if (!rawName || !membersList || membersList.length === 0) return null;
  const cleaned = cleanName(rawName);
  if (!cleaned) return null;
  
  const norm = getNormalizedName(cleaned);
  const ultra = getUltraNormalizedName(cleaned);
  const canon = getCanonicalNormalizedString(cleaned);
  const candTokens = getCanonicalTokens(cleaned);
  const candCoreTokens = candTokens.filter(t => !['md', 'mst', 'sm', 'hm', 'sk', 'dr', 'engr'].includes(t));

  // Tier 1: Exact clean name or display_name match
  let match = membersList.find(m => cleanName(m.name) === cleaned || cleanName(m.display_name || '') === cleaned);
  if (match) return { member: match, confidence: 'exact', type: 'exact' };

  // Tier 2: Standard normalized match
  match = membersList.find(m => {
    const mNorm = getNormalizedName(m.name);
    const mDispNorm = getNormalizedName(m.display_name || '');
    return mNorm === norm || mDispNorm === norm;
  });
  if (match) return { member: match, confidence: 'high', type: 'normalized' };

  // Tier 3: Ultra-normalized match (strips dots, punctuation, diacritics, fancy characters)
  if (ultra.length >= 2) {
    match = membersList.find(m => {
      const mUltra = getUltraNormalizedName(m.name);
      const mDispUltra = getUltraNormalizedName(m.display_name || '');
      return mUltra === ultra || mDispUltra === ultra;
    });
    if (match) return { member: match, confidence: 'high', type: 'ultra' };
  }

  // Tier 4: Canonical Honorific & Spelling Match (e.g. "Mohammad Shakil" <-> "Md. Shakil")
  if (canon.length >= 3) {
    match = membersList.find(m => {
      const mCanon = getCanonicalNormalizedString(m.name);
      const mDispCanon = getCanonicalNormalizedString(m.display_name || '');
      return mCanon === canon || mDispCanon === canon;
    });
    if (match) return { member: match, confidence: 'high', type: 'canonical' };
  }

  // Tier 5: Aliases match (check exact, normalized, ultra, and canonical across all aliases)
  match = membersList.find(m => {
    if (Array.isArray(m.aliases)) {
      return m.aliases.some(alias => {
        if (!alias) return false;
        const aClean = cleanName(alias);
        if (aClean === cleaned) return true;
        if (getNormalizedName(alias) === norm) return true;
        if (getUltraNormalizedName(alias) === ultra) return true;
        if (getCanonicalNormalizedString(alias) === canon) return true;
        return false;
      });
    }
    return false;
  });
  if (match) return { member: match, confidence: 'high', type: 'alias' };

  // Tier 6: Core Token Subset & Permutation Match
  // E.g. Candidate: "Jakaria Hosain" -> Member: "MD. Jakaria Hossain"
  if (candCoreTokens.length >= 1 && (candCoreTokens.join('').length >= 4)) {
    const candidateMatches = [];
    
    membersList.forEach(m => {
      const mTokens = getCanonicalTokens(m.name);
      const mCoreTokens = mTokens.filter(t => !['md', 'mst', 'sm', 'hm', 'sk', 'dr', 'engr'].includes(t));
      
      // Check if all core tokens of candidate exist in member's core tokens
      if (candCoreTokens.length >= 2 && candCoreTokens.every(t => mCoreTokens.includes(t))) {
        candidateMatches.push({ member: m, score: 0.92 });
        return;
      }
      // Check if all core tokens of member exist in candidate's core tokens
      if (mCoreTokens.length >= 2 && mCoreTokens.every(t => candCoreTokens.includes(t))) {
        candidateMatches.push({ member: m, score: 0.90 });
        return;
      }
      // Single long core token exact match (e.g. unique first/last name with >= 6 chars)
      if (candCoreTokens.length === 1 && mCoreTokens.length === 1 && candCoreTokens[0] === mCoreTokens[0] && candCoreTokens[0].length >= 5) {
        candidateMatches.push({ member: m, score: 0.88 });
      }
    });

    if (candidateMatches.length === 1) {
      return { member: candidateMatches[0].member, confidence: 'high', type: 'token_subset' };
    }
  }

  // Tier 7: High Confidence Fuzzy Match (similarity >= 0.86)
  let bestFuzzy = null;
  let highestScore = 0;
  membersList.forEach(m => {
    const sim1 = calculateNameSimilarity(cleaned, m.name);
    const sim2 = m.display_name ? calculateNameSimilarity(cleaned, m.display_name) : 0;
    let simAlias = 0;
    if (Array.isArray(m.aliases)) {
      m.aliases.forEach(a => {
        const s = calculateNameSimilarity(cleaned, a);
        if (s > simAlias) simAlias = s;
      });
    }
    const maxSim = Math.max(sim1, sim2, simAlias);
    if (maxSim > highestScore) {
      highestScore = maxSim;
      bestFuzzy = m;
    }
  });

  if (bestFuzzy && highestScore >= 0.86) {
    return { member: bestFuzzy, confidence: 'fuzzy_high', type: 'fuzzy_auto' };
  }

  return null;
}

// Find fuzzy suggestion for ambiguous/unregistered names with comprehensive scoring
export function findFuzzyMemberSuggestion(rawName, membersList, threshold = 0.50) {
  if (!rawName || !membersList || membersList.length === 0) return null;
  const cleaned = cleanName(rawName);
  if (!cleaned || cleaned.length < 2) return null;

  let bestMatch = null;
  let highestScore = 0;

  membersList.forEach(m => {
    const score1 = calculateNameSimilarity(cleaned, m.name);
    const score2 = m.display_name ? calculateNameSimilarity(cleaned, m.display_name) : 0;
    let scoreAlias = 0;
    if (Array.isArray(m.aliases)) {
      m.aliases.forEach(a => {
        const aScore = calculateNameSimilarity(cleaned, a);
        if (aScore > scoreAlias) scoreAlias = aScore;
      });
    }

    const maxScore = Math.max(score1, score2, scoreAlias);
    if (maxScore > highestScore && maxScore >= threshold) {
      highestScore = maxScore;
      bestMatch = m;
    }
  });

  if (bestMatch) {
    return { 
      member: bestMatch, 
      score: Math.round(highestScore * 100),
      similarity: Number(highestScore.toFixed(2))
    };
  }
  return null;
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

export function toBanglaNumber(num) {
  if (num === null || num === undefined) return '';
  const banglaDigits = {
    '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
    '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯'
  };
  return num.toString().split('').map(d => banglaDigits[d] || d).join('');
}

export function getEmojiNumber(num) {
  if (num === 10) return '🔟';
  const digitMap = {
    '0': '0️⃣',
    '1': '1️⃣',
    '2': '2️⃣',
    '3': '3️⃣',
    '4': '4️⃣',
    '5': '5️⃣',
    '6': '6️⃣',
    '7': '7️⃣',
    '8': '8️⃣',
    '9': '9️⃣'
  };
  return num.toString().split('').map(d => digitMap[d] || d).join('');
}

