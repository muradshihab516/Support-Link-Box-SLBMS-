// Support Link Box - Member Mutations, Parser, and Recalculator

import { ADMIN_NAMES, CONFIG } from './constants.js';
import { getState, updateState } from './state.js';
import { 
  getMembers, saveMembers, 
  getActivityLogs, saveActivityLogs, 
  getAuditTrails, saveAuditTrails, 
  getBadges, saveBadges,
  cleanName, getNormalizedName, 
  getYesterdayDateStr, getDiffDays, generateUUID 
} from './database.js';
import { showToast } from './toast.js';
import { showAlert } from './modal.js';

// Add single member
export function handleAddMember(rawName, notes = '') {
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
    id: generateUUID(),
    name: cleaned,
    display_name: `@${cleaned.replace(/\s+/g, '')}`,
    member_number: nextMemberNum,
    status: 'active',
    level: CONFIG.LEVELS.BRONZE,
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

  // Add audit trail record
  const state = getState();
  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: state.currentAdminEmail,
    admin_name: adminName,
    action: 'ADD_MEMBER',
    entity_type: 'MEMBER',
    description: `Registered new member: ${cleaned} (No. ${nextMemberNum})`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });
  return true;
}

// Bulk Add Members
export function handleBulkAddMembers(namesList) {
  if (!Array.isArray(namesList) || namesList.length === 0) {
    return { successCount: 0, duplicateNames: [], totalAttempted: 0 };
  }
  
  const members = getMembers();
  const auditTrails = getAuditTrails();
  const state = getState();
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
      id: generateUUID(),
      name: cleaned,
      display_name: `@${cleaned.replace(/\s+/g, '')}`,
      member_number: maxMemberNum,
      status: 'active',
      level: CONFIG.LEVELS.BRONZE,
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
      id: `audit-${generateUUID()}`,
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
    updateState({
      members: getMembers(),
      auditTrails: getAuditTrails()
    });
  }
  
  return { successCount, duplicateNames, totalAttempted: namesList.length };
}

