// Support Link Box - Daily Submission Management Component
import { ADMIN_NAMES } from './constants.js';
import { getMembers, getActivityLogs } from './database.js';

// Helper to format date string to DD-MM-YYYY
export function formatDisplayDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const day = parts[2].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      let year = parts[0];
      if (year.length === 2) {
        year = '20' + year;
      }
      return `${day}-${month}-${year}`;
    }
  } catch (e) {}
  return dateStr;
}

// Get all unique submission dates available in activity logs
export function getDistinctSubmissionDates() {
  const logs = getActivityLogs();
  const dateMap = new Map();
  const currentYear = new Date().getFullYear();

  logs.forEach(log => {
    if (!log.activity_date || typeof log.activity_date !== 'string') return;
    const parts = log.activity_date.split('-');
    const y = parseInt(parts[0], 10);
    // Ignore invalid or future years (> currentYear + 1 or < 2020)
    if (y > currentYear + 1 || y < 2020) return;

    if (!dateMap.has(log.activity_date)) {
      dateMap.set(log.activity_date, {
        date: log.activity_date,
        totalLogs: 0,
        activeLogs: 0,
        inactiveLogs: 0,
        admins: new Set()
      });
    }
    const record = dateMap.get(log.activity_date);
    record.totalLogs += 1;
    if (log.is_active) {
      record.activeLogs += 1;
    } else {
      record.inactiveLogs += 1;
    }
    if (log.submitted_by) {
      record.admins.add(ADMIN_NAMES[log.submitted_by] || log.submitted_by);
    }
  });

  return Array.from(dateMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Calculate comprehensive daily submission breakdown for a specific date
export function getDailySubmissionBreakdown(targetDate, searchQuery = '') {
  const members = getMembers();
  const nonFrozenMembers = members.filter(m => m.status !== 'frozen');
  const logs = getActivityLogs().filter(l => l.activity_date === targetDate);
  const hasLogsForDate = logs.length > 0;
  
  // Build lookup of logs by member_id for target date
  const logByMemberId = new Map();
  logs.forEach(l => {
    logByMemberId.set(l.member_id, l);
  });

  // Active members for this date (has an active log)
  const activeMembers = [];
  // Inactive members for this date (either has an inactive log or no log for this date)
  const inactiveMembers = [];

  nonFrozenMembers.forEach(member => {
    const log = logByMemberId.get(member.id);
    if (log && log.is_active) {
      activeMembers.push({ member, log });
    } else {
      inactiveMembers.push({ member, log: log || null });
    }
  });

  // Apply search query filter if provided
  const query = searchQuery.trim().toLowerCase().replace(/^#/, '');
  const filterFn = item => {
    if (!query) return true;
    const m = item.member;
    return (
      m.name.toLowerCase().includes(query) ||
      (m.display_name && m.display_name.toLowerCase().includes(query)) ||
      m.member_number.toString().includes(query)
    );
  };

  const filteredActive = activeMembers.filter(filterFn);
  const filteredInactive = inactiveMembers.filter(filterFn);
  const allMembersBreakdown = [
    ...activeMembers.map(item => ({ ...item, isActive: true })),
    ...inactiveMembers.map(item => ({ ...item, isActive: false }))
  ].filter(filterFn);

  const totalRegistered = nonFrozenMembers.length;
  const activeCount = hasLogsForDate ? activeMembers.length : 0;
  const inactiveCount = hasLogsForDate ? inactiveMembers.length : 0;
  const activeRate = (hasLogsForDate && totalRegistered > 0) ? Math.round((activeCount / totalRegistered) * 100) : 0;
  const inactiveRate = hasLogsForDate ? (100 - activeRate) : 0;
  const diamondActiveCount = hasLogsForDate ? activeMembers.filter(item => item.member.level === 'Diamond').length : 0;
  const totalPoints = logs.reduce((sum, l) => sum + (l.points_earned !== undefined ? l.points_earned : (l.is_active ? 10 : 0)), 0);

  return {
    targetDate,
    totalRegistered,
    activeCount,
    inactiveCount,
    activeRate,
    inactiveRate,
    diamondActiveCount,
    totalPoints,
    rawLogsCount: logs.length,
    allMembersBreakdown,
    activeMembers: filteredActive,
    inactiveMembers: filteredInactive,
    hasLogsForDate
  };
}

// Render the complete Management Section HTML
export function renderManagementSection(state) {
  const distinctDates = getDistinctSubmissionDates();
  const todayStr = new Date().toISOString().split('T')[0];
  
  // Default to the latest recorded date if available, otherwise today
  const selectedDate = state.managementSelectedDate || (distinctDates.length > 0 ? distinctDates[0].date : todayStr);
  const activeTab = state.managementActiveTab || 'all'; // 'all', 'active', 'inactive', 'archive'
  const searchQuery = state.managementSearchQuery || '';

  const breakdown = getDailySubmissionBreakdown(selectedDate, searchQuery);
  const formattedSelectedDate = formatDisplayDate(selectedDate);
  const isToday = selectedDate === todayStr;

  return `
    <div id="management-section-root" class="space-y-6">
      
      <!-- Top Title & Description Banner -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 p-6 sm:p-7 rounded-3xl shadow-xl relative overflow-hidden space-y-4">
        <div class="absolute right-0 top-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div class="absolute left-10 bottom-0 w-60 h-60 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>

        <div class="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div class="space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs bg-indigo-500/20 text-indigo-400 font-bold px-3 py-1 rounded-xl border border-indigo-500/30 uppercase tracking-widest flex items-center gap-1.5">
                <i data-lucide="clipboard-check" class="w-3.5 h-3.5"></i>
                Daily Submission Management
              </span>
              <span class="text-[10px] bg-slate-950 text-slate-300 border border-slate-800 px-2.5 py-1 rounded-xl font-bold font-mono">
                📊 মোট ${distinctDates.length} দিনের ডাটা সংরক্ষিত
              </span>
              <span class="text-[10px] ${isToday ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : (breakdown.hasLogsForDate ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30')} border px-2.5 py-1 rounded-xl font-bold font-mono">
                📅 নির্বাচিত: ${formattedSelectedDate} ${isToday ? '(Today)' : ''}
              </span>
            </div>
            <h2 class="text-xl sm:text-2xl font-black text-slate-100 flex items-center gap-2">
              📋 Daily Link Submission & Activity Engine
            </h2>
            <p class="text-xs text-slate-400 leading-relaxed max-w-2xl">
              নির্দিষ্ট তারিখে কারা Link দিয়েছে, কারা Active ছিল এবং কারা Link দেয়নি (Inactive)—তার সম্পূর্ণ তালিকা ও এডমিন ডাটা এডিটর।
            </p>
          </div>

          <!-- Date Navigation / Picker Controls -->
          <div class="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 bg-slate-950/90 border border-slate-800 p-2.5 rounded-2xl shrink-0 shadow-lg">
            
            ${distinctDates.length > 0 ? `
              <!-- Quick dropdown of all recorded dates -->
              <div class="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-xl">
                <i data-lucide="list" class="w-3.5 h-3.5 text-indigo-400 shrink-0"></i>
                <select id="management-recorded-dates-select" class="bg-transparent text-xs font-mono font-bold text-slate-200 focus:outline-none cursor-pointer max-w-[170px] truncate">
                  ${distinctDates.map(d => `
                    <option value="${d.date}" class="bg-slate-950 text-slate-200" ${d.date === selectedDate ? 'selected' : ''}>
                      ${formatDisplayDate(d.date)} (${d.activeLogs} Active)
                    </option>
                  `).join('')}
                  ${!distinctDates.some(d => d.date === todayStr) ? `
                    <option value="${todayStr}" class="bg-slate-950 text-slate-400" ${selectedDate === todayStr ? 'selected' : ''}>
                      ${formatDisplayDate(todayStr)} (Today - 0 Logs)
                    </option>
                  ` : ''}
                </select>
              </div>
            ` : ''}

            <!-- Date stepper & native input -->
            <div class="flex items-center gap-1.5">
              <button id="management-prev-date-btn" class="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition cursor-pointer" title="Previous Day">
                <i data-lucide="chevron-left" class="w-4 h-4"></i>
              </button>

              <div class="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1.5 rounded-xl">
                <i data-lucide="calendar" class="w-3.5 h-3.5 text-indigo-400 shrink-0"></i>
                <input id="management-date-input" type="date" value="${selectedDate}" class="bg-transparent text-xs font-mono font-bold text-slate-200 focus:outline-none cursor-pointer" />
              </div>

              <button id="management-next-date-btn" class="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition cursor-pointer" title="Next Day">
                <i data-lucide="chevron-right" class="w-4 h-4"></i>
              </button>

              <button id="management-today-btn" class="text-[10px] font-black uppercase px-3 py-2 ${isToday ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-900 text-indigo-400 hover:bg-indigo-600/20 border border-slate-800 hover:border-indigo-500/30'} rounded-xl transition cursor-pointer shrink-0" title="Go to Today's date">
                ${isToday ? '📍 Today' : '📅 Today'}
              </button>
            </div>

          </div>
        </div>

        ${!breakdown.hasLogsForDate ? `
          <!-- Notice when selected date has no logs -->
          <div class="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-300">
            <div class="flex items-center gap-2">
              <i data-lucide="alert-circle" class="w-4 h-4 text-amber-400 shrink-0"></i>
              <span><strong>${formattedSelectedDate}</strong> তারিখে কোনো লিংক সাবমিশন রেকর্ড পাওয়া যায়নি।</span>
            </div>
            ${distinctDates.length > 0 && distinctDates[0].date !== selectedDate ? `
              <button data-management-select-date="${distinctDates[0].date}" class="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 rounded-xl font-bold font-mono transition cursor-pointer text-xs shrink-0 flex items-center gap-1.5">
                <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                সর্বশেষ রেকর্ডকৃত তারিখ (${formatDisplayDate(distinctDates[0].date)})
              </button>
            ` : ''}
          </div>
        ` : ''}

        <!-- Quick Summary Stats Grid for Selected Date -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
          <!-- Total Registered -->
          <div class="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-2xl">
            <div class="flex items-center justify-between text-slate-400 mb-1">
              <span class="text-[10px] font-bold uppercase tracking-wider">Registered</span>
              <i data-lucide="users" class="w-3.5 h-3.5 text-slate-500"></i>
            </div>
            <p class="text-lg font-black text-slate-200 font-mono">${breakdown.totalRegistered}</p>
            <p class="text-[9px] text-slate-500 mt-0.5">মোট নিবন্ধিত মেম্বার</p>
          </div>

          <!-- Active Count -->
          <div class="bg-slate-950/70 border border-emerald-500/20 p-3.5 rounded-2xl ring-1 ring-emerald-500/10">
            <div class="flex items-center justify-between text-emerald-400 mb-1">
              <span class="text-[10px] font-bold uppercase tracking-wider">Active</span>
              <span class="text-[9px] font-extrabold bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">${breakdown.activeRate}%</span>
            </div>
            <p class="text-lg font-black text-emerald-400 font-mono">${breakdown.activeCount}</p>
            <p class="text-[9px] text-slate-500 mt-0.5">লিংক জমা দিয়েছেন</p>
          </div>

          <!-- Inactive Count -->
          <div class="bg-slate-950/70 border border-rose-500/20 p-3.5 rounded-2xl ring-1 ring-rose-500/10">
            <div class="flex items-center justify-between text-rose-400 mb-1">
              <span class="text-[10px] font-bold uppercase tracking-wider">Inactive</span>
              <span class="text-[9px] font-extrabold bg-rose-500/10 px-1.5 py-0.5 rounded font-mono">${breakdown.inactiveRate}%</span>
            </div>
            <p class="text-lg font-black text-rose-400 font-mono">${breakdown.inactiveCount}</p>
            <p class="text-[9px] text-slate-500 mt-0.5">লিংক দেননি</p>
          </div>

          <!-- Diamond Active -->
          <div class="bg-slate-950/70 border border-cyan-500/20 p-3.5 rounded-2xl ring-1 ring-cyan-500/10">
            <div class="flex items-center justify-between text-cyan-400 mb-1">
              <span class="text-[10px] font-bold uppercase tracking-wider">Diamond</span>
              <span class="text-xs">💎</span>
            </div>
            <p class="text-lg font-black text-cyan-300 font-mono">${breakdown.diamondActiveCount}</p>
            <p class="text-[9px] text-slate-500 mt-0.5">ডায়মন্ড মেম্বার সক্রিয়</p>
          </div>

          <!-- Points Added -->
          <div class="bg-slate-950/70 border border-indigo-500/20 p-3.5 rounded-2xl col-span-2 sm:col-span-1 ring-1 ring-indigo-500/10">
            <div class="flex items-center justify-between text-indigo-400 mb-1">
              <span class="text-[10px] font-bold uppercase tracking-wider">Points</span>
              <i data-lucide="zap" class="w-3.5 h-3.5 text-indigo-400"></i>
            </div>
            <p class="text-lg font-black text-indigo-300 font-mono">+${breakdown.totalPoints} Pts</p>
            <p class="text-[9px] text-slate-500 mt-0.5">অর্জিত পয়েন্ট যোগ হয়েছে</p>
          </div>
        </div>
      </div>

      <!-- Management Sub-Navigation Tabs & Search Actions Bar -->
      <div class="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl space-y-4">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          <!-- Sub Tabs -->
          <div class="flex flex-wrap items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-850">
            <button data-management-tab="all" class="px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }">
              <i data-lucide="users" class="w-3.5 h-3.5"></i>
              সকল মেম্বার (${breakdown.totalRegistered})
            </button>

            <button data-management-tab="active" class="px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'active'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-900'
            }">
              <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
              Active (${breakdown.activeCount})
            </button>

            <button data-management-tab="inactive" class="px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'inactive'
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-slate-400 hover:text-rose-400 hover:bg-slate-900'
            }">
              <i data-lucide="x-circle" class="w-3.5 h-3.5"></i>
              Inactive (${breakdown.inactiveCount})
            </button>

            <button data-management-tab="archive" class="px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'archive'
                ? 'bg-cyan-600 text-white shadow-md'
                : 'text-slate-400 hover:text-cyan-400 hover:bg-slate-900'
            }">
              <i data-lucide="archive" class="w-3.5 h-3.5"></i>
              সকল তারিখের আর্কাইভ (${distinctDates.length})
            </button>
          </div>

          <!-- Admin Quick Action Buttons -->
          <div class="flex flex-wrap items-center gap-2">
            <button id="management-add-member-date-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 shadow-[0_2px_8px_rgba(79,70,229,0.3)] cursor-pointer">
              <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
              + মেম্বার যোগ করুন
            </button>

            ${breakdown.hasLogsForDate ? `
              <button id="management-delete-date-submission-btn" data-date="${selectedDate}" class="bg-rose-950/20 hover:bg-rose-950/40 text-rose-400 border border-rose-500/30 hover:border-rose-500 font-bold text-xs px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                এই তারিখের রেকর্ড মুছুন
              </button>
            ` : ''}
          </div>
        </div>

        ${activeTab !== 'archive' ? `
          <!-- Search input for members in this date -->
          <div class="relative">
            <i data-lucide="search" class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
            <input id="management-search-input" type="text" value="${searchQuery}" placeholder="মেম্বারের নাম বা মেম্বার নম্বর দিয়ে খুঁজুন..." class="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder-slate-600 font-mono" />
            ${searchQuery ? `
              <button id="management-clear-search-btn" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>

      <!-- Main Tab Content Area -->
      ${activeTab === 'archive' ? renderHistoricalDatesArchive(distinctDates, selectedDate) : (
        !breakdown.hasLogsForDate ? renderNoLogsForDateState(selectedDate, formattedSelectedDate, distinctDates) : (
          activeTab === 'all' ? renderAllMembersForDate(breakdown, selectedDate) :
          activeTab === 'active' ? renderActiveMembersForDate(breakdown.activeMembers, selectedDate) :
          renderInactiveMembersForDate(breakdown.inactiveMembers, selectedDate)
        )
      )}

    </div>
  `;
}

// Render friendly Empty State when no list exists for the selected date
function renderNoLogsForDateState(selectedDate, formattedSelectedDate, distinctDates) {
  return `
    <div class="bg-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-12 text-center shadow-xl space-y-4">
      <div class="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto text-2xl shadow-inner">
        📅
      </div>
      <div class="space-y-2 max-w-lg mx-auto">
        <h3 class="text-base sm:text-lg font-black text-slate-100">
          এই তারিখের কোনো Daily Link List জমা দেওয়া হয়নি
        </h3>
        <p class="text-xs sm:text-sm text-slate-400 leading-relaxed font-sans">
          <strong>${formattedSelectedDate}</strong> তারিখে কোনো মেম্বারের লিংক সাবমিশন রেকর্ড পাওয়া যায়নি। এডমিন নিজে লিঙ্ক লিস্ট সাবমিট না করা পর্যন্ত কোনো সক্রিয় বা নিষ্ক্রিয় তালিকা তৈরি হবে না।
        </p>
      </div>
      <div class="pt-3 flex flex-wrap items-center justify-center gap-3">
        <button data-tab="bulk" class="tab-btn px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs rounded-xl shadow-lg transition cursor-pointer flex items-center gap-2">
          <i data-lucide="upload" class="w-4 h-4"></i>
          + এই তারিখের জন্য লিঙ্ক লিস্ট জমা দিন
        </button>
        ${distinctDates.length > 0 ? `
          <button data-management-select-date="${distinctDates[0].date}" class="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl transition cursor-pointer flex items-center gap-2">
            <i data-lucide="calendar" class="w-4 h-4 text-emerald-400"></i>
            সর্বশেষ রেকর্ড দেখুন (${formatDisplayDate(distinctDates[0].date)})
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

// Render Historical Submissions Archive List
function renderHistoricalDatesArchive(distinctDates, selectedDate) {
  const members = getMembers().filter(m => m.status !== 'frozen');
  const totalReg = members.length;

  return `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 class="font-bold text-sm text-slate-100 uppercase tracking-wide flex items-center gap-2">
            <i data-lucide="history" class="w-4 h-4 text-cyan-400"></i>
            Historical Daily Submissions Archive
          </h3>
          <p class="text-[11px] text-slate-400 mt-0.5">যে সকল তারিখে Daily Link জমা রেকর্ড করা হয়েছে তাদের সম্পূর্ণ হিস্টোরি।</p>
        </div>
        <span class="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-3 py-1.5 rounded-xl border border-cyan-500/20 font-mono">
          মোট ${distinctDates.length} দিন
        </span>
      </div>

      <div class="space-y-2 max-h-[500px] overflow-y-auto pr-1 divide-y divide-slate-850">
        ${distinctDates.length > 0 ? distinctDates.map(item => {
          const isSelected = item.date === selectedDate;
          const formatted = formatDisplayDate(item.date);
          const activePercent = totalReg > 0 ? Math.round((item.activeLogs / totalReg) * 100) : 0;
          const adminNamesStr = Array.from(item.admins).join(', ') || 'Admin';

          return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl transition gap-3 pt-3 ${
              isSelected ? 'bg-indigo-950/30 border border-indigo-500/30' : 'bg-slate-950/40 hover:bg-slate-950 border border-slate-850'
            }">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center font-bold text-indigo-400 font-mono text-xs shrink-0">
                  📅
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-black text-slate-100 font-mono">${formatted}</span>
                    <span class="text-[10px] text-slate-500 font-mono">(${item.date})</span>
                    ${isSelected ? '<span class="text-[9px] bg-indigo-500 text-white font-black px-1.5 py-0.5 rounded uppercase tracking-wider">Viewing Now</span>' : ''}
                  </div>
                  <p class="text-[10px] text-slate-400 mt-0.5">
                    এডমিন: <b class="text-slate-300">${adminNamesStr}</b> • মোট লগ: ${item.totalLogs} টি
                  </p>
                </div>
              </div>

              <!-- Stats & Action buttons -->
              <div class="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <div class="text-right font-mono">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-black text-emerald-400">🟢 ${item.activeLogs} Active</span>
                    <span class="text-xs font-black text-rose-400">🔴 ${item.inactiveLogs} Inactive</span>
                  </div>
                  <div class="w-32 bg-slate-900 h-1.5 rounded-full overflow-hidden mt-1 border border-slate-800">
                    <div class="bg-emerald-500 h-full rounded-full" style="width: ${activePercent}%"></div>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <button data-management-select-date="${item.date}" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3 py-2 rounded-xl transition cursor-pointer flex items-center gap-1">
                    <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                    বিস্তারিত দেখুন
                  </button>
                  <button data-management-delete-date="${item.date}" title="Delete entire submission" class="p-2 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 transition cursor-pointer">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('') : `
          <div class="text-center py-12 text-slate-500">
            <i data-lucide="archive" class="w-12 h-12 text-slate-700 mx-auto mb-2"></i>
            <p class="font-bold text-sm text-slate-400">কোনো আর্কাইভ রেকর্ড পাওয়া যায়নি</p>
            <p class="text-xs text-slate-600 mt-1">Daily Link Submission পেস্ট করলে এখানে স্বয়ংক্রিয়ভাবে তারিখভিত্তিক তালিকা জমা হবে।</p>
          </div>
        `}
      </div>
    </div>
  `;
}

// Render All Registered Members for the date (Active + Inactive in single unified view)
function renderAllMembersForDate(breakdown, selectedDate) {
  const list = breakdown.allMembersBreakdown;

  return `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 class="font-bold text-sm text-slate-100 uppercase tracking-wide flex items-center gap-2">
            <i data-lucide="list-ordered" class="w-4 h-4 text-indigo-400"></i>
            তারিখ: ${formatDisplayDate(selectedDate)} — সকল নিবন্ধিত মেম্বারের স্টেটাস (${list.length})
          </h3>
          <p class="text-[11px] text-slate-400 mt-0.5">
            মেম্বারের নামের ওপর ক্লিক করলে তার সরাসরি Member Profile ওপেন হবে।
          </p>
        </div>
      </div>

      <div class="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
        ${list.length > 0 ? list.map((item, idx) => {
          const m = item.member;
          const log = item.log;
          const isActive = item.isActive;
          const adminName = log && log.submitted_by ? (ADMIN_NAMES[log.submitted_by] || log.submitted_by) : 'Admin';
          const sourceName = log ? (log.source || (log.id && log.id.startsWith('manual-') ? 'Manual Entry' : 'Daily Submission')) : 'N/A';

          return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl transition gap-3 bg-slate-950/60 border ${
              isActive ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-slate-850 hover:border-slate-800'
            }">
              
              <!-- Left side info -->
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0 font-mono">
                  ${idx + 1}
                </div>

                <div class="w-10 h-10 rounded-2xl ${isActive ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-slate-900 border border-slate-800 text-slate-500'} flex items-center justify-center text-lg font-bold shrink-0">
                  ${m.level === 'Diamond' ? '💎' : m.level === 'Gold' ? '⭐' : m.level === 'Silver' ? '🥈' : '🥉'}
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <button data-open-profile="${m.id}" class="text-xs font-extrabold text-slate-100 hover:text-indigo-400 transition cursor-pointer text-left truncate flex items-center gap-1 group">
                      <span>${m.name}</span>
                      <i data-lucide="external-link" class="w-3 h-3 opacity-0 group-hover:opacity-100 text-indigo-400 transition"></i>
                    </button>
                    <span class="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }">${isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                  
                  <p class="text-[10px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span class="font-mono font-semibold text-slate-400">ID: #${m.member_number}</span>
                    <span>•</span>
                    <span>Level: ${m.level}</span>
                    ${isActive && log ? `
                      <span>•</span>
                      <span>By: <b class="text-slate-400">${adminName}</b></span>
                    ` : `
                      <span>•</span>
                      <span class="text-rose-400/80 font-mono">${m.consecutive_inactive_days} দিন ইনেক্টিভ</span>
                    `}
                  </p>
                </div>
              </div>

              <!-- Right side actions -->
              <div class="flex items-center justify-between sm:justify-end gap-2 shrink-0 border-t sm:border-t-0 border-slate-850 pt-2 sm:pt-0">
                ${isActive && log ? `
                  <span class="text-xs font-black font-mono text-indigo-400 mr-1">
                    +${log.points_earned !== undefined ? log.points_earned : 10} Pts
                  </span>

                  <button data-open-activity-detail="${log.id}" data-member-id="${m.id}" class="text-[10px] font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 cursor-pointer">
                    <i data-lucide="eye" class="w-3 h-3"></i> Details
                  </button>

                  <button data-management-replace-member="${m.id}" data-date="${selectedDate}" title="Replace with another member" class="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-400 border border-slate-800 transition cursor-pointer">
                    <i data-lucide="arrow-left-right" class="w-3.5 h-3.5"></i>
                  </button>

                  <button data-management-invalidate-member="${m.id}" data-date="${selectedDate}" title="Mark submission as Invalid" class="p-1.5 rounded-xl bg-slate-900 hover:bg-amber-950/40 text-slate-400 hover:text-amber-400 border border-slate-800 transition cursor-pointer">
                    <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>
                  </button>

                  <button data-management-remove-member="${m.id}" data-date="${selectedDate}" title="Remove submission for this date" class="p-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 transition cursor-pointer">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                ` : `
                  <button data-management-add-active="${m.id}" data-date="${selectedDate}" class="bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 border border-emerald-500/30 text-[10px] font-extrabold px-3 py-1.5 rounded-xl transition flex items-center gap-1 cursor-pointer">
                    <i data-lucide="check" class="w-3 h-3"></i>
                    Mark Active (লিংক জমা করুন)
                  </button>
                `}
              </div>

            </div>
          `;
        }).join('') : `
          <p class="text-xs text-slate-500 text-center py-8">কোনো মেম্বার পাওয়া যায়নি।</p>
        `}
      </div>
    </div>
  `;
}

// Render Only Active Members for the date
function renderActiveMembersForDate(activeList, selectedDate) {
  return `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 class="font-bold text-sm text-emerald-400 uppercase tracking-wide flex items-center gap-2">
            <i data-lucide="check-circle-2" class="w-4 h-4"></i>
            তারিখ: ${formatDisplayDate(selectedDate)} — সক্রিয় মেম্বারদের তালিকা (${activeList.length})
          </h3>
          <p class="text-[11px] text-slate-400 mt-0.5">এই তারিখে যারা লিঙ্ক জমা দিয়েছেন তাদের তালিকা ও এডিটর।</p>
        </div>
      </div>

      <div class="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        ${activeList.length > 0 ? activeList.map((item, idx) => {
          const m = item.member;
          const log = item.log;
          const adminName = log && log.submitted_by ? (ADMIN_NAMES[log.submitted_by] || log.submitted_by) : 'Admin';

          return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-slate-950/70 border border-emerald-500/20 hover:border-emerald-500/40 transition gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-bold text-emerald-400 shrink-0 font-mono">
                  ${idx + 1}
                </div>

                <div class="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-lg font-bold shrink-0">
                  ${m.level === 'Diamond' ? '💎' : m.level === 'Gold' ? '⭐' : m.level === 'Silver' ? '🥈' : '🥉'}
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <button data-open-profile="${m.id}" class="text-xs font-extrabold text-slate-100 hover:text-indigo-400 transition cursor-pointer text-left truncate flex items-center gap-1 group">
                      <span>${m.name}</span>
                      <i data-lucide="external-link" class="w-3 h-3 opacity-0 group-hover:opacity-100 text-indigo-400 transition"></i>
                    </button>
                    <span class="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>
                  </div>
                  <p class="text-[10px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span class="font-mono text-slate-400">ID: #${m.member_number}</span>
                    <span>•</span>
                    <span>Level: ${m.level}</span>
                    <span>•</span>
                    <span>By: <b class="text-slate-400">${adminName}</b></span>
                  </p>
                </div>
              </div>

              <div class="flex items-center justify-between sm:justify-end gap-2 shrink-0 border-t sm:border-t-0 border-slate-850 pt-2 sm:pt-0">
                <span class="text-xs font-black font-mono text-indigo-400 mr-1">
                  +${log.points_earned !== undefined ? log.points_earned : 10} Pts
                </span>

                <button data-open-activity-detail="${log.id}" data-member-id="${m.id}" class="text-[10px] font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 cursor-pointer">
                  <i data-lucide="eye" class="w-3 h-3"></i> Details
                </button>

                <button data-management-replace-member="${m.id}" data-date="${selectedDate}" title="Replace member" class="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-400 border border-slate-800 transition cursor-pointer">
                  <i data-lucide="arrow-left-right" class="w-3.5 h-3.5"></i>
                </button>

                <button data-management-invalidate-member="${m.id}" data-date="${selectedDate}" title="Mark as Invalid" class="p-1.5 rounded-xl bg-slate-900 hover:bg-amber-950/40 text-slate-400 hover:text-amber-400 border border-slate-800 transition cursor-pointer">
                  <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i>
                </button>

                <button data-management-remove-member="${m.id}" data-date="${selectedDate}" title="Remove submission" class="p-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 transition cursor-pointer">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </div>
          `;
        }).join('') : `
          <p class="text-xs text-slate-500 text-center py-8">এই তারিখে কোনো একটিভ মেম্বার রেকর্ড নেই।</p>
        `}
      </div>
    </div>
  `;
}

// Render Only Inactive Members for the date
function renderInactiveMembersForDate(inactiveList, selectedDate) {
  return `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 class="font-bold text-sm text-rose-400 uppercase tracking-wide flex items-center gap-2">
            <i data-lucide="x-circle" class="w-4 h-4"></i>
            তারিখ: ${formatDisplayDate(selectedDate)} — লিঙ্ক না দেওয়া মেম্বারদের তালিকা (${inactiveList.length})
          </h3>
          <p class="text-[11px] text-slate-400 mt-0.5">এই তারিখে যারা লিঙ্ক জমা দেননি তাদের বিস্তারিত ও ম্যানুয়াল অ্যাকশন।</p>
        </div>
      </div>

      <div class="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        ${inactiveList.length > 0 ? inactiveList.map((item, idx) => {
          const m = item.member;

          return `
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-slate-950/70 border border-slate-850 hover:border-slate-800 transition gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <div class="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-bold text-rose-400 shrink-0 font-mono">
                  ${idx + 1}
                </div>

                <div class="w-10 h-10 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500 flex items-center justify-center text-lg font-bold shrink-0">
                  ${m.level === 'Diamond' ? '💎' : m.level === 'Gold' ? '⭐' : m.level === 'Silver' ? '🥈' : '🥉'}
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <button data-open-profile="${m.id}" class="text-xs font-extrabold text-slate-100 hover:text-indigo-400 transition cursor-pointer text-left truncate flex items-center gap-1 group">
                      <span>${m.name}</span>
                      <i data-lucide="external-link" class="w-3 h-3 opacity-0 group-hover:opacity-100 text-indigo-400 transition"></i>
                    </button>
                    <span class="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">Inactive</span>
                  </div>
                  <p class="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                    <span class="font-mono text-slate-400">ID: #${m.member_number}</span>
                    <span>•</span>
                    <span class="text-rose-400/80 font-mono font-bold">${m.consecutive_inactive_days} দিন ইনেক্টিভ</span>
                    <span>•</span>
                    <span>শেষ একটিভ: ${m.last_active_date || 'কখনো নয়'}</span>
                  </p>
                </div>
              </div>

              <div class="flex items-center justify-between sm:justify-end gap-2 shrink-0 border-t sm:border-t-0 border-slate-850 pt-2 sm:pt-0">
                <button data-management-add-active="${m.id}" data-date="${selectedDate}" class="bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 border border-emerald-500/30 text-[10px] font-extrabold px-3.5 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer">
                  <i data-lucide="check" class="w-3 h-3"></i>
                  Mark Active for ${formatDisplayDate(selectedDate)}
                </button>
              </div>
            </div>
          `;
        }).join('') : `
          <p class="text-xs text-slate-500 text-center py-8">এই তারিখে কোনো নিষ্ক্রিয় মেম্বার নেই (১০০% উপস্থিতি)!</p>
        `}
      </div>
    </div>
  `;
}

// Render Modal: Add Member to Date Submission
export function renderManagementAddMemberModal(state) {
  if (!state.managementAddMemberDateModal) return '';
  const dateStr = state.managementAddMemberDateModal.date || state.managementSelectedDate || new Date().toISOString().split('T')[0];
  const members = getMembers().filter(m => m.status !== 'frozen');
  
  // Find which members are already active on this date
  const logs = getActivityLogs().filter(l => l.activity_date === dateStr && l.is_active);
  const activeIds = new Set(logs.map(l => l.member_id));
  const availableMembers = members.filter(m => !activeIds.has(m.id));

  return `
    <div id="management-add-member-modal-overlay" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 animate-scale-in">
        
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-2.5 text-indigo-400">
            <div class="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
              <i data-lucide="user-plus" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="font-extrabold text-slate-100 text-sm tracking-wide uppercase">Add Member to Date Submission</h3>
              <p class="text-[10px] text-slate-400">তারিখ: <b class="text-indigo-400 font-mono">${formatDisplayDate(dateStr)}</b></p>
            </div>
          </div>
          <button id="close-management-add-member-modal-btn" class="text-slate-400 hover:text-slate-200 bg-slate-950 p-2 rounded-xl border border-slate-800 transition cursor-pointer">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Select Member (নিষ্ক্রিয় মেম্বার নির্বাচন করুন)</label>
            <select id="management-add-member-select" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer">
              <option value="">-- মেম্বার নির্বাচন করুন (${availableMembers.length} জন উপলব্ধ) --</option>
              ${availableMembers.map(m => `
                <option value="${m.id}">${m.name} (#${m.member_number} - Level: ${m.level})</option>
              `).join('')}
            </select>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Activity Date</label>
              <input id="management-add-member-date" type="date" value="${dateStr}" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Points Earned</label>
              <input id="management-add-member-points" type="number" value="10" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
          <button id="cancel-management-add-member-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer">
            বাতিল
          </button>
          <button id="submit-management-add-member-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-lg transition cursor-pointer flex items-center gap-1.5">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            সাবমিশন যোগ করুন
          </button>
        </div>

      </div>
    </div>
  `;
}

// Render Modal: Replace Member in Date Submission
export function renderManagementReplaceMemberModal(state) {
  if (!state.managementReplaceMemberModal) return '';
  const { memberId, date } = state.managementReplaceMemberModal;
  const oldMember = getMembers().find(m => m.id === memberId);
  const otherMembers = getMembers().filter(m => m.id !== memberId && m.status !== 'frozen');

  return `
    <div id="management-replace-member-modal-overlay" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[110] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 animate-scale-in">
        
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-2.5 text-amber-400">
            <div class="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <i data-lucide="arrow-left-right" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="font-extrabold text-slate-100 text-sm tracking-wide uppercase">Replace Member in Submission</h3>
              <p class="text-[10px] text-slate-400">তারিখ: <b class="text-amber-400 font-mono">${formatDisplayDate(date)}</b></p>
            </div>
          </div>
          <button id="close-management-replace-member-modal-btn" class="text-slate-400 hover:text-slate-200 bg-slate-950 p-2 rounded-xl border border-slate-800 transition cursor-pointer">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <div class="space-y-3">
          <div class="bg-slate-950 p-3 rounded-2xl border border-slate-800/80">
            <p class="text-[10px] text-slate-500 uppercase font-bold">বর্তমান সক্রিয় মেম্বার (Current Active Member):</p>
            <p class="text-xs font-black text-slate-200 mt-1">${oldMember ? oldMember.name : 'Unknown'} (#${oldMember ? oldMember.member_number : ''})</p>
          </div>

          <div>
            <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Select Replacement Member (নতুন মেম্বার নির্বাচন করুন)</label>
            <select id="management-replace-new-member-select" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer">
              <option value="">-- নতুন মেম্বার বেছে নিন --</option>
              ${otherMembers.map(m => `
                <option value="${m.id}">${m.name} (#${m.member_number} - Level: ${m.level})</option>
              `).join('')}
            </select>
          </div>
          
          <p class="text-[11px] text-slate-400 leading-relaxed bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 text-amber-300">
            💡 পরিবর্তন নিশ্চিত করলে পূর্বের মেম্বারের এই তারিখের সাবমিশন বাতিল হবে এবং নতুন নির্বাচিত মেম্বারের নামে সাবমিশন যুক্ত হবে। পয়েন্ট ও স্ট্রেইক স্বয়ংক্রিয়ভাবে আপডেট হবে।
          </p>
        </div>

        <div class="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
          <button id="cancel-management-replace-member-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer">
            বাতিল
          </button>
          <button id="submit-management-replace-member-btn" data-old-member-id="${memberId}" data-date="${date}" class="bg-amber-600 hover:bg-amber-500 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-lg transition cursor-pointer flex items-center gap-1.5">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            মেম্বার প্রতিস্থাপন করুন
          </button>
        </div>

      </div>
    </div>
  `;
}
