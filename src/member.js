// Support Link Box - Member Mutations, Parser, and Recalculator

import { ADMIN_NAMES, CONFIG } from './constants.js';
import { getState, updateState } from './state.js';
import { 
  getMembers, saveMembers, 
  getActivityLogs, saveActivityLogs, 
  getAuditTrails, saveAuditTrails, 
  getBadges, saveBadges,
  cleanName, getNormalizedName, getUltraNormalizedName,
  findMatchingMember, findFuzzyMemberSuggestion, calculateNameSimilarity,
  getYesterdayDateStr, getDiffDays, generateUUID 
} from './database.js';
import { showToast } from './toast.js';
import { showAlert, showConfirm } from './modal.js';

// Add single member
export function handleAddMember(rawName, notes = '') {
  const cleaned = cleanName(rawName);
  if (!cleaned) {
    showToast('মেম্বার এর নাম ফাকা হতে পারে না!', 'error');
    return false;
  }

  const members = getMembers();
  const duplicate = members.find(m => {
    const norm = getNormalizedName(cleaned);
    const ultra = getUltraNormalizedName(cleaned);
    return getNormalizedName(m.name) === norm || getUltraNormalizedName(m.name) === ultra;
  });

  if (duplicate) {
    showAlert(`এই নামের মেম্বার (${duplicate.name} - No. ${duplicate.member_number}) ইতিমধ্যে আছে! নামের শেষে '1', '2' বা কিছু পার্থক্য যোগ করুন।`, 'ডুপ্লিকেট মেম্বার');
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
    aliases: [],
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
    
    const duplicate = members.find(m => {
      const norm = getNormalizedName(cleaned);
      const ultra = getUltraNormalizedName(cleaned);
      return getNormalizedName(m.name) === norm || getUltraNormalizedName(m.name) === ultra;
    });

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
      aliases: [],
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

// Bulk mention text extractor with Multi-Tier Matching Engine & Suggestions
export function parseBulkActivityText(text) {
  if (!text) return { parsedNames: [], matchedMembers: [], unregisteredNames: [], parsedItems: [] };

  const parsedNames = [];
  const rawOccurrences = [];
  
  // Regex extracting all mentions with prefixes like 1. @..., 9️⃣1️⃣➤@...
  const regex = /@([^\n\r📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const extracted = match[1].trim();
    if (extracted && extracted.length > 1) {
      const cleanedFinal = cleanName(extracted);
      if (cleanedFinal && cleanedFinal.length >= 2) {
        rawOccurrences.push(cleanedFinal);
        if (!parsedNames.includes(cleanedFinal)) {
          parsedNames.push(cleanedFinal);
        }
      }
    }
  }

  // Fallback 1: split manually by @ if regex matched nothing
  if (parsedNames.length === 0 && text.includes('@')) {
    const parts = text.split('@');
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const namePartMatch = part.match(/^([^📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/);
      if (namePartMatch) {
        const cleanedFinal = cleanName(namePartMatch[1]);
        if (cleanedFinal && cleanedFinal.length >= 2) {
          rawOccurrences.push(cleanedFinal);
          if (!parsedNames.includes(cleanedFinal)) {
            parsedNames.push(cleanedFinal);
          }
        }
      }
    }
  }

  // Fallback 2: line-by-line extraction for lists pasted without @ symbols (e.g. "1. Md Shakil Ahmed", "2. Jakaria Hosain")
  if (parsedNames.length === 0) {
    const lines = text.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^(📅|তারিখ|tarikh|date|support|link\s*box|active\s*member|total)/i.test(trimmed)) return;
      const cleaned = cleanName(trimmed);
      if (cleaned && cleaned.length >= 2) {
        rawOccurrences.push(cleaned);
        if (!parsedNames.includes(cleaned)) {
          parsedNames.push(cleaned);
        }
      }
    });
  }

  const members = getMembers();
  const matchedMembers = [];
  const unregisteredNames = [];
  const parsedItems = [];

  rawOccurrences.forEach((name, idx) => {
    const matchResult = findMatchingMember(name, members);
    let suggestion = null;

    if (matchResult && matchResult.member) {
      if (!matchedMembers.some(m => m.id === matchResult.member.id)) {
        matchedMembers.push(matchResult.member);
      }
      parsedItems.push({
        index: idx + 1,
        rawName: name,
        cleanedName: cleanName(name),
        isMatched: true,
        matchType: matchResult.type,
        confidence: matchResult.confidence,
        member: matchResult.member,
        suggestion: null
      });
    } else {
      if (!unregisteredNames.includes(name)) {
        unregisteredNames.push(name);
      }
      suggestion = findFuzzyMemberSuggestion(name, members);
      parsedItems.push({
        index: idx + 1,
        rawName: name,
        cleanedName: cleanName(name),
        isMatched: false,
        matchType: 'unregistered',
        confidence: 'none',
        member: null,
        suggestion
      });
    }
  });

  return { parsedNames, matchedMembers, unregisteredNames, parsedItems };
}

// Helper to analyze duplicate unregistered names from raw input text
export function analyzeUnregisteredDuplicates(text) {
  if (!text) return [];
  
  const allParsedNames = [];
  const regex = /@([^\n\r📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const extracted = match[1].trim();
    if (extracted && extracted.length > 1) {
      const cleanedFinal = cleanName(extracted);
      if (cleanedFinal && cleanedFinal.length >= 2) {
        allParsedNames.push(cleanedFinal);
      }
    }
  }
  
  if (allParsedNames.length === 0 && text.includes('@')) {
    const parts = text.split('@');
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const namePartMatch = part.match(/^([^📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/);
      if (namePartMatch) {
        const cleanedFinal = cleanName(namePartMatch[1]);
        if (cleanedFinal && cleanedFinal.length >= 2) {
          allParsedNames.push(cleanedFinal);
        }
      }
    }
  }

  if (allParsedNames.length === 0) {
    const lines = text.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^(📅|তারিখ|tarikh|date|support|link\s*box|active\s*member|total)/i.test(trimmed)) return;
      const cleaned = cleanName(trimmed);
      if (cleaned && cleaned.length >= 2) {
        allParsedNames.push(cleaned);
      }
    });
  }
  
  const members = getMembers();
  const unregisteredOccurrences = [];
  
  allParsedNames.forEach(rawName => {
    const match = findMatchingMember(rawName, members);
    if (!match) {
      unregisteredOccurrences.push(rawName);
    }
  });
  
  const frequencies = {};
  unregisteredOccurrences.forEach(name => {
    const ultra = getUltraNormalizedName(name);
    if (!frequencies[ultra]) {
      frequencies[ultra] = { name, count: 0 };
    }
    frequencies[ultra].count++;
  });
  
  const duplicates = [];
  Object.values(frequencies).forEach(item => {
    if (item.count >= 2) {
      duplicates.push({
        name: item.name,
        count: item.count
      });
    }
  });
  
  return duplicates;
}