// Bulk mention text extractor
export function parseBulkActivityText(text) {
  if (!text) return { parsedNames: [], matchedMembers: [], unregisteredNames: [] };

  const parsedNames = [];
  // Strict regex parser separated into clean isolated algorithm to protect Messenger shifts
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

// Helper to analyze duplicate unregistered names from the raw input text
export function analyzeUnregisteredDuplicates(text) {
  if (!text) return [];
  
  // 1. Extract ALL parsed raw names (preserving duplicates)
  const allParsedNames = [];
  const regex = /@([^\n\r0-9📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const extracted = match[1].trim();
    if (extracted && extracted.length > 1) {
      const cleaned = extracted.replace(/^[➤\s]+/, '').trim();
      const cleanedFinal = cleanName(cleaned);
      if (cleanedFinal) {
        allParsedNames.push(cleanedFinal);
      }
    }
  }
  
  if (allParsedNames.length === 0) {
    const parts = text.split('@');
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const namePartMatch = part.match(/^([^0-9📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/);
      if (namePartMatch) {
        const cleaned = namePartMatch[1].trim();
        const cleanedFinal = cleanName(cleaned);
        if (cleanedFinal && cleanedFinal.length > 1) {
          allParsedNames.push(cleanedFinal);
        }
      }
    }
  }
  
  // 2. Filter out names that are already registered
  const members = getMembers();
  const unregisteredOccurrences = [];
  
  allParsedNames.forEach(rawName => {
    const cleaned = cleanName(rawName);
    const isRegistered = members.some(m => {
      const normMName = getNormalizedName(m.name);
      const normMDisplayName = getNormalizedName(m.display_name || '');
      const normCleaned = getNormalizedName(cleaned);
      return normMName === normCleaned || normMDisplayName === normCleaned;
    });
    
    if (!isRegistered) {
      unregisteredOccurrences.push(cleaned);
    }
  });
  
  // 3. Count frequencies
  const frequencies = {};
  unregisteredOccurrences.forEach(name => {
    frequencies[name] = (frequencies[name] || 0) + 1;
  });
  
  // 4. Extract duplicates (frequency >= 2)
  const duplicates = [];
  Object.keys(frequencies).forEach(name => {
    if (frequencies[name] >= 2) {
      duplicates.push({
        name,
        count: frequencies[name]
      });
    }
  });
  
  return duplicates;
}

// Helper to analyze all duplicate names (both registered and unregistered) from raw input text
export function analyzeAllDuplicates(text) {
  if (!text) return [];
  
  // 1. Extract ALL parsed raw names (preserving duplicates)
  const allParsedNames = [];
  const regex = /@([^\n\r0-9📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const extracted = match[1].trim();
    if (extracted && extracted.length > 1) {
      const cleaned = extracted.replace(/^[➤\s]+/, '').trim();
      const cleanedFinal = cleanName(cleaned);
      if (cleanedFinal) {
        allParsedNames.push(cleanedFinal);
      }
    }
  }
  
  if (allParsedNames.length === 0) {
    const parts = text.split('@');
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const namePartMatch = part.match(/^([^0-9📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/);
      if (namePartMatch) {
        const cleaned = namePartMatch[1].trim();
        const cleanedFinal = cleanName(cleaned);
        if (cleanedFinal && cleanedFinal.length > 1) {
          allParsedNames.push(cleanedFinal);
        }
      }
    }
  }
  
  // 2. Count frequencies of ALL parsed names using normalized names to group
  const frequencies = {};
  allParsedNames.forEach(name => {
    const norm = getNormalizedName(name);
    if (!frequencies[norm]) {
      frequencies[norm] = {
        originalName: name,
        count: 0
      };
    }
    frequencies[norm].count++;
  });
  
  // 3. Extract duplicates (frequency >= 2)
  const duplicates = [];
  Object.keys(frequencies).forEach(norm => {
    if (frequencies[norm].count >= 2) {
      duplicates.push({
        name: frequencies[norm].originalName,
        count: frequencies[norm].count
      });
    }
  });
  
  return duplicates;
}

// ----------------------------------------------------
// SUB-FUNCTIONS FOR MEMBER VALUE RECALCULATIONS (Point 6)
// ----------------------------------------------------

export function calculatePoints(member, isActive) {
  return isActive ? member.total_points + CONFIG.POINTS.DAILY_ACTIVITY : member.total_points;
}

export function calculateStreak(member, isActive, dateStr, yesterdayStr) {
  if (!isActive) {
    let inactiveDays = member.consecutive_inactive_days;
    if (member.last_active_date) {
      inactiveDays = getDiffDays(dateStr, member.last_active_date);
    } else {
      inactiveDays += 1;
    }
    // If consecutive inactive days are strictly greater than 1, reset streak to zero
    return inactiveDays > 1 ? 0 : member.current_streak;
  }

  // Active state
  if (member.last_active_date === yesterdayStr) {
    return member.current_streak + 1;
  } else if (member.last_active_date === dateStr) {
    return member.current_streak; // Same day, retain current streak
  } else {
    return 1; // Gap detected, restart at 1
  }
}

export function calculateLevel(totalPoints) {
  if (totalPoints >= CONFIG.LEVEL_POINTS.DIAMOND) return CONFIG.LEVELS.DIAMOND;
  if (totalPoints >= CONFIG.LEVEL_POINTS.PLATINUM) return CONFIG.LEVELS.PLATINUM;
  if (totalPoints >= CONFIG.LEVEL_POINTS.GOLD) return CONFIG.LEVELS.GOLD;
  if (totalPoints >= CONFIG.LEVEL_POINTS.SILVER) return CONFIG.LEVELS.SILVER;
  return CONFIG.LEVELS.BRONZE;
}

export function calculateStatus(member, isActive, dateStr) {
  if (member && member.status === 'frozen') return 'frozen';
  if (isActive) return 'active';

  let inactiveDays = member.consecutive_inactive_days;
  if (member.last_active_date) {
    inactiveDays = getDiffDays(dateStr, member.last_active_date);
  } else {
    inactiveDays += 1;
  }

  if (inactiveDays >= 12) return 'inactive';
  if (inactiveDays >= 7) return 'warning';
  return 'active';
}

export function checkAndAssignBadges(member, currentStreak, totalPoints, badges) {
  const newBadges = [...badges];
  let updated = false;

  // Streak Badges
  if (currentStreak === 3 && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'streak_3')) {
    newBadges.push({
      id: `badge-${member.id}-streak3-${Date.now()}`,
      member_id: member.id,
      badge_type: 'streak_3',
      badge_name: '🥉 3-Day Streak Warrior',
      earned_at: new Date().toISOString()
    });
    updated = true;
  }
  if (currentStreak === 7 && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'streak_7')) {
    newBadges.push({
      id: `badge-${member.id}-streak7-${Date.now()}`,
      member_id: member.id,
      badge_type: 'streak_7',
      badge_name: '🥈 7-Day Streak Master',
      earned_at: new Date().toISOString()
    });
    updated = true;
  }
  if (currentStreak === 15 && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'streak_15')) {
    newBadges.push({
      id: `badge-${member.id}-streak15-${Date.now()}`,
      member_id: member.id,
      badge_type: 'streak_15',
      badge_name: '👑 15-Day Ultimate Streak',
      earned_at: new Date().toISOString()
    });
    updated = true;
  }

  // Level Badges
  if (totalPoints >= CONFIG.LEVEL_POINTS.SILVER && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'silver_points')) {
    newBadges.push({
      id: `badge-${member.id}-silver-${Date.now()}`,
      member_id: member.id,
      badge_type: 'silver_points',
      badge_name: '⭐ Silver Contributor',
      earned_at: new Date().toISOString()
    });
    updated = true;
  }
  if (totalPoints >= CONFIG.LEVEL_POINTS.GOLD && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'gold_points')) {
    newBadges.push({
      id: `badge-${member.id}-gold-${Date.now()}`,
      member_id: member.id,
      badge_type: 'gold_points',
      badge_name: '🏆 Gold Ambassador',
      earned_at: new Date().toISOString()
    });
    updated = true;
  }

  return { badges: newBadges, updated };
}

// Save Daily Submissions
export function submitBulkActivity(dateStr, activeMemberIds) {
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
  const state = getState();
  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';

  // Save rollback snapshot
  const snapshot = {
    timestamp: new Date().toISOString(),
    submissionDate: dateStr,
    membersState: JSON.parse(JSON.stringify(members)),
    logsState: JSON.parse(JSON.stringify(logs)),
    badgesState: JSON.parse(JSON.stringify(badges))
  };
  localStorage.setItem('support_linkbox_last_submission_snapshot', JSON.stringify(snapshot));

  const yesterdayStr = getYesterdayDateStr(dateStr);
  let loggedCount = 0;
  let dynamicBadgesList = [...badges];

  const updatedMembers = members.map(member => {
    // Keep frozen members exactly as they are unless they have been reactivated and matched as active
    const isActive = activeMemberIds.includes(member.id);
    if (member.status === 'frozen' && !isActive) {
      return member;
    }

    if (isActive) {
      logs.push({
        id: `log-${member.id}-${dateStr}-${Date.now()}`,
        member_id: member.id,
        activity_date: dateStr,
        is_active: true,
        points_earned: CONFIG.POINTS.DAILY_ACTIVITY,
        submitted_by: state.currentAdminEmail,
        created_at: new Date().toISOString()
      });
      loggedCount++;

      const newPoints = calculatePoints(member, true);
      const newStreak = calculateStreak(member, true, dateStr, yesterdayStr);
      const longestStreak = Math.max(member.longest_streak, newStreak);
      const totalActiveDays = member.total_active_days + 1;
      const level = calculateLevel(newPoints);
      const status = 'active';

      // Assign badges
      const badgeResult = checkAndAssignBadges(member, newStreak, newPoints, dynamicBadgesList);
      if (badgeResult.updated) {
        dynamicBadgesList = badgeResult.badges;
      }

      return {
        ...member,
        total_points: newPoints,
        current_streak: newStreak,
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

      const newStreak = calculateStreak(member, false, dateStr, yesterdayStr);
      const status = calculateStatus(member, false, dateStr);

      return {
        ...member,
        current_streak: newStreak,
        consecutive_inactive_days: inactiveDays,
        status,
        updated_at: new Date().toISOString()
      };
    }
  });

  saveMembers(updatedMembers);
  saveActivityLogs(logs);
  saveBadges(dynamicBadgesList);

  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: state.currentAdminEmail,
    admin_name: adminName,
    action: 'SUBMIT_BULK_ACTIVITY',
    entity_type: 'ACTIVITY',
    description: `Processed activity for ${dateStr}. Marked ${activeMemberIds.length} active out of ${members.length} members.`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails(),
    bulkInputText: '',
    uncheckedUnregisteredNames: [],
    lastSubmissionSnapshot: snapshot
  });
  showToast('মেম্বার অ্যাক্টিভিটি এবং ডেইলি লিংক সফলভাবে সেভ করা হয়েছে!', 'success');
}