// Helper to analyze all duplicate names (both registered and unregistered) from raw input text
export function analyzeAllDuplicates(text) {
  if (!text) return [];
  
  const allParsedNames = [];
  const regex = /@([^\n\r📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const extracted = match[1].trim();
    if (extracted && extracted.length > 1) {
      const cleanedFinal = cleanName(extracted);
      if (cleanedFinal && cleanedFinal.length >= 2) {
        allParsedNames.push(cleanedFinal);
      }
    }
  }
  
  if (allParsedNames.length === 0 && text.includes('@')) {
    const parts = text.split('@');
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const namePartMatch = part.match(/^([^📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/);
      if (namePartMatch) {
        const cleanedFinal = cleanName(namePartMatch[1]);
        if (cleanedFinal && cleanedFinal.length >= 2) {
          allParsedNames.push(cleanedFinal);
        }
      }
    }
  }

  if (allParsedNames.length === 0) {
    const lines = text.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^(📅|তারিখ|tarikh|date|support|link\s*box|active\s*member|total)/i.test(trimmed)) return;
      const cleaned = cleanName(trimmed);
      if (cleaned && cleaned.length >= 2) {
        allParsedNames.push(cleaned);
      }
    });
  }
  
  const frequencies = {};
  allParsedNames.forEach(name => {
    const ultra = getUltraNormalizedName(name);
    if (!frequencies[ultra]) {
      frequencies[ultra] = { name, count: 0 };
    }
    frequencies[ultra].count++;
  });
  
  const duplicates = [];
  Object.values(frequencies).forEach(item => {
    if (item.count >= 2) {
      duplicates.push({
        name: item.name,
        count: item.count
      });
    }
  });
  
  return duplicates;
}

// ----------------------------------------------------
// SINGLE SOURCE OF TRUTH: RECALCULATE ALL STATS FROM LOGS
// ----------------------------------------------------

export function calculateLevel(totalPoints) {
  if (totalPoints >= CONFIG.LEVEL_POINTS.DIAMOND) return CONFIG.LEVELS.DIAMOND;
  if (totalPoints >= CONFIG.LEVEL_POINTS.PLATINUM) return CONFIG.LEVELS.PLATINUM;
  if (totalPoints >= CONFIG.LEVEL_POINTS.GOLD) return CONFIG.LEVELS.GOLD;
  if (totalPoints >= CONFIG.LEVEL_POINTS.SILVER) return CONFIG.LEVELS.SILVER;
  return CONFIG.LEVELS.BRONZE;
}

export function checkAndAssignBadges(member, longestStreak, totalPoints, badges) {
  const newBadges = [...badges];
  let updated = false;

  // Streak Badges
  if (longestStreak >= 3 && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'streak_3')) {
    newBadges.push({
      id: `badge-${member.id}-streak3-${Date.now()}`,
      member_id: member.id,
      badge_type: 'streak_3',
      badge_name: '🥉 3-Day Streak Warrior',
      earned_at: new Date().toISOString()
    });
    updated = true;
  }
  if (longestStreak >= 7 && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'streak_7')) {
    newBadges.push({
      id: `badge-${member.id}-streak7-${Date.now()}`,
      member_id: member.id,
      badge_type: 'streak_7',
      badge_name: '🥈 7-Day Streak Master',
      earned_at: new Date().toISOString()
    });
    updated = true;
  }
  if (longestStreak >= 15 && !newBadges.some(b => b.member_id === member.id && b.badge_type === 'streak_15')) {
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

// Master Recalculation Engine — derives 100% of member stats from activity logs
export function recalculateAllMemberStatsFromLogs(explicitLogs = null, membersList = null, badgesList = null) {
  const logs = explicitLogs || getActivityLogs();
  const members = membersList || getMembers();
  let dynamicBadges = badgesList ? [...badgesList] : [...getBadges()];

  // Collect all distinct submission dates across the system, ordered chronologically
  const submissionDatesSet = new Set();
  logs.forEach(l => {
    if (l.activity_date) {
      submissionDatesSet.add(l.activity_date);
    }
  });

  const allSubmissionDates = Array.from(submissionDatesSet).sort();
  const latestTrackedDate = allSubmissionDates.length > 0 ? allSubmissionDates[allSubmissionDates.length - 1] : null;

  const updatedMembers = members.map(member => {
    const memberLogs = logs.filter(l => l.member_id === member.id);
    const activeLogs = memberLogs.filter(l => l.is_active === true);
    
    // Set of active dates for this member
    const activeDates = new Set(activeLogs.map(l => l.activity_date));
    const sortedActiveDates = Array.from(activeDates).sort();

    const totalActiveDays = activeDates.size;
    const totalPoints = activeLogs.reduce((sum, l) => sum + (l.points_earned !== undefined ? l.points_earned : CONFIG.POINTS.DAILY_ACTIVITY), 0);
    const level = calculateLevel(totalPoints);
    const lastActiveDate = sortedActiveDates.length > 0 ? sortedActiveDates[sortedActiveDates.length - 1] : null;

    // Calculate Longest Streak
    let longestStreak = 0;
    let currentStreakRun = 0;
    allSubmissionDates.forEach(date => {
      if (activeDates.has(date)) {
        currentStreakRun++;
        if (currentStreakRun > longestStreak) {
          longestStreak = currentStreakRun;
        }
      } else {
        currentStreakRun = 0;
      }
    });

    // Calculate Current Streak (working backwards from the latest submission date)
    let currentStreak = 0;
    if (latestTrackedDate && activeDates.has(latestTrackedDate)) {
      for (let i = allSubmissionDates.length - 1; i >= 0; i--) {
        const d = allSubmissionDates[i];
        if (activeDates.has(d)) {
          currentStreak++;
        } else {
          break;
        }
      }
    } else {
      currentStreak = 0;
    }

    // Calculate Inactivity Counter & Status
    let consecutiveInactiveDays = 0;
    let status = member.status;

    if (status === 'frozen') {
      // Frozen members strictly stay frozen with 0 consecutive inactive days unless they actively submitted on latestTrackedDate
      if (latestTrackedDate && activeDates.has(latestTrackedDate)) {
        status = 'active';
        consecutiveInactiveDays = 0;
      } else {
        status = 'frozen';
        consecutiveInactiveDays = 0;
      }
    } else {
      if (allSubmissionDates.length === 0 || !latestTrackedDate) {
        consecutiveInactiveDays = 0;
        status = 'active';
      } else if (activeDates.has(latestTrackedDate)) {
        consecutiveInactiveDays = 0;
        status = 'active';
      } else {
        // Count consecutive submission dates backwards from latestTrackedDate where the member was NOT active
        for (let i = allSubmissionDates.length - 1; i >= 0; i--) {
          const d = allSubmissionDates[i];
          if (member.created_at) {
            const joinDate = member.created_at.split('T')[0];
            if (d < joinDate) {
              // Member had not joined yet on this submission date
              break;
            }
          }
          if (!activeDates.has(d)) {
            consecutiveInactiveDays++;
          } else {
            // Reached member's most recent active submission date, stop counting
            break;
          }
        }

        // Determine status for non-frozen members based on missed submission rounds
        if (consecutiveInactiveDays >= 12) {
          status = 'inactive';
        } else if (consecutiveInactiveDays >= 7) {
          status = 'warning';
        } else if (consecutiveInactiveDays >= 1) {
          status = 'inactive';
        } else {
          status = 'active';
        }
      }
    }

    // Assign badges
    const badgeResult = checkAndAssignBadges(member, longestStreak, totalPoints, dynamicBadges);
    if (badgeResult.updated) {
      dynamicBadges = badgeResult.badges;
    }

    return {
      ...member,
      total_points: totalPoints,
      total_active_days: totalActiveDays,
      current_streak: currentStreak,
      longest_streak: Math.max(member.longest_streak || 0, longestStreak),
      last_active_date: lastActiveDate,
      consecutive_inactive_days: consecutiveInactiveDays,
      status,
      level,
      updated_at: new Date().toISOString()
    };
  });

  saveMembers(updatedMembers);
  saveBadges(dynamicBadges);

  return { members: updatedMembers, badges: dynamicBadges };
}

// Save Daily Submissions
export function submitBulkActivity(dateStr, activeMemberIds) {
  const members = getMembers();
  let logs = getActivityLogs();

  // Save rollback snapshot
  const snapshot = {
    timestamp: new Date().toISOString(),
    submissionDate: dateStr,
    membersState: JSON.parse(JSON.stringify(members)),
    logsState: JSON.parse(JSON.stringify(logs)),
    badgesState: JSON.parse(JSON.stringify(getBadges()))
  };
  localStorage.setItem('support_linkbox_last_submission_snapshot', JSON.stringify(snapshot));

  const state = getState();
  const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
  const auditTrails = getAuditTrails();

  // Filter out any existing logs for this exact date to replace them cleanly
  logs = logs.filter(l => l.activity_date !== dateStr);

  // Add new activity logs for all active members
  activeMemberIds.forEach(id => {
    logs.push({
      id: `log-${id}-${dateStr}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      member_id: id,
      activity_date: dateStr,
      is_active: true,
      points_earned: CONFIG.POINTS.DAILY_ACTIVITY,
      submitted_by: state.currentAdminEmail,
      created_at: new Date().toISOString()
    });
  });

  // Save updated logs
  saveActivityLogs(logs);

  // Recalculate all member stats from logs
  const { members: updatedMembers } = recalculateAllMemberStatsFromLogs(logs, members);

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
    bulkEditSession: null,
    lastSubmissionSnapshot: snapshot
  });

  showToast('মেম্বার অ্যাক্টিভিটি সফলভাবে সেভ ও ক্যালকুলেট করা হয়েছে!', 'success');
}

// Manual Activity Log Operations for Admin
export function addManualMemberLog(memberId, activityDate, points = 10, isActive = true) {
  let logs = getActivityLogs();
  // Remove existing log for this member on this date if any
  logs = logs.filter(l => !(l.member_id === memberId && l.activity_date === activityDate));

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;
  const newLogId = `manual-${memberId.slice(0, 6)}-${activityDate}-${Date.now().toString(36)}`;

  logs.push({
    id: newLogId,
    member_id: memberId,
    activity_date: activityDate,
    is_active: isActive,
    points_earned: isActive ? (points !== undefined ? points : CONFIG.POINTS.DAILY_ACTIVITY) : 0,
    submitted_by: currentEmail,
    source: 'Manual Entry',
    created_at: new Date().toISOString()
  });

  saveActivityLogs(logs);
  recalculateAllMemberStatsFromLogs(logs);

  const members = getMembers();
  const member = members.find(m => m.id === memberId);
  const memberName = member ? member.name : memberId;

  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'ADD_ACTIVITY',
    entity_type: 'ACTIVITY',
    description: `Added manual activity log (${activityDate}) for ${memberName}. Status: ${isActive ? 'Active' : 'Inactive'}, Points: ${isActive ? points : 0}`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });
  showToast(`ম্যানুয়াল অ্যাক্টিভিটি লগ (${activityDate}) সেভ করা হয়েছে!`, 'success');
  return newLogId;
}

export function updateMemberLogStatus(logId, isActive) {
  let logs = getActivityLogs();
  const logIdx = logs.findIndex(l => l.id === logId);
  if (logIdx !== -1) {
    const oldStatus = logs[logIdx].is_active;
    logs[logIdx].is_active = isActive;
    logs[logIdx].points_earned = isActive ? CONFIG.POINTS.DAILY_ACTIVITY : 0;
    logs[logIdx].updated_at = new Date().toISOString();

    saveActivityLogs(logs);
    recalculateAllMemberStatsFromLogs(logs);

    const state = getState();
    const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
    const adminName = ADMIN_NAMES[currentEmail] || currentEmail;
    const member = getMembers().find(m => m.id === logs[logIdx].member_id);
    const memberName = member ? member.name : logs[logIdx].member_id;

    const auditTrails = getAuditTrails();
    auditTrails.unshift({
      id: `audit-${generateUUID()}`,
      admin_email: currentEmail,
      admin_name: adminName,
      action: 'EDIT_ACTIVITY',
      entity_type: 'ACTIVITY',
      description: `Toggled activity status for ${memberName} (${logs[logIdx].activity_date}): ${oldStatus ? 'Active' : 'Inactive'} ➔ ${isActive ? 'Active' : 'Inactive'}`,
      timestamp: new Date().toISOString()
    });
    saveAuditTrails(auditTrails);

    updateState({
      members: getMembers(),
      auditTrails: getAuditTrails()
    });
    showToast('লগ স্ট্যাটাস আপডেট করা হয়েছে এবং অডিট লগে রেকর্ড হয়েছে!', 'success');
  }
}

export function updateActivityLog(logId, updates) {
  let logs = getActivityLogs();
  const logIdx = logs.findIndex(l => l.id === logId);
  if (logIdx === -1) return false;

  const oldLog = { ...logs[logIdx] };
  const members = getMembers();
  const member = members.find(m => m.id === oldLog.member_id);
  const memberName = member ? member.name : oldLog.member_id;

  const nextDate = updates.activity_date !== undefined ? updates.activity_date : oldLog.activity_date;
  const nextIsActive = updates.is_active !== undefined ? Boolean(updates.is_active) : oldLog.is_active;
  const nextPoints = updates.points_earned !== undefined ? Number(updates.points_earned) : (nextIsActive ? CONFIG.POINTS.DAILY_ACTIVITY : 0);
  const nextSource = updates.source !== undefined ? updates.source : (oldLog.source || 'Daily Submission');

  logs[logIdx] = {
    ...oldLog,
    activity_date: nextDate,
    is_active: nextIsActive,
    points_earned: nextPoints,
    source: nextSource,
    updated_at: new Date().toISOString()
  };

  saveActivityLogs(logs);
  recalculateAllMemberStatsFromLogs(logs);

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;

  const changes = [];
  if (oldLog.activity_date !== nextDate) changes.push(`Date: ${oldLog.activity_date} ➔ ${nextDate}`);
  if (oldLog.is_active !== nextIsActive) changes.push(`Status: ${oldLog.is_active ? 'Active' : 'Inactive'} ➔ ${nextIsActive ? 'Active' : 'Inactive'}`);
  if (oldLog.points_earned !== nextPoints) changes.push(`Points: ${oldLog.points_earned} ➔ ${nextPoints}`);
  if (oldLog.source !== nextSource) changes.push(`Source: ${oldLog.source || 'Daily Submission'} ➔ ${nextSource}`);

  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'EDIT_ACTIVITY',
    entity_type: 'ACTIVITY',
    description: `Edited activity record of ${oldLog.activity_date} for ${memberName}. ${changes.join(', ') || 'Updated log details.'}`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });

  showToast('অ্যাক্টিভিটি সফলভাবে আপডেট হয়েছে এবং অডিট লগে রেকর্ড হয়েছে!', 'success');
  return true;
}

export function deleteMemberLog(logId) {
  let logs = getActivityLogs();
  const logToDelete = logs.find(l => l.id === logId);
  if (!logToDelete) return false;

  const members = getMembers();
  const member = members.find(m => m.id === logToDelete.member_id);
  const memberName = member ? member.name : logToDelete.member_id;

  logs = logs.filter(l => l.id !== logId);

  saveActivityLogs(logs);
  recalculateAllMemberStatsFromLogs(logs);

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;

  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'DELETE_ACTIVITY',
    entity_type: 'ACTIVITY',
    description: `Deleted activity log for ${memberName} (Date: ${logToDelete.activity_date}, ID: ${logToDelete.id})`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });
  showToast('অ্যাক্টিভিটি লগ মুছে ফেলা হয়েছে এবং অডিট লগে রেকর্ড হয়েছে!', 'info');
  return true;
}

export const deleteActivityLog = deleteMemberLog;

// ----------------------------------------------------
// DAILY SUBMISSION MANAGEMENT (Management Tab Engine)
// ----------------------------------------------------

// Delete entire daily submission record for a date
export function deleteDailySubmissionRecord(dateStr) {
  let logs = getActivityLogs();
  const logsToDelete = logs.filter(l => l.activity_date === dateStr);
  if (logsToDelete.length === 0) {
    showToast(`${dateStr} তারিখের কোনো সাবমিশন রেকর্ড পাওয়া যায়নি!`, 'error');
    return false;
  }

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;

  // Remove all logs for this date
  logs = logs.filter(l => l.activity_date !== dateStr);
  saveActivityLogs(logs);

  // Recalculate all member stats from remaining logs
  recalculateAllMemberStatsFromLogs(logs);

  // Record in Audit Trail
  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'DELETE_DAILY_RECORD',
    entity_type: 'DAILY_SUBMISSION',
    description: `Deleted complete daily submission record for date: ${dateStr} (${logsToDelete.length} activity logs removed). Recalculated all member streaks & points.`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails(),
    managementSelectedDate: null
  });

  showToast(`${dateStr} তারিখের সম্পূর্ণ সাবমিশন রেকর্ড মুছে ফেলা হয়েছে এবং পয়েন্ট/স্ট্রেইক রিক্যালকুলেট হয়েছে!`, 'success');
  return true;
}

// Add a member to a specific date's active submission
export function addMemberToDateSubmission(dateStr, memberId) {
  const members = getMembers();
  const member = members.find(m => m.id === memberId);
  if (!member) {
    showToast('মেম্বার খুঁজে পাওয়া যায়নি!', 'error');
    return false;
  }

  let logs = getActivityLogs();
  // Remove existing log for this member on this date if any
  logs = logs.filter(l => !(l.member_id === memberId && l.activity_date === dateStr));

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;

  const newLog = {
    id: `log-${memberId}-${dateStr}-${Date.now().toString(36)}`,
    member_id: memberId,
    activity_date: dateStr,
    is_active: true,
    points_earned: CONFIG.POINTS.DAILY_ACTIVITY,
    submitted_by: currentEmail,
    source: 'Admin Management',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  logs.push(newLog);
  saveActivityLogs(logs);
  recalculateAllMemberStatsFromLogs(logs);

  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'SUBMISSION_MEMBER_ADDED',
    entity_type: 'DAILY_SUBMISSION',
    description: `Added ${member.name} to ${dateStr} active submission (+10 Pts).`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });

  showToast(`${member.name}-কে ${dateStr} তারিখের Active সাবমিশনে যোগ করা হয়েছে!`, 'success');
  return true;
}

// Remove a member from a date's active submission
export function removeMemberFromDateSubmission(dateStr, memberId) {
  const members = getMembers();
  const member = members.find(m => m.id === memberId);
  const memberName = member ? member.name : memberId;

  let logs = getActivityLogs();
  const existingLog = logs.find(l => l.member_id === memberId && l.activity_date === dateStr);
  if (!existingLog) {
    showToast('এই মেম্বারের সাবমিশন রেকর্ড পাওয়া যায়নি!', 'error');
    return false;
  }

  logs = logs.filter(l => !(l.member_id === memberId && l.activity_date === dateStr));
  saveActivityLogs(logs);
  recalculateAllMemberStatsFromLogs(logs);

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;

  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'SUBMISSION_MEMBER_REMOVED',
    entity_type: 'DAILY_SUBMISSION',
    description: `Removed ${memberName} from ${dateStr} submission list. Recalculated stats.`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });

  showToast(`${memberName}-কে ${dateStr} তারিখের তালিকা থেকে বাদ দেওয়া হয়েছে!`, 'info');
  return true;
}

// Mark a member's link as invalid on a specific date
export function markSubmissionInvalid(dateStr, memberId) {
  const members = getMembers();
  const member = members.find(m => m.id === memberId);
  const memberName = member ? member.name : memberId;

  let logs = getActivityLogs();
  const logIdx = logs.findIndex(l => l.member_id === memberId && l.activity_date === dateStr);
  if (logIdx === -1) {
    showToast('এই তারিখের সাবমিশন লগ পাওয়া যায়নি!', 'error');
    return false;
  }

  logs[logIdx].is_active = false;
  logs[logIdx].points_earned = 0;
  logs[logIdx].status = 'invalid';
  logs[logIdx].notes = 'Marked invalid by admin';
  logs[logIdx].updated_at = new Date().toISOString();

  saveActivityLogs(logs);
  recalculateAllMemberStatsFromLogs(logs);

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;

  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'SUBMISSION_INVALIDATED',
    entity_type: 'DAILY_SUBMISSION',
    description: `Marked submission as INVALID for ${memberName} on ${dateStr}. Deducted points & recalculated streak.`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });

  showToast(`${memberName}-এর ${dateStr} তারিখের লিংক ইনভ্যালিড মার্ক করা হয়েছে!`, 'warning');
  return true;
}

// Replace a member in a date's submission with another member
export function replaceMemberInDateSubmission(dateStr, oldMemberId, newMemberId) {
  const members = getMembers();
  const oldMember = members.find(m => m.id === oldMemberId);
  const newMember = members.find(m => m.id === newMemberId);

  if (!newMember) {
    showToast('নতুন প্রতিস্থাপক মেম্বার নির্বাচন করুন!', 'error');
    return false;
  }

  let logs = getActivityLogs();
  const logIdx = logs.findIndex(l => l.member_id === oldMemberId && l.activity_date === dateStr);
  if (logIdx === -1) {
    showToast('মূল সাবমিশন লগ পাওয়া যায়নি!', 'error');
    return false;
  }

  // Remove any existing log for newMember on that date first
  logs = logs.filter(l => !(l.member_id === newMemberId && l.activity_date === dateStr));

  // Find index again after filter
  const targetIdx = logs.findIndex(l => l.member_id === oldMemberId && l.activity_date === dateStr);
  if (targetIdx !== -1) {
    logs[targetIdx].member_id = newMemberId;
    logs[targetIdx].updated_at = new Date().toISOString();
  }

  saveActivityLogs(logs);
  recalculateAllMemberStatsFromLogs(logs);

  const state = getState();
  const currentEmail = state.currentAdminEmail || 'shihab@linkbox.com';
  const adminName = ADMIN_NAMES[currentEmail] || currentEmail;
  const oldName = oldMember ? oldMember.name : oldMemberId;

  const auditTrails = getAuditTrails();
  auditTrails.unshift({
    id: `audit-${generateUUID()}`,
    admin_email: currentEmail,
    admin_name: adminName,
    action: 'SUBMISSION_MEMBER_REPLACED',
    entity_type: 'DAILY_SUBMISSION',
    description: `Replaced member in ${dateStr} submission: ${oldName} ➔ ${newMember.name}. Recalculated stats.`,
    timestamp: new Date().toISOString()
  });
  saveAuditTrails(auditTrails);

  updateState({
    members: getMembers(),
    auditTrails: getAuditTrails()
  });

  showToast(`${dateStr} তারিখে ${oldName}-এর পরিবর্তে ${newMember.name}-কে প্রতিস্থাপন করা হয়েছে!`, 'success');
  return true;
}

export function updateMemberDetails(memberId, updates) {
  const members = getMembers();
  const idx = members.findIndex(m => m.id === memberId);
  if (idx === -1) return false;

  const current = members[idx];
  const nextName = updates.name !== undefined ? cleanName(updates.name) : current.name;
  const nextDisplayName = updates.display_name !== undefined ? updates.display_name.trim() : current.display_name;
  const nextNotes = updates.notes !== undefined ? updates.notes.trim() : current.notes;
  const nextStatus = updates.status !== undefined ? updates.status : current.status;
  const nextAliases = Array.isArray(updates.aliases) ? updates.aliases : (current.aliases || []);

  members[idx] = {
    ...current,
    name: nextName || current.name,
    display_name: nextDisplayName || current.display_name,
    notes: nextNotes,
    status: nextStatus,
    aliases: nextAliases,
    updated_at: new Date().toISOString()
  };

  saveMembers(members);
  
  // Recalculate stats with the updated member data
  const logs = getActivityLogs();
  recalculateAllMemberStatsFromLogs(logs, members);

  updateState({
    members: getMembers()
  });

  return true;
}

export function addMemberAlias(memberId, alias) {
  if (!alias || !alias.trim()) return false;
  const cleaned = cleanName(alias);
  if (!cleaned) return false;

  const members = getMembers();
  const member = members.find(m => m.id === memberId);
  if (!member) return false;

  const aliases = Array.isArray(member.aliases) ? [...member.aliases] : [];
  const normCleaned = getNormalizedName(cleaned);
  if (!aliases.some(a => getNormalizedName(a) === normCleaned)) {
    aliases.push(cleaned);
    return updateMemberDetails(memberId, { aliases });
  }
  return true;
}

export function removeMemberAlias(memberId, alias) {
  const members = getMembers();
  const member = members.find(m => m.id === memberId);
  if (!member || !Array.isArray(member.aliases)) return false;

  const normTarget = getNormalizedName(alias);
  const aliases = member.aliases.filter(a => getNormalizedName(a) !== normTarget);
  return updateMemberDetails(memberId, { aliases });
}

// Helper to calculate statistics for Pending Submission Preview
export function calculateSubmissionStats(rawText, resolvedText, resolvedDuplicates = []) {
  const members = getMembers();
  
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
    const dups = analyzeAllDuplicates(rawText);
    duplicateCount = dups.length;
  }

  const textToParse = resolvedText || rawText;
  const { parsedNames, matchedMembers, unregisteredNames } = parseBulkActivityText(textToParse);
  
  let registeredCount = 0;
  let frozenCount = 0;
  let aliasCount = 0;
  
  matchedMembers.forEach(m => {
    if (m.status === 'frozen') {
      frozenCount++;
    } else {
      registeredCount++;
    }
    
    const normName = getNormalizedName(m.name);
    const normDisp = getNormalizedName(m.display_name || '');
    parsedNames.forEach(pn => {
      const normPn = getNormalizedName(cleanName(pn));
      if (normPn === normDisp && normPn !== normName) {
        aliasCount++;
      }
    });
  });

  const newCount = unregisteredNames.length;
  const totalAtSymbols = (textToParse.match(/@/g) || []).length;
  const invalidCount = Math.max(0, totalAtSymbols - parsedNames.length);
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