// Helper to calculate statistics for Pending Submission Preview
export function calculateSubmissionStats(rawText, resolvedText, resolvedDuplicates = []) {
  const members = getMembers();
  
  // 1. Calculate duplicates and skipped from resolvedDuplicates
  let duplicateCount = 0;
  let skippedCount = 0;
  
  if (resolvedDuplicates && resolvedDuplicates.length > 0) {
    duplicateCount = resolvedDuplicates.length;
    resolvedDuplicates.forEach(d => {
      d.occurrences.forEach(occ => {
        if (occ.skipped) {
          skippedCount++;
        }
      });
    });
  } else {
    // If we didn't go through duplicate resolution modal (i.e. no duplicates),
    // let's run the analyzer just in case
    const dups = analyzeAllDuplicates(rawText);
    duplicateCount = dups.length;
  }

  // 2. Parse the resolved text (or raw text if no duplicates)
  const textToParse = resolvedText || rawText;
  const { parsedNames, matchedMembers, unregisteredNames } = parseBulkActivityText(textToParse);
  
  // 3. Count categories
  let registeredCount = 0;
  let frozenCount = 0;
  let aliasCount = 0;
  
  matchedMembers.forEach(m => {
    if (m.status === 'frozen') {
      frozenCount++;
    } else {
      registeredCount++;
    }
    
    // Check if matched on alias (display_name matches but name doesn't)
    const normName = getNormalizedName(m.name);
    const normDisp = getNormalizedName(m.display_name || '');
    parsedNames.forEach(pn => {
      const normPn = getNormalizedName(cleanName(pn));
      if (normPn === normDisp && normPn !== normName) {
        aliasCount++;
      }
    });
  });

  // 4. Count new members (unregistered ones)
  const newCount = unregisteredNames.length;

  // 5. Invalid name count:
  const totalAtSymbols = (textToParse.match(/@/g) || []).length;
  const invalidCount = Math.max(0, totalAtSymbols - parsedNames.length);

  // 6. Total activity added
  const totalActivityAdded = registeredCount;
  
  return {
    submissionDate: getState().bulkInputDate,
    totalParsed: parsedNames.length,
    registeredCount,
    newCount,
    duplicateCount,
    skippedCount,
    frozenCount,
    aliasCount,
    invalidCount,
    totalActivityAdded
  };
}
