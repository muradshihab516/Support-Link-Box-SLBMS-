// Support Link Box - Core Administration Engine (Vanilla JS Edition)
// High-performance client-side state machine with localStorage persistence

import { ADMIN_NAMES, STORAGE_KEYS, CONFIG } from './src/constants.js';
import { getState, updateState, subscribeState } from './src/state.js';
import { 
  initializeDatabase, getMembers, saveMembers, getActivityLogs, saveActivityLogs, 
  getAuditTrails, saveAuditTrails, getBadges, saveBadges, getCurrentAdmin, setCurrentAdmin,
  cleanName, getNormalizedName, getUltraNormalizedName, findMatchingMember, findFuzzyMemberSuggestion,
  detectDateFromText, getYesterdayDateStr, getDiffDays, 
  dataURLtoBlob, deduplicateMembers, registerSyncEnqueueHandler, generateUUID,
  toBanglaNumber, getEmojiNumber
} from './src/database.js';
import { 
  getSupabase, setupSupabaseRealtime, initSupabaseConfig, testSupabaseConnection, 
  performSmartSync, pullFromSupabase, silentPullFromSupabase, pushToSupabase, enqueueSyncJob,
  wipeDatabaseAll
} from './src/supabase.js';
import { 
  handleAddMember, handleBulkAddMembers, parseBulkActivityText, submitBulkActivity,
  analyzeUnregisteredDuplicates, analyzeAllDuplicates, calculateSubmissionStats,
  recalculateAllMemberStatsFromLogs, addManualMemberLog, updateMemberLogStatus, deleteMemberLog,
  updateActivityLog, deleteActivityLog,
  updateMemberDetails, addMemberAlias, removeMemberAlias,
  deleteDailySubmissionRecord, clearAllActivityLogsRecords, addMemberToDateSubmission, removeMemberFromDateSubmission,
  markSubmissionInvalid, replaceMemberInDateSubmission
} from './src/member.js';
import { 
  renderManagementSection, 
  renderManagementAddMemberModal, 
  renderManagementReplaceMemberModal,
  formatDisplayDate
} from './src/management.js';
import { showToast } from './src/toast.js';
import { showAlert, showConfirm } from './src/modal.js';

// Global variables and exports
export { 
  ADMIN_NAMES, STORAGE_KEYS, CONFIG,
  initializeDatabase, getMembers, saveMembers, getActivityLogs, saveActivityLogs, 
  getAuditTrails, saveAuditTrails, getBadges, saveBadges, getCurrentAdmin, setCurrentAdmin,
  cleanName, getNormalizedName, detectDateFromText, getYesterdayDateStr, getDiffDays, 
  dataURLtoBlob, deduplicateMembers,
  getSupabase, setupSupabaseRealtime, initSupabaseConfig, testSupabaseConnection, 
  performSmartSync, pullFromSupabase, silentPullFromSupabase, pushToSupabase,
  handleAddMember, handleBulkAddMembers, parseBulkActivityText, submitBulkActivity,
  showToast, showAlert, showConfirm
};

export function getHardcodedUrl() {
  return 'https://qjqjyvxqeleasnodyexq.supabase.co';
}

export function getHardcodedKey() {
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqcWp5dnhxZWxlYXNub2R5ZXhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDAwODEsImV4cCI6MjA5ODkxNjA4MX0.hnhNCssPzHqcZGb8f_Yl0l6LHYHX1TKGOQ_edjc2t18';
}

// Inter-link database saves with our centralized Sync Queue
registerSyncEnqueueHandler(enqueueSyncJob);

export let state = getState();

// Wait for Supabase CDN script to load
export async function ensureSupabaseLoaded(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    if (window.supabase) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

// Load initial database records and configuration
export function loadStateFromStorage() {
  initializeDatabase();
  initSupabaseConfig();
  
  const rawLocalMembers = getMembers();
  const supabaseClient = getSupabase();
  const cleanedMembers = deduplicateMembers(rawLocalMembers, supabaseClient);
  if (cleanedMembers.length !== rawLocalMembers.length) {
    saveMembers(cleanedMembers, true);
  }
  
  const savedSnapshot = localStorage.getItem('support_linkbox_last_submission_snapshot');
  let lastSubmissionSnapshot = null;
  if (savedSnapshot) {
    try {
      const parsed = JSON.parse(savedSnapshot);
      const elapsed = Date.now() - new Date(parsed.timestamp).getTime();
      if (elapsed <= 5 * 60 * 1000) {
        lastSubmissionSnapshot = parsed;
      } else {
        localStorage.removeItem('support_linkbox_last_submission_snapshot');
      }
    } catch (e) {
      console.error('Failed to load snapshot:', e);
    }
  }

  updateState({
    members: cleanedMembers,
    auditTrails: getAuditTrails(),
    currentAdminEmail: getCurrentAdmin(),
    lastSubmissionSnapshot
  });
  
  const currentState = getState();
  if (currentState.supabaseUrl && currentState.supabaseKey) {
    setTimeout(() => {
      ensureSupabaseLoaded().then(loaded => {
        if (loaded) {
          testSupabaseConnection();
        }
      });
    }, 500);
  }
}

// PWA Installer global state
let deferredPrompt = null;

// Parse helper
function getPastDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

// Automatically subscribe the UI render loop to reactive state modifications
subscribeState((newState) => {
  state = newState;
  window.state = newState;
  render();
});

// Global Render loop matching current Tab
function render() {
  const container = document.getElementById('app');
  if (!container) return;

  if (!state.isLoggedIn) {
    container.innerHTML = renderLoginPage();
    lucide.createIcons();
    bindLoginEvents();
    return;
  }

  // Active overview statistics calculations (Excluding frozen members)
  // Rule: Only members missing >= 3 submission days are considered inactive (1 or 2 days missed is still active)
  const nonFrozenMembers = state.members.filter(m => m.status !== 'frozen');
  const totalCount = nonFrozenMembers.length;
  const activeCount = nonFrozenMembers.filter(m => m.consecutive_inactive_days < 3).length;
  const inactiveCount = nonFrozenMembers.filter(m => m.consecutive_inactive_days >= 3).length;
  const diamondCount = nonFrozenMembers.filter(m => m.level === 'Diamond').length;

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

        <!-- Admin Profile Info and Log Out -->
        <div class="flex items-center gap-3">
          <div class="hidden sm:flex flex-col text-right">
            <span class="text-xs font-bold text-slate-200">${ADMIN_NAMES[state.currentAdminEmail] || state.currentAdminEmail}</span>
            <span class="text-[9px] text-slate-500 font-medium">${state.currentAdminEmail}</span>
          </div>
          <button id="logout-btn" class="p-2 rounded-xl border border-rose-500/20 bg-rose-950/10 hover:border-rose-500 hover:bg-rose-900/20 text-rose-400 transition flex items-center justify-center cursor-pointer gap-1.5 px-3" title="Log Out">
            <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
            <span class="text-xs font-bold hidden sm:inline">লগআউট</span>
          </button>
          <button data-tab="supabase" class="tab-btn p-2 rounded-xl border border-slate-800 bg-slate-950/95 hover:border-indigo-500 hover:bg-slate-900 transition flex items-center justify-center relative cursor-pointer group ${
            state.currentTab === 'supabase' ? 'border-indigo-500 bg-indigo-950/20 text-indigo-400' : 'text-slate-400'
          }" title="Supabase Database Settings">
            <i data-lucide="database" class="w-4 h-4"></i>
            <span class="absolute -top-1 -right-1 flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full ${
                state.supabaseConnectionStatus === 'connected' ? 'bg-emerald-400' :
                state.supabaseConnectionStatus === 'connecting' ? 'bg-amber-400' : 'bg-rose-400'
              } opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 ${
                state.supabaseConnectionStatus === 'connected' ? 'bg-emerald-500' :
                state.supabaseConnectionStatus === 'connecting' ? 'bg-amber-500' : 'bg-rose-500'
              }"></span>
            </span>
          </button>
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
        <div class="max-w-4xl mx-auto bg-slate-900/90 border border-slate-800/80 p-3 sm:p-4 rounded-3xl shadow-[0_16px_40px_rgba(0,0,0,0.6)]">
          <div class="grid grid-cols-6 gap-1 sm:gap-3 justify-items-center">
            
            <!-- App Icon 1: Leaderboard -->
            <button data-tab="leaderboards" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'leaderboards'
                  ? 'bg-gradient-to-tr from-amber-500 to-yellow-600 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.45)] ring-2 ring-amber-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-amber-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="trophy" class="w-4 h-4 sm:w-5 sm:h-5"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'leaderboards' ? 'text-amber-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">লিডারবোর্ড</span>
              ${state.currentTab === 'leaderboards' ? '<div class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#fbbf24]"></div>' : ''}
            </button>

            <!-- App Icon 2: Directory -->
            <button data-tab="members" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'members'
                  ? 'bg-gradient-to-tr from-emerald-500 to-teal-600 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.45)] ring-2 ring-emerald-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-emerald-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="users" class="w-4 h-4 sm:w-5 sm:h-5"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'members' ? 'text-emerald-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">ডিরেক্টরি</span>
              ${state.currentTab === 'members' ? '<div class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"></div>' : ''}
            </button>

            <!-- App Icon 3: Link Tracker -->
            <button data-tab="bulk_input" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'bulk_input'
                  ? 'bg-gradient-to-tr from-indigo-500 to-blue-600 text-white shadow-[0_0_20px_rgba(99,102,241,0.45)] ring-2 ring-indigo-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-indigo-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="clipboard-list" class="w-4 h-4 sm:w-5 sm:h-5"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'bulk_input' ? 'text-indigo-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">লিংক ট্র্যাকার</span>
              ${state.currentTab === 'bulk_input' ? '<div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_8px_#818cf8]"></div>' : ''}
            </button>

            <!-- App Icon 4: Management -->
            <button data-tab="management" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'management'
                  ? 'bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.45)] ring-2 ring-cyan-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-cyan-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="clipboard-check" class="w-4 h-4 sm:w-5 sm:h-5"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'management' ? 'text-cyan-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">ম্যানেজমেন্ট</span>
              ${state.currentTab === 'management' ? '<div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]"></div>' : ''}
            </button>

            <!-- App Icon 5: Notice -->
            <button data-tab="notices" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'notices'
                  ? 'bg-gradient-to-tr from-rose-500 to-orange-600 text-white shadow-[0_0_20px_rgba(244,63,94,0.45)] ring-2 ring-rose-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-rose-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="megaphone" class="w-4 h-4 sm:w-5 sm:h-5"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'notices' ? 'text-rose-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">নোটিশ</span>
              ${state.currentTab === 'notices' ? '<div class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse shadow-[0_0_8px_#fb7185]"></div>' : ''}
            </button>

            <!-- App Icon 6: Report Card -->
            <button data-tab="reports" class="tab-btn flex flex-col items-center gap-1.5 focus:outline-none transition group cursor-pointer w-full max-w-[80px]">
              <div class="w-10 h-10 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center transition-all duration-300 transform group-hover:scale-105 active:scale-95 ${
                state.currentTab === 'reports'
                  ? 'bg-gradient-to-tr from-teal-500 to-sky-600 text-slate-950 shadow-[0_0_20px_rgba(20,184,166,0.45)] ring-2 ring-teal-400'
                  : 'bg-slate-950 border border-slate-850 text-slate-400 group-hover:text-teal-400 group-hover:border-slate-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]'
              }">
                <i data-lucide="trending-up" class="w-4 h-4 sm:w-5 sm:h-5"></i>
              </div>
              <span class="text-[8px] sm:text-xs font-black tracking-tight text-center leading-tight transition-colors ${
                state.currentTab === 'reports' ? 'text-teal-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
              }">রিপোর্ট কার্ড</span>
              ${state.currentTab === 'reports' ? '<div class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_#2dd4bf]"></div>' : ''}
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

        <button data-tab="management" class="tab-btn flex items-center gap-2.5 bg-slate-950/95 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-900 px-4 py-2.5 rounded-2xl shadow-xl transition-all hover:translate-x-[-4px] group cursor-pointer ${
          state.currentTab === 'management' ? 'border-cyan-500 text-cyan-400 bg-cyan-950/20' : ''
        }">
          <span class="text-xs font-bold text-slate-300 group-hover:text-white transition">ম্যানেজমেন্ট (Management)</span>
          <div class="bg-cyan-950/40 p-1.5 rounded-lg text-cyan-400 group-hover:bg-cyan-600/20 transition border border-cyan-500/10">
            <i data-lucide="clipboard-check" class="w-4 h-4"></i>
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

    ${state.duplicateResolutionModal ? `
    <!-- Custom beautiful duplicate resolution modal -->
    <div id="duplicate-resolution-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
        <div class="flex items-center gap-3 text-amber-500 border-b border-slate-800 pb-3">
          <i data-lucide="alert-triangle" class="w-6 h-6 animate-pulse"></i>
          <h3 class="font-extrabold text-slate-100 text-sm tracking-wide uppercase">⚠️ Duplicate Name Found in Today's Submission</h3>
        </div>
        <p class="text-[11px] text-slate-300 font-semibold leading-relaxed">
          নিচের Member-দের নাম একাধিকবার পাওয়া গেছে। অনুগ্রহ করে সিদ্ধান্ত নিন— Rename (যদি দুইজন ভিন্ন Member হয়) অথবা Skip Duplicate (যদি ভুলবশত একই Member দুইবার লেখা হয়ে থাকে)।
        </p>

        <div class="space-y-4 divide-y divide-slate-800/60 max-h-[50vh] overflow-y-auto pr-1">
          ${state.duplicateResolutionModal.duplicates.map((dup, dupIdx) => `
            <div class="pt-3 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-amber-400 font-mono">@${dup.name} (${dup.count} বার পাওয়া গেছে)</span>
              </div>
              
              <div class="space-y-2.5">
                ${dup.occurrences.map((occ, occIdx) => `
                  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/50 p-3 rounded-xl border border-slate-800/40">
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] text-slate-400 font-mono">Occur ${occIdx + 1}</span>
                      ${occ.isRegistered ? `<span class="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Registered Member</span>` : ''}
                    </div>
                    
                    <div class="flex items-center gap-2 flex-grow sm:justify-end">
                      ${occ.skipped ? `
                        <span class="text-[10px] text-rose-400 font-bold bg-rose-500/10 px-2 py-1 rounded">Skipped</span>
                        <button class="toggle-skip-btn text-[9px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg font-bold cursor-pointer" data-dup-idx="${dupIdx}" data-occ-idx="${occIdx}">Undo Skip</button>
                      ` : `
                        <input type="text" value="${occ.resolvedName}" class="rename-occ-input bg-slate-900 border border-slate-800 text-xs px-2.5 py-1.5 rounded-lg text-slate-200 font-semibold focus:outline-none focus:border-indigo-500 w-full max-w-[180px]" data-dup-idx="${dupIdx}" data-occ-idx="${occIdx}" />
                        <button class="toggle-skip-btn text-[9px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-2.5 py-1.5 rounded-lg border border-rose-500/20 font-semibold cursor-pointer" data-dup-idx="${dupIdx}" data-occ-idx="${occIdx}">Skip</button>
                      `}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="flex justify-end gap-3 pt-3 border-t border-slate-800">
          <button id="dup-resolve-cancel-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px] px-4 py-2.5 rounded-xl transition cursor-pointer">
            বাতিল
          </button>
          <button id="dup-resolve-save-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[10px] px-5 py-2.5 rounded-xl shadow-lg transition cursor-pointer">
            সংরক্ষণ করুন
          </button>
        </div>
      </div>
    </div>
    ` : ''}

    ${state.unregisteredResolutionModal ? `
    <!-- Custom beautiful unregistered names resolution modal with Fuzzy Suggestions -->
    <div id="unregistered-resolution-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
        <div class="flex items-center gap-3 text-amber-500 border-b border-slate-800 pb-3">
          <div class="p-2 bg-amber-500/10 rounded-xl border border-amber-500/25">
            <i data-lucide="user-plus" class="w-6 h-6 animate-pulse"></i>
          </div>
          <div>
            <h3 class="font-extrabold text-slate-100 text-sm tracking-wide uppercase">⚠️ Unregistered / Ambiguous Member Detected</h3>
            <p class="text-[10px] text-slate-400 font-semibold leading-relaxed mt-0.5">নিচের নামগুলো ডাটাবেজের সাথে নিখুঁতভাবে মেলেনি। অনুগ্রহ করে অ্যাকশন নির্বাচন করুন।</p>
          </div>
        </div>

        <div class="space-y-4 divide-y divide-slate-800/60 max-h-[45vh] overflow-y-auto pr-1">
          ${state.unregisteredResolutionModal.unregisteredNames.map((item, idx) => `
            <div class="pt-3 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-amber-400 font-mono">@${item.originalName}</span>
                ${item.suggestedMember ? `
                  <span class="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-md font-bold">
                    💡 Suggested: ${item.suggestedMember.name} (${Math.round(item.similarity * 100)}% match)
                  </span>
                ` : ''}
              </div>
              
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/50 p-3 rounded-xl border border-slate-800/40">
                <div class="flex items-center gap-2">
                  <select class="unreg-action-select bg-slate-900 border border-slate-800 text-[10px] px-2 py-1 rounded-lg text-slate-300 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer" data-unreg-idx="${idx}">
                    ${item.suggestedMember ? `
                      <option value="link_alias" ${item.action === 'link_alias' ? 'selected' : ''}>Link as Alias to ${item.suggestedMember.name}</option>
                    ` : ''}
                    <option value="register" ${item.action === 'register' ? 'selected' : ''}>Register as New Member</option>
                    <option value="rename" ${item.action === 'rename' ? 'selected' : ''}>Rename / Custom</option>
                    <option value="skip" ${item.action === 'skip' ? 'selected' : ''}>Skip / Ignore</option>
                  </select>
                </div>
                
                <div class="flex items-center gap-2 flex-grow sm:justify-end">
                  ${item.action === 'skip' ? `
                    <span class="text-[10px] text-rose-400 font-bold bg-rose-500/10 px-2.5 py-1 rounded">Ignored</span>
                  ` : item.action === 'link_alias' && item.suggestedMember ? `
                    <span class="text-[10px] text-indigo-400 font-bold bg-indigo-500/10 px-2.5 py-1 rounded border border-indigo-500/20">Linked to #${item.suggestedMember.member_number}</span>
                  ` : `
                    <input type="text" value="${item.resolvedName}" class="unreg-resolved-input bg-slate-900 border border-slate-800 text-xs px-2.5 py-1.5 rounded-lg text-slate-200 font-semibold focus:outline-none focus:border-indigo-500 w-full max-w-[180px]" data-unreg-idx="${idx}" ${item.action === 'register' ? 'readonly disabled opacity-60' : ''} />
                  `}
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="flex justify-end gap-3 pt-3 border-t border-slate-800">
          <button id="unreg-resolve-cancel-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px] px-4 py-2.5 rounded-xl transition cursor-pointer">
            বাতিল
          </button>
          <button id="unreg-resolve-save-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[10px] px-5 py-2.5 rounded-xl shadow-lg transition cursor-pointer">
            সংরক্ষণ করুন
          </button>
        </div>
      </div>
    </div>
    ` : ''}

    ${state.submissionPreviewModal ? `
    <!-- Custom beautiful Pending Submission Preview Modal -->
    <div id="submission-preview-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-[0_24px_50px_rgba(0,0,0,0.8)] relative space-y-6 animate-scale-in max-h-[90vh] overflow-y-auto">
        
        <!-- Header -->
        <div class="flex items-center gap-3 text-indigo-400 border-b border-slate-800 pb-4">
          <div class="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/25">
            <i data-lucide="clipboard-check" class="w-6 h-6"></i>
          </div>
          <div>
            <h3 class="font-extrabold text-slate-100 text-sm tracking-wide uppercase">📋 Pending Submission Preview</h3>
            <p class="text-[10px] text-slate-400 font-semibold leading-relaxed mt-0.5">সবকিছু যাচাই করে নিশ্চিত হোন। এরপর ডাটাবেজে সেভ হবে।</p>
          </div>
        </div>

        <!-- Metrics Grid -->
        <div class="grid grid-cols-2 gap-3.5">
          <!-- Submission Date -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <i data-lucide="calendar" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Submission Date</p>
              <p class="text-xs font-black text-slate-200">${state.submissionPreviewModal.stats.submissionDate}</p>
            </div>
          </div>

          <!-- Total Parsed -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
              <i data-lucide="users" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">মোট Parsed Member</p>
              <p class="text-xs font-black text-indigo-400 font-mono">${state.submissionPreviewModal.stats.totalParsed} জন</p>
            </div>
          </div>

          <!-- Registered Member -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <i data-lucide="check-circle" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Registered Member</p>
              <p class="text-xs font-black text-emerald-400 font-mono">${state.submissionPreviewModal.stats.registeredCount} জন</p>
            </div>
          </div>

          <!-- New Member -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-teal-500/10 text-teal-400 rounded-xl">
              <i data-lucide="user-plus" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">New Member</p>
              <p class="text-xs font-black text-teal-400 font-mono">${state.submissionPreviewModal.stats.newCount} জন</p>
            </div>
          </div>

          <!-- Duplicate Name -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
              <i data-lucide="copy" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Duplicate Name</p>
              <p class="text-xs font-black text-amber-400 font-mono">${state.submissionPreviewModal.stats.duplicateCount} জন</p>
            </div>
          </div>

          <!-- Skipped Member -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-slate-500/10 text-slate-400 rounded-xl">
              <i data-lucide="user-minus" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Skipped Member</p>
              <p class="text-xs font-black text-slate-400 font-mono">${state.submissionPreviewModal.stats.skippedCount} জন</p>
            </div>
          </div>

          <!-- Frozen Member Found -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-cyan-500/10 text-cyan-400 rounded-xl">
              <i data-lucide="snowflake" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Frozen Member Found</p>
              <p class="text-xs font-black text-cyan-400 font-mono">${state.submissionPreviewModal.stats.frozenCount} / ${state.submissionPreviewModal.stats.totalParsed} জন</p>
            </div>
          </div>

          <!-- Alias Match -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-purple-500/10 text-purple-400 rounded-xl">
              <i data-lucide="refresh-cw" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Alias Match</p>
              <p class="text-xs font-black text-purple-400 font-mono">${state.submissionPreviewModal.stats.aliasCount} জন</p>
            </div>
          </div>

          <!-- Invalid Name -->
          <div class="bg-slate-950/50 border border-slate-800/60 p-3 rounded-2xl flex items-center gap-3">
            <div class="p-2 bg-rose-500/10 text-rose-400 rounded-xl">
              <i data-lucide="alert-octagon" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Invalid Name</p>
              <p class="text-xs font-black text-rose-400 font-mono">${state.submissionPreviewModal.stats.invalidCount} জন</p>
            </div>
          </div>

          <!-- Total Activity Added -->
          <div class="bg-slate-950/50 border border-indigo-500/30 p-3 rounded-2xl flex items-center gap-3 ring-1 ring-indigo-500/20">
            <div class="p-2 bg-indigo-500/20 text-indigo-300 rounded-xl">
              <i data-lucide="database" class="w-4 h-4"></i>
            </div>
            <div>
              <p class="text-[9px] text-indigo-400 font-bold uppercase tracking-wider">Total Activity Added</p>
              <p class="text-xs font-black text-indigo-300 font-mono">${state.submissionPreviewModal.stats.totalActivityAdded} জন</p>
            </div>
          </div>
        </div>

        <!-- Buttons -->
        <div class="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-slate-800/60">
          <button id="download-preview-btn" class="flex-grow sm:flex-none bg-slate-950 border border-slate-800 hover:border-indigo-500 hover:bg-slate-900 text-slate-300 hover:text-indigo-400 font-extrabold text-[10px] px-4 py-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 order-2 sm:order-none">
            <i data-lucide="download" class="w-3.5 h-3.5"></i>
            Download Preview
          </button>
          
          <button id="submission-preview-cancel-btn" class="flex-grow sm:flex-none bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px] px-5 py-3 rounded-xl transition cursor-pointer order-3 sm:order-none">
            Go Back & Edit
          </button>
          
          <button id="submission-preview-submit-btn" class="flex-grow sm:flex-none bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-[10px] px-6 py-3 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] hover:shadow-[0_4px_20px_rgba(79,70,229,0.5)] transition cursor-pointer flex items-center justify-center gap-1.5 order-1 sm:order-none">
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            Confirm & Submit
          </button>
        </div>

      </div>
    </div>
    ` : ''}

    ${renderMemberProfileModal()}
    ${renderActivityDetailModal()}
    ${renderManagementAddMemberModal(state)}
    ${renderManagementReplaceMemberModal(state)}
  `;

  // Hot Reload Icons
  lucide.createIcons();
  
  // Bind dynamic interactive events
  bindEvents();
}

// Sub-Tab HTML Render templates
function renderTabContent(totalCount, activeCount, inactiveCount, diamondCount) {
  switch (state.currentTab) {
    
    // TAB: DAILY SUBMISSION MANAGEMENT
    case 'management': {
      return renderManagementSection(state);
    }
    
    // TAB: SUPABASE SETTINGS
    case 'supabase': {
      if (!state.developerUnlocked) {
        return `
          <div class="max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden text-center space-y-6">
            <div class="absolute -right-16 -top-16 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
            <div class="w-16 h-16 bg-indigo-600/10 border border-indigo-500/30 rounded-full flex items-center justify-center text-indigo-400 mx-auto">
              <i data-lucide="lock" class="w-8 h-8"></i>
            </div>
            <div class="space-y-2">
              <h3 class="text-xl font-bold text-white">Developer Settings Gate</h3>
              <p class="text-xs text-slate-400 leading-relaxed">
                This area is restricted to developers and authorized administrators. Please enter the developer access password to continue.
              </p>
            </div>
            <div class="space-y-4">
              <input type="password" id="dev-password-gate-input" placeholder="পাসওয়ার্ড লিখুন" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition-all font-mono text-center" />
              <p id="dev-password-error" class="hidden text-rose-500 text-xs font-semibold"></p>
              <button id="dev-password-submit-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm py-3 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-all cursor-pointer">
                প্রবেশ করুন (Unlock Panel)
              </button>
            </div>
          </div>
        `;
      }

      // Compute status styles and texts clearly to avoid nested template strings
      const isConnected = state.supabaseConnectionStatus === 'connected';
      const isConnecting = state.supabaseConnectionStatus === 'connecting';
      const isError = state.supabaseConnectionStatus === 'error';
      
      const pingBgClass = isConnected ? 'bg-emerald-400' : 'bg-rose-400';
      const pingDotClass = isConnected ? 'bg-emerald-500' : 'bg-rose-500';
      
      let statusBadgeClass = 'bg-slate-800 text-slate-400 border border-slate-700';
      let statusTextHtml = 'কনফিগার করা হয়নি';
      if (isConnected) {
        statusBadgeClass = 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25';
        statusTextHtml = 'কানেক্টেড (Connected)';
      } else if (isConnecting) {
        statusBadgeClass = 'bg-amber-500/15 text-amber-400 border border-amber-500/25';
        statusTextHtml = 'সংযোগ হচ্ছে...';
      } else if (isError) {
        statusBadgeClass = 'bg-rose-500/15 text-rose-400 border border-rose-500/25';
        statusTextHtml = 'ব্যর্থ (Connection Error)';
      }

      const connectionErrorHtml = (state.supabaseConnectionError && isError)
        ? `<p class="text-[9px] text-rose-400 leading-normal line-clamp-2">${state.supabaseConnectionError}</p>`
        : '';

      const urlToggleText = state.showUrlInput ? 'লুকান' : 'দেখুন';
      const urlInputType = state.showUrlInput ? 'text' : 'password';
      const keyToggleText = state.showKeyInput ? 'লুকান' : 'দেখুন';
      const keyInputType = state.showKeyInput ? 'text' : 'password';

      const autoSyncChecked = state.supabaseSyncEnabled ? 'checked' : '';
      const copiedSqlText = state.copiedSQL ? 'Copied!' : 'Copy SQL Script';
      const copiedJsText = state.copiedJS ? 'Copied!' : 'Copy Code Snippet';

      const totalMembersCount = state.members.length;
      const totalLogsCount = getActivityLogs().length;
      const totalBadgesCount = getBadges().length;
      const totalAuditsCount = getAuditTrails().length;

      return `
        <div class="space-y-6">
          <!-- Header Overview -->
          <div class="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/20 border border-slate-800 p-6 sm:p-8 rounded-2xl shadow-xl relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div class="absolute right-0 top-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <div class="space-y-2 z-10">
              <div class="flex items-center gap-2">
                <span class="flex h-2 w-2 relative">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full ${pingBgClass} opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 ${pingDotClass}"></span>
                </span>
                <span class="text-[9px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                  Cloud Configuration Console
                </span>
              </div>
              <h2 class="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <i data-lucide="database" class="w-6 h-6 text-indigo-400"></i>
                Supabase Cloud Synchronization Panel
              </h2>
              <p class="text-xs text-slate-400 max-w-2xl leading-relaxed">
                এখানে আপনার Supabase ক্লাউড ডাটাবেজ ক্রেডেনশিয়ালস সেট আপ করুন এবং লোকাল ডাটাবেজের সাথে লাইভ সিংক্রোনাইজ করুন।
              </p>
            </div>
            
            <div class="bg-slate-950/85 border border-slate-800 rounded-2xl p-4 w-full md:w-64 space-y-2 shrink-0 z-10">
              <p class="text-[10px] text-slate-500 uppercase font-bold tracking-wider">সংযুক্তি স্ট্যাটাস</p>
              <div class="flex items-center gap-2">
                <div class="px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadgeClass}">
                  ${statusTextHtml}
                </div>
              </div>
              ${connectionErrorHtml}
            </div>
          </div>

          ${isError ? `
            <!-- Detailed Error & Solution Banner -->
            <div class="bg-rose-950/40 border border-rose-850 rounded-2xl p-5 sm:p-6 space-y-4">
              <div class="flex items-start gap-3 text-rose-400">
                <i data-lucide="alert-triangle" class="w-6 h-6 shrink-0 mt-0.5 text-rose-400"></i>
                <div class="space-y-1">
                  <h4 class="font-bold text-sm text-rose-200">Supabase সংযোগ বা কনফিগারেশন ত্রুটি ধরা পড়েছে!</h4>
                  <p class="text-xs text-rose-300">নিচে দেয়া সহজ ধাপগুলো অনুসরণ করলে এখনই এটি সফলভাবে কানেক্ট হয়ে যাবে।</p>
                </div>
              </div>
              
              <div class="bg-slate-950 p-4 rounded-xl border border-rose-950/60 text-rose-300 space-y-2">
                <p class="text-[11px] font-black uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  মূল ত্রুটি বার্তা (Error Message):
                </p>
                <code class="text-[11px] font-mono break-all block select-all leading-normal bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-rose-300">${state.supabaseConnectionError}</code>
              </div>

              <div class="space-y-3 bg-slate-900/50 p-5 rounded-xl border border-slate-800 text-xs text-slate-300">
                <p class="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
                  <i data-lucide="help-circle" class="w-4 h-4 text-indigo-400"></i>
                  কীভাবে এটি ঠিক করবেন? (Step-by-Step Solution):
                </p>
                <ol class="space-y-3 pl-5 list-decimal text-slate-300 leading-relaxed">
                  <li>
                    ডানপাশের <strong class="text-emerald-400">"Copy SQL Script"</strong> বাটনে ক্লিক করে পুরো SQL কোডটি কপি করুন।
                  </li>
                  <li>
                    আপনার <a href="https://supabase.com/dashboard" target="_blank" class="text-indigo-400 hover:underline font-bold inline-flex items-center gap-1">Supabase Dashboard <i data-lucide="external-link" class="w-3.5 h-3.5"></i></a> এ লগইন করে আপনার এই প্রোজেক্টটি ওপেন করুন।
                  </li>
                  <li>
                    বামপাশের মেনুবার থেকে <strong class="text-slate-200">SQL Editor</strong> অপশনে ক্লিক করুন।
                  </li>
                  <li>
                    সেখানে <strong class="text-slate-200">"New query"</strong> বাটনে ক্লিক করে একটি নতুন কোড বক্স ক্রিয়েট করুন।
                  </li>
                  <li>
                    কপি করা পুরো SQL কোডটি সেখানে পেস্ট করুন এবং ডানপাশে নিচে থাকা <strong class="text-emerald-400">"Run"</strong> বাটনে ক্লিক করুন। <span class="text-slate-400">(এটি ডাটাবেজের প্রয়োজনীয় ৪টি টেবিল তৈরি করবে এবং RLS সিকিউরিটি পলিসি ডিজেবল করবে যেন সরাসরি ডাটা রিড-রাইট হতে পারে)।</span>
                  </li>
                  <li>
                    কোড রান হওয়া সফল হলে এই পেজে ফিরে এসে নিচে থাকা <strong class="text-indigo-400">"Test Connection"</strong> বাটনে ক্লিক করুন। ব্যাস, আপনার লাইভ ক্লাউড ডাটাবেজ প্রস্তুত!
                  </li>
                </ol>
              </div>
            </div>
          ` : ''}

          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- Left Column: Settings -->
            <div class="lg:col-span-7 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-5">
              <div class="flex items-center gap-2 border-b border-slate-800 pb-3">
                <i data-lucide="settings" class="w-5 h-5 text-indigo-400"></i>
                <h3 class="font-bold text-slate-100 text-sm">ক্রেডেনশিয়ালস কনফিগারেশন (API Settings)</h3>
              </div>
              
              <div class="space-y-4">
                <!-- URL Input -->
                <div class="space-y-1.5">
                  <label class="block text-xs font-semibold text-slate-400 flex justify-between">
                    <span>Supabase URL</span>
                    <button id="toggle-url-visibility-btn" class="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer font-sans">
                      ${urlToggleText}
                    </button>
                  </label>
                  <input type="${urlInputType}" id="supabase-url-input" value="${state.supabaseUrl || ''}" placeholder="https://xxxxxx.supabase.co" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500 font-mono" />
                </div>

                <!-- Key Input -->
                <div class="space-y-1.5">
                  <label class="block text-xs font-semibold text-slate-400 flex justify-between">
                    <span>Supabase Anon Public Key</span>
                    <button id="toggle-key-visibility-btn" class="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer font-sans">
                      ${keyToggleText}
                    </button>
                  </label>
                  <input type="${keyInputType}" id="supabase-key-input" value="${state.supabaseKey || ''}" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-700 focus:outline-none focus:border-indigo-500 font-mono" />
                </div>

                <!-- Sync Toggle -->
                <div class="bg-slate-950 border border-slate-850 p-4 rounded-xl flex items-center justify-between">
                  <div class="space-y-0.5">
                    <h4 class="text-xs font-bold text-slate-200">ব্যাকগ্রাউন্ড অটো-সিংক্রোনাইজেশন</h4>
                    <p class="text-[10px] text-slate-500 leading-normal">ডাটা পরিবর্তন হওয়ার সাথে সাথে স্বয়ংক্রিয়ভাবে ক্লাউডে সেভ হবে।</p>
                  </div>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" id="supabase-autosync-toggle" class="sr-only peer" ${autoSyncChecked} />
                    <div class="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <!-- Action buttons -->
                <div class="flex flex-wrap gap-2.5 pt-2">
                  <button id="save-supabase-config-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-[0_4px_12px_rgba(79,70,229,0.3)]">
                    <i data-lucide="save" class="w-3.5 h-3.5"></i> সেভ করুন
                  </button>
                  <button id="test-connection-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs px-5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5">
                    <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> কানেকশন টেস্ট
                  </button>
                  <button id="clear-supabase-config-btn" class="bg-rose-950/30 hover:bg-rose-900/40 text-rose-400 border border-rose-900/30 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer ml-auto flex items-center gap-1.5">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> ক্রেডেনশিয়ালস মুছুন
                  </button>
                </div>
              </div>
            </div>

            <!-- Right Column: Sync Control -->
            <div class="lg:col-span-5 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-5">
              <div class="flex items-center gap-2 border-b border-slate-800 pb-3">
                <i data-lucide="refresh-cw" class="w-5 h-5 text-indigo-400"></i>
                <h3 class="font-bold text-slate-100 text-sm">ডাটাবেজ সিংক্রোনাইজেশন (Manual Sync)</h3>
              </div>
              
              <p class="text-xs text-slate-400 leading-relaxed">
                নিচের বাটনগুলোর মাধ্যমে আপনি ম্যানুয়ালি ক্লাউড ডাটাবেজে ডাটা আপলোড বা ক্লাউড থেকে ডাটা ব্রাউজারে নামিয়ে নিতে পারেন।
              </p>

              <div class="grid grid-cols-2 gap-3 pt-1">
                <!-- Push Button -->
                <button id="push-supabase-btn" class="bg-gradient-to-br from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs p-4 rounded-xl shadow-lg transition flex flex-col items-center justify-center gap-2 border border-indigo-500/30 cursor-pointer">
                  <i data-lucide="upload-cloud" class="w-6 h-6"></i>
                  <span class="font-bold">Push to Cloud</span>
                  <span class="text-[9px] text-indigo-200 font-medium font-mono">লোকাল ডাটা ক্লাউডে পাঠান</span>
                </button>

                <!-- Pull Button -->
                <button id="pull-supabase-btn" class="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-750 text-slate-200 font-bold text-xs p-4 rounded-xl shadow-md transition flex flex-col items-center justify-center gap-2 cursor-pointer">
                  <i data-lucide="download-cloud" class="w-6 h-6 text-emerald-400"></i>
                  <span class="font-bold">Pull from Cloud</span>
                  <span class="text-[9px] text-slate-500 font-medium font-mono">ক্লাউড ডাটা নামিয়ে আনুন</span>
                </button>
              </div>

              <div class="bg-slate-950/70 border border-slate-850 p-4 rounded-xl space-y-2 text-xs">
                <h4 class="font-bold text-slate-300">লোকাল ডাটাবেজ পরিসংখ্যান:</h4>
                <div class="grid grid-cols-2 gap-y-2 font-mono text-[10px] text-slate-400">
                  <div>👥 Members: <span class="text-white font-bold">${totalMembersCount}</span></div>
                  <div>📝 Activity Logs: <span class="text-white font-bold">${totalLogsCount}</span></div>
                  <div>🏅 Badges: <span class="text-white font-bold">${totalBadgesCount}</span></div>
                  <div>🛡️ Audit Trails: <span class="text-white font-bold">${totalAuditsCount}</span></div>
                </div>
              </div>

              <!-- Danger Zone Section -->
              <div class="bg-rose-950/20 border border-rose-950 rounded-xl p-4 space-y-3">
                <h4 class="font-bold text-rose-400 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                  <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-400 animate-pulse"></i> Danger Zone / ডাটা রিসেট এরিয়া
                </h4>
                <p class="text-[10px] text-slate-400 leading-relaxed">
                  আপনি যদি Supabase ডাটাবেজ বা ব্রাউজার ক্যাশ রিসেট করে একদম নতুনভাবে কাজ শুরু করতে চান, তবে নিচের অপশনগুলো ব্যবহার করুন:
                </p>
                <div class="flex flex-col gap-2 pt-1">
                  <!-- Button 1: Wipe Local Storage Only -->
                  <button id="wipe-local-cache-btn" class="w-full bg-slate-950 hover:bg-slate-900 border border-rose-900/30 hover:border-rose-500/40 text-rose-400 font-bold text-[11px] py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> লোকাল ব্রাউজার ক্যাশ রিসেট (Wipe Local)
                  </button>
                  
                  <!-- Button 2: Wipe Both Local + Supabase -->
                  <button id="wipe-all-sys-btn" class="w-full bg-rose-950/40 hover:bg-rose-900/40 border border-rose-700/50 hover:border-rose-500 text-rose-300 hover:text-white font-bold text-[11px] py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer">
                    <i data-lucide="alert-triangle" class="w-3.5 h-3.5"></i> লোকাল + ক্লাউড ডাটা সম্পূর্ণ মুছুন (Full Wipe)
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Schema Setup Instructions -->
          <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2">
                <i data-lucide="terminal" class="w-5 h-5 text-indigo-400"></i>
                <h3 class="font-bold text-slate-100 text-sm">Supabase Table Schema Setup Script</h3>
              </div>
              <button id="copy-sql-btn" class="text-xs bg-slate-850 hover:bg-slate-800 border border-slate-800 text-indigo-400 hover:text-indigo-300 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition">
                <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                ${copiedSqlText}
              </button>
            </div>
            
            <p class="text-xs text-slate-400 leading-relaxed">
              আপনার Supabase প্রোজেক্টের <strong class="text-slate-200">SQL Editor</strong>-এ গিয়ে নিচের স্ক্রিপ্টটি রান করান। এটি প্রয়োজনীয় ৪টি টেবিল এবং লাইভ সিংক্রোনাইজেশন এনাবেল করার কনফিগারেশন সেট আপ করে দেবে।
            </p>

            <div class="bg-slate-950 rounded-xl p-4 border border-slate-850 overflow-x-auto max-h-60">
              <pre class="text-[10px] font-mono text-emerald-400 leading-relaxed">-- Create Members Table
CREATE TABLE members (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  member_number INT NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  level VARCHAR(50) DEFAULT 'Bronze',
  total_points INT DEFAULT 0,
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  consecutive_inactive_days INT DEFAULT 0,
  total_active_days INT DEFAULT 0,
  last_active_date VARCHAR(50),
  notes TEXT,
  updated_at VARCHAR(255)
);

-- Create Activity Logs Table
CREATE TABLE activity_logs (
  id VARCHAR(255) PRIMARY KEY,
  member_id VARCHAR(255) REFERENCES members(id) ON DELETE CASCADE,
  activity_date VARCHAR(50),
  points_added INT DEFAULT 0,
  submitted_by VARCHAR(255),
  link VARCHAR(1000),
  status VARCHAR(50) DEFAULT 'pending',
  timestamp VARCHAR(255)
);

-- Create Badges Table
CREATE TABLE badges (
  id VARCHAR(255) PRIMARY KEY,
  member_id VARCHAR(255) REFERENCES members(id) ON DELETE CASCADE,
  badge_name VARCHAR(255),
  description TEXT,
  earned_date VARCHAR(50)
);

-- Create Audit Trails Table
CREATE TABLE audit_trails (
  id VARCHAR(255) PRIMARY KEY,
  admin_email VARCHAR(255),
  admin_name VARCHAR(255),
  action VARCHAR(255),
  entity_type VARCHAR(255),
  description TEXT,
  timestamp VARCHAR(255)
);

-- Enable Realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE members;
ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE badges;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_trails;

-- Disable Row Level Security (RLS) on all tables to allow direct reads/writes
ALTER TABLE members DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE badges DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trails DISABLE ROW LEVEL SECURITY;
              </pre>
            </div>
          </div>

          <!-- JavaScript/React Connection Snippet -->
          <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2">
                <i data-lucide="code" class="w-5 h-5 text-indigo-400"></i>
                <h3 class="font-bold text-slate-100 text-sm">React/JS Connection Code Snippet</h3>
              </div>
              <button id="copy-js-btn" class="text-xs bg-slate-850 hover:bg-slate-800 border border-slate-800 text-indigo-400 hover:text-indigo-300 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition">
                <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                ${copiedJsText}
              </button>
            </div>
            
            <p class="text-xs text-slate-400 leading-relaxed">
              আপনার কোডে Supabase ক্লায়েন্ট ইনিশিয়ালাইজ করার জন্য নিচের কোড রেফারেন্সটি ব্যবহার করতে পারেন।
            </p>

            <div class="bg-slate-950 rounded-xl p-4 border border-slate-850 overflow-x-auto max-h-40">
              <pre class="text-[10px] font-mono text-indigo-300 leading-relaxed">import { createClient } from '@supabase/supabase-js'

const supabaseUrl = '${state.supabaseUrl || 'https://your-project.supabase.co'}'
const supabaseKey = '${state.supabaseKey || 'your-anon-public-key'}'
export const supabase = createClient(supabaseUrl, supabaseKey)
              </pre>
            </div>
          </div>
        </div>
      `;
    }

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
        
        if (state.memberFilterStatus === 'frozen') {
          return matchesQuery && m.status === 'frozen';
        }

        // Hide frozen members from all other views
        if (m.status === 'frozen') return false;
        
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
                { id: 'frozen', label: '❄️ Frozen' },
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
                      <div class="cursor-pointer group/name" data-open-profile="${m.id}" title="Click to view Member Profile & History">
                        <p class="font-bold text-slate-200 text-xs sm:text-sm group-hover/name:text-indigo-400 transition flex items-center gap-1.5">${m.name} <i data-lucide="user" class="w-3 h-3 text-indigo-400 opacity-0 group-hover/name:opacity-100 transition"></i></p>
                        <p class="text-[10px] text-indigo-400 mt-0.5">${m.display_name}</p>
                      </div>
                    </td>
                    <td class="py-3 px-5 text-center">
                      <span class="inline-block text-[9px] font-bold uppercase px-2 py-0.5 rounded ${
                        m.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' :
                        m.status === 'warning' ? 'bg-amber-500/10 text-amber-400' :
                        m.status === 'frozen' ? 'bg-blue-500/10 text-blue-400' :
                        'bg-rose-500/10 text-rose-400'
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
      const processed = state.processedBulkResult;
      const matchedMembers = processed ? processed.matchedMembers : [];
      const unregisteredNames = processed ? processed.unregisteredNames : [];
      const parsedNames = processed ? processed.parsedNames : [];

      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- Left box: main activity tracker text inputs -->
          <div class="lg:col-span-6 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2.5">
                <i data-lucide="clipboard-list" class="w-5 h-5 text-indigo-400"></i>
                <h3 class="font-bold text-slate-100 text-base">Daily Link Submission Tracker</h3>
              </div>
              <div class="flex items-center gap-2">
                <input id="bulk-input-date" type="date" value="${state.bulkInputDate}" class="bg-slate-950 border border-slate-800 text-xs px-3 py-1.5 rounded-xl text-slate-300 font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer" />
                <button id="clear-bulk-textarea-btn" class="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-xl font-bold transition cursor-pointer" title="Clear text">
                  Clear
                </button>
              </div>
            </div>

            <p class="text-xs text-slate-400 leading-relaxed font-sans">
              Facebook Messenger গ্রুপ বা পোস্ট থেকে ২০০–৩০০+ মেম্বারের লিংক সাবমিশন টেক্সট এখানে নির্দ্বিধায় পেস্ট করুন। পেস্ট করার সময় কোনো অটো-প্রসেসিং চলবে না, তাই মোবাইল স্ক্রিন একদম হ্যাং বা ফ্রিজ হবে না।
            </p>

            <textarea id="bulk-activity-textarea" rows="11" placeholder="Paste 200–300 names or link list here...&#10;&#10;Example:&#10;1. @Rahi Ahmed Rabiul&#10;2. @Orithra Mazumder&#10;3. @Ahmed Sopon" class="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 placeholder-slate-700 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed resize-y">${state.bulkInputText || ''}</textarea>

            <div class="space-y-2">
              <button id="process-bulk-list-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs py-3.5 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer">
                <i data-lucide="play-circle" class="w-4 h-4"></i>
                ⚙️ Process List
              </button>
              
              ${processed ? `
                <button id="open-preview-from-processed-btn" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer animate-fade-in">
                  <i data-lucide="check-circle" class="w-4 h-4"></i>
                  Review & Confirm Submission (${matchedMembers.length} Active Identified)
                </button>
              ` : ''}
            </div>

            ${state.lastSubmissionSnapshot ? (() => {
              const elapsed = Date.now() - new Date(state.lastSubmissionSnapshot.timestamp).getTime();
              const remaining = Math.max(0, 5 * 60 * 1000 - elapsed);
              const mins = Math.floor(remaining / 60000);
              const secs = Math.floor((remaining % 60000) / 1000);
              const countdownText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
              
              return `
                <div class="bg-rose-950/20 border border-rose-500/20 rounded-xl p-4 space-y-3 mt-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
                      <span class="text-xs font-bold text-slate-100">Undo Last Submission Available</span>
                    </div>
                    <span id="undo-countdown" class="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">${countdownText}</span>
                  </div>
                  <p class="text-[10px] text-slate-400 leading-relaxed font-semibold">
                    ${state.lastSubmissionSnapshot.submissionDate} তারিখের সাবমিশন করা হয়েছে। ৫ মিনিটের মধ্যে রোলব্যাক করা যাবে।
                  </p>
                  <button id="undo-last-submission-btn" class="w-full bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800 hover:border-rose-700 font-extrabold text-[10px] py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                    <i data-lucide="undo" class="w-3.5 h-3.5"></i>
                    Undo Last Submission (Rollback)
                  </button>
                </div>
              `;
            })() : ''}
          </div>

          <!-- Right column: processing output and workflow status -->
          <div class="lg:col-span-6 flex flex-col gap-6">
            
            ${!processed ? `
              <!-- Empty state / instructions guide -->
              <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-5">
                <div class="border-b border-slate-800 pb-3">
                  <h4 class="font-bold text-slate-100 text-sm uppercase tracking-wider flex items-center gap-2">
                    <i data-lucide="info" class="w-4 h-4 text-indigo-400"></i>
                    Daily Submission Workflow Guide
                  </h4>
                  <p class="text-xs text-slate-400 mt-1">
                    মোবাইলের সর্বোচ্চ পারফরম্যান্স নিশ্চিত করতে ৪-ধাপের নিরাপদ সাবমিশন পদ্ধতি:
                  </p>
                </div>

                <div class="space-y-3.5 text-xs text-slate-300">
                  <div class="flex items-start gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-850">
                    <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold font-mono text-xs shrink-0">1</span>
                    <div>
                      <p class="font-bold text-slate-200">Paste raw member link list</p>
                      <p class="text-[11px] text-slate-500 mt-0.5">বামে টেক্সট বক্সে লিংক লিস্ট পেস্ট করুন। পেস্টের সময় কোনো হ্যাং বা ল্যাগ হবে না।</p>
                    </div>
                  </div>

                  <div class="flex items-start gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-850">
                    <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold font-mono text-xs shrink-0">2</span>
                    <div>
                      <p class="font-bold text-slate-200">Click "⚙️ Process List"</p>
                      <p class="text-[11px] text-slate-500 mt-0.5">বাটন চাপার পর সিস্টেম নাম ফিল্টার, ডুপ্লিকেট চেকিং ও মেম্বার ম্যাচিং সম্পন্ন করবে।</p>
                    </div>
                  </div>

                  <div class="flex items-start gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-850">
                    <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold font-mono text-xs shrink-0">3</span>
                    <div>
                      <p class="font-bold text-slate-200">Review & Resolve</p>
                      <p class="text-[11px] text-slate-500 mt-0.5">ডুপ্লিকেট বা অনিবন্ধিত নাম থাকলে পপআপে দ্রুত রিনেম বা অ্যাড করার সুযোগ পাবেন।</p>
                    </div>
                  </div>

                  <div class="flex items-start gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-850">
                    <span class="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold font-mono text-xs shrink-0">4</span>
                    <div>
                      <p class="font-bold text-slate-200">Confirm & Auto-Recalculate</p>
                      <p class="text-[11px] text-slate-500 mt-0.5">সাবমিট করার সাথে সাথে অ্যাক্টিভ/ইনঅ্যাক্টিভ কাউন্ট, স্ট্রিক ও লিডারবোর্ড রিফ্রেশ হবে।</p>
                    </div>
                  </div>
                </div>

                <div class="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-3.5 flex items-center justify-between text-xs font-mono">
                  <span class="text-slate-400">Database Status:</span>
                  <span class="text-indigo-400 font-bold">${state.members.length} Registered Members</span>
                </div>
              </div>
            ` : `
              <!-- Panel 1: Matched Registered Members List -->
              <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex-grow flex flex-col justify-between min-h-[280px]">
                <div>
                  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-3 mb-3">
                    <h4 class="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>
                      Identified Active Members (${matchedMembers.length})
                    </h4>
                    <span class="text-[10px] text-indigo-400 font-mono font-bold bg-indigo-500/10 px-2 py-0.5 rounded">Click name to view profile</span>
                  </div>

                  <div class="max-h-64 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-850/40 font-mono text-[10px]">
                    ${matchedMembers.length > 0 ? matchedMembers.map(m => `
                      <div class="flex justify-between items-center py-2 px-2 hover:bg-slate-950/40 rounded-lg transition-colors">
                        <div class="flex items-center gap-2 cursor-pointer group/item" data-open-profile="${m.id}" title="Click to view Member Profile">
                          <span class="text-slate-100 font-semibold group-hover/item:text-indigo-400 transition">${m.name}</span>
                          <span class="text-slate-500 font-bold">No.${m.member_number}</span>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="px-1.5 py-0.5 rounded text-[8px] font-bold ${
                            m.level === 'Diamond' ? 'bg-cyan-500/10 text-cyan-400' :
                            m.level === 'Gold' ? 'bg-amber-500/10 text-amber-400' :
                            m.level === 'Silver' ? 'bg-slate-300/10 text-slate-300' :
                            'bg-amber-700/10 text-amber-600'
                          }">${m.level}</span>
                          <button data-open-profile="${m.id}" class="text-[9px] bg-slate-850 hover:bg-indigo-600 hover:text-white text-slate-400 px-1.5 py-0.5 rounded transition cursor-pointer font-bold">Profile</button>
                        </div>
                      </div>
                    `).join('') : `
                      <p class="text-[11px] text-slate-600 italic py-8 text-center">কোনো নিবন্ধিত মেম্বার সনাক্ত হয়নি।</p>
                    `}
                  </div>
                </div>

                <div class="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-3 flex gap-2 items-start mt-4">
                  <i data-lucide="award" class="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5"></i>
                  <p class="text-[10px] text-slate-400 leading-relaxed font-sans">
                    <strong class="text-indigo-400">Streak & Point Increment:</strong> সাবমিট করলে সনাক্ত হওয়া মেম্বাররা <span class="font-bold font-mono text-indigo-400">+10 Points</span> পাবে এবং তাদের স্ট্রিক ১ বাড়বে।
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
                <p class="text-[10px] text-slate-400 mb-3 font-sans">এই নামগুলো মেনশন ছিল কিন্তু বর্তমানে রেজিস্টার্ড নয়। চাইলে এদের এক ক্লিকে রেজিস্টার করতে পারেন:</p>
                
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
                    <p class="text-[11px] text-slate-600 italic py-4 text-center font-sans">কোনো অনিবন্ধিত নাম পাওয়া যায়নি।</p>
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
            `}

          </div>
        </div>
      `;
    }

    // TAB: NOTICE GENERATOR
    case 'notices': {
      // Inactive members query calculations (Excluding frozen members)
      let warningMembers = state.members.filter(m => m.status !== 'frozen');
      if (state.noticeFilterMode === 'exact') {
        warningMembers = warningMembers.filter(m => m.consecutive_inactive_days === state.noticeFilterDays);
      } else if (state.noticeFilterMode === 'less') {
        warningMembers = warningMembers.filter(m => m.consecutive_inactive_days < state.noticeFilterDays);
      } else {
        warningMembers = warningMembers.filter(m => m.consecutive_inactive_days >= state.noticeFilterDays);
      }
      
      const formatWarningNotice = () => {
        const dateStr = new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
        
        let listText = '';
        if (warningMembers.length > 0) {
          // Group members by consecutive_inactive_days
          const groups = {};
          warningMembers.forEach(m => {
            const days = m.consecutive_inactive_days;
            if (!groups[days]) {
              groups[days] = [];
            }
            groups[days].push(m);
          });

          // Sort keys of group (days) ascending
          const sortedDays = Object.keys(groups).map(Number).sort((a, b) => a - b);

          let globalIdx = 0;
          const groupTexts = sortedDays.map(days => {
            const membersInGroup = groups[days];
            const groupEmoji = days < 5 ? '🟢' : days < 7 ? '🟡' : days < 10 ? '🟠' : '🔴';
            
            // Format group headline: 📌 🟢 ৩ দিন Inactive (১২ জন)
            const daysBn = toBanglaNumber(days);
            const countBn = toBanglaNumber(membersInGroup.length);
            const headline = `📌 ${groupEmoji} ${daysBn} দিন Inactive (${countBn} জন)`;
            
            // Format members under this group
            const memberLines = membersInGroup.map(m => {
              globalIdx++;
              const emojiNum = getEmojiNumber(globalIdx);
              return `${emojiNum}➤ ${m.name}`;
            }).join('\n');
            
            return `${headline}\n${memberLines}`;
          });
          listText = groupTexts.join('\n\n');
        } else {
          listText = '😴 বর্তমানে এই ফিল্টারে কোনো নিষ্ক্রিয় মেম্বার নেই!';
        }

        if (state.noticeType === 'alert') {
          return `⚠️ গ্রুপ ওয়ার্নিং নোটিশ (Alert Warning) ⚠️

আসসালামু আলাইকুম। যারা দীর্ঘ দিন ধরে গ্রুপে নিষ্ক্রিয় (Inactive) রয়েছেন এবং গ্রুপ লিংক সাপোর্ট দিচ্ছেন না, তাদের একটি চূড়ান্ত সতর্কবার্তা দেওয়া হচ্ছে।

আগামী ২৪ ঘণ্টার মধ্যে গ্রুপে সচল বা এক্টিভ না হলে অথবা কোনো উপযুক্ত কারণ ছাড়া সাপোর্ট না দিলে, নিয়ম অনুযায়ী আপনাকে গ্রুপ থেকে রিমুভ (Kick) করা হবে। কোনো সমস্যা থাকলে দয়া করে দ্রুত এডমিনের সাথে যোগাযোগ করুন।

😴 Inactive Members 👇
〰〰〰〰〰〰〰〰〰〰

${listText}
〰〰〰〰〰〰〰〰〰〰
📅 তারিখ: ${dateStr}

✍️ Support Link Box Admin Team`;
        } else if (state.noticeType === 'kickout') {
          return `🚫 গ্রুপ রিমুভ নোটিশ (Remove Notice) 🚫

আসসালামু আলাইকুম। অত্যন্ত দুঃখের সাথে জানানো যাচ্ছে যে, দীর্ঘ দিন ধরে গ্রুপে সম্পূর্ণ নিষ্ক্রিয় (Inactive) থাকার কারণে এবং নিয়ম মেনে সাপোর্ট না দেওয়ায় নিচের মেম্বারদের গ্রুপ থেকে রিমুভ (Kick) করা হয়েছে।

ভবিষ্যতে যদি আপনারা আবারো গ্রুপে যোগ দিতে চান, তবে দয়া করে এডমিন প্যানেলের সাথে যোগাযোগ করুন। পুনরায় গ্রুপে যোগদানের পর অবশ্যই নিয়মিত এক্টিভ থাকার অনুরোধ থাকবে।

😴 Removed Members 👇
〰〰〰〰〰〰〰〰〰〰

${listText}
〰〰〰〰〰〰〰〰〰〰
📅 তারিখ: ${dateStr}

✍️ Support Link Box Admin Team`;
        } else {
          // Default: simple warning
          return `👋 গ্রুপ ওয়ার্নিং নোটিশ (Simple Warning) 👋

আসসালামু আলাইকুম। আমাদের গ্রুপের সম্মানিত মেম্বারদের অবগতির জন্য জানানো যাচ্ছে যে, আপনারা অনেকেই কয়েকদিন ধরে গ্রুপে নিষ্ক্রিয় (Inactive) রয়েছেন এবং গ্রুপ লিংক সাপোর্ট দিচ্ছেন না।

গ্রুপের প্রাণ হচ্ছে মেম্বারদের এক্টিভ অংশগ্রহণ। তাই আপনাদের সবাইকে গ্রুপে পুনরায় সচল ও এক্টিভ হওয়ার জন্য বিনীত অনুরোধ জানানো হচ্ছে। আসুন, সবাই একসাথে আমাদের গ্রুপকে আরও প্রাণবন্ত করে তুলি!

😴 Inactive Members 👇
〰〰〰〰〰〰〰〰〰〰

${listText}
〰〰〰〰〰〰〰〰〰〰
📅 তারিখ: ${dateStr}

✍️ Support Link Box Admin Team`;
        }
      };

      let dynamicLabel = '';
      if (state.noticeFilterMode === 'exact') {
        dynamicLabel = `ঠিক ${toBanglaNumber(state.noticeFilterDays)} দিন`;
      } else if (state.noticeFilterMode === 'less') {
        dynamicLabel = `${toBanglaNumber(state.noticeFilterDays)} দিনের কম`;
      } else {
        dynamicLabel = `${toBanglaNumber(state.noticeFilterDays)} দিন বা তার বেশি`;
      }

      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- Configuration Column -->
          <div class="lg:col-span-5 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-5">
            <div class="flex items-center gap-2 border-b border-slate-800 pb-3">
              <i data-lucide="megaphone" class="w-5 h-5 text-indigo-400"></i>
              <h3 class="font-bold text-slate-100 text-lg">Notice Maker & Generator</h3>
            </div>

            <p class="text-xs text-slate-400 leading-relaxed font-sans">
              নিষ্ক্রিয় মেম্বারদের জন্য ৩টি ভিন্ন গুরুত্বের ওয়ার্নিং লেভেল সিলেক্ট করুন এবং কাস্টম ফিল্টার দিন ব্যবহার করে নোটিশ জেনারেট করুন।
            </p>

            <!-- Notice Level Selector -->
            <div class="space-y-3 pt-1">
              <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider font-sans">Notice Level (নোটিশ লেভেল)</label>
              <div class="grid grid-cols-1 gap-2.5">
                <label class="flex items-start gap-3 p-3 bg-slate-950/40 border ${state.noticeType === 'simple' ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition cursor-pointer select-none">
                  <input type="radio" name="notice-type-radio" value="simple" ${state.noticeType === 'simple' ? 'checked' : ''} class="mt-1 w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 focus:ring-indigo-500 cursor-pointer" />
                  <div>
                    <span class="block text-xs font-bold text-slate-200">Level 1 — Simple Warning</span>
                    <span class="block text-[10px] text-slate-400 mt-0.5">এক্টিভ হওয়ার আহ্বান (বিনীত অনুরোধ)</span>
                  </div>
                </label>
                <label class="flex items-start gap-3 p-3 bg-slate-950/40 border ${state.noticeType === 'alert' ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition cursor-pointer select-none">
                  <input type="radio" name="notice-type-radio" value="alert" ${state.noticeType === 'alert' ? 'checked' : ''} class="mt-1 w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 focus:ring-indigo-500 cursor-pointer" />
                  <div>
                    <span class="block text-xs font-bold text-slate-200">Level 2 — Alert Warning</span>
                    <span class="block text-[10px] text-slate-400 mt-0.5">চূড়ান্ত সতর্কতা (নির্দিষ্ট সময়ে সচল হওয়ার তাগিদ)</span>
                  </div>
                </label>
                <label class="flex items-start gap-3 p-3 bg-slate-950/40 border ${state.noticeType === 'kickout' ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition cursor-pointer select-none">
                  <input type="radio" name="notice-type-radio" value="kickout" ${state.noticeType === 'kickout' ? 'checked' : ''} class="mt-1 w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 focus:ring-indigo-500 cursor-pointer" />
                  <div>
                    <span class="block text-xs font-bold text-slate-200">Level 3 — Kickout Warning</span>
                    <span class="block text-[10px] text-slate-400 mt-0.5">Remove Notice (গ্রুপ থেকে রিমুভ করা হয়েছে)</span>
                  </div>
                </label>
              </div>
            </div>

            <!-- Filter Selection -->
            <div class="space-y-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1.5 flex justify-between font-sans">
                  <span>Inactivity Days (নিষ্ক্রিয় দিন)</span>
                  <span class="text-indigo-400 font-bold">${dynamicLabel}</span>
                </label>
                <select id="notice-filter-days" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 cursor-pointer focus:outline-none focus:border-indigo-500">
                  <option value="3" ${state.noticeFilterDays === 3 ? 'selected' : ''}>৩ দিন (3 Days)</option>
                  <option value="5" ${state.noticeFilterDays === 5 ? 'selected' : ''}>৫ দিন (5 Days)</option>
                  <option value="7" ${state.noticeFilterDays === 7 ? 'selected' : ''}>৭ দিন (7 Days)</option>
                  <option value="15" ${state.noticeFilterDays === 15 ? 'selected' : ''}>১৫ দিন (15 Days)</option>
                  <option value="custom" ${![3, 5, 7, 15].includes(state.noticeFilterDays) ? 'selected' : ''}>Custom Threshold (কাস্টম দিন)</option>
                </select>
              </div>

              ${![3, 5, 7, 15].includes(state.noticeFilterDays) ? `
                <div class="pt-1.5 border-t border-slate-900">
                  <label class="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider font-sans">Enter Custom Inactive Days (কাস্টম দিন)</label>
                  <input type="number" id="notice-custom-days" min="1" max="180" value="${state.noticeFilterDays}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
                </div>
              ` : ''}

              <!-- Filter Mode Selection -->
              <div class="pt-2.5 border-t border-slate-900">
                <label class="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider font-sans">Filter Mode (ফিল্টার মোড)</label>
                <div class="grid grid-cols-1 gap-2">
                  <label class="flex items-center gap-2.5 p-2 bg-slate-900/60 border ${state.noticeFilterMode === 'exact' ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition cursor-pointer select-none">
                    <input type="radio" name="notice-filter-mode" value="exact" ${state.noticeFilterMode === 'exact' ? 'checked' : ''} class="w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 focus:ring-indigo-500 cursor-pointer" />
                    <div class="text-[11px]">
                      <span class="block font-bold text-slate-200">Exactly ${state.noticeFilterDays} Days</span>
                      <span class="block text-[9px] text-slate-400">শুধুমাত্র ঠিক ${toBanglaNumber(state.noticeFilterDays)} দিন নিষ্ক্রিয়</span>
                    </div>
                  </label>

                  <label class="flex items-center gap-2.5 p-2 bg-slate-900/60 border ${state.noticeFilterMode === 'less' ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition cursor-pointer select-none">
                    <input type="radio" name="notice-filter-mode" value="less" ${state.noticeFilterMode === 'less' ? 'checked' : ''} class="w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 focus:ring-indigo-500 cursor-pointer" />
                    <div class="text-[11px]">
                      <span class="block font-bold text-slate-200">Less Than ${state.noticeFilterDays} Days</span>
                      <span class="block text-[9px] text-slate-400">${toBanglaNumber(state.noticeFilterDays)} দিনের কম নিষ্ক্রিয়</span>
                    </div>
                  </label>

                  <label class="flex items-center gap-2.5 p-2 bg-slate-900/60 border ${state.noticeFilterMode === 'above' ? 'border-indigo-500 bg-indigo-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition cursor-pointer select-none">
                    <input type="radio" name="notice-filter-mode" value="above" ${state.noticeFilterMode === 'above' ? 'checked' : ''} class="w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 focus:ring-indigo-500 cursor-pointer" />
                    <div class="text-[11px]">
                      <span class="block font-bold text-slate-200">${state.noticeFilterDays} Days & Above</span>
                      <span class="block text-[9px] text-slate-400">${toBanglaNumber(state.noticeFilterDays)} দিন বা তার বেশি নিষ্ক্রিয়</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <button id="copy-notice-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3.5 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer">
              <i data-lucide="clipboard" class="w-4 h-4"></i>
              ${state.copiedNotice ? 'Notice Copied!' : 'Generate & Copy Notice'}
            </button>
          </div>

          <!-- Notice Content Box & Freeze Panel stacked -->
          <div class="lg:col-span-7 space-y-6">
            <!-- Notice Output -->
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
              <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                <span class="text-xs font-bold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider font-sans">
                  <i data-lucide="calendar" class="w-3.5 h-3.5 text-indigo-400"></i> Notice Output (${state.noticeType.toUpperCase()})
                </span>
                <span class="text-[10px] text-slate-500 font-bold font-mono uppercase">${warningMembers.length} Inactive Found</span>
              </div>

              <div class="bg-slate-950 rounded-xl p-4 border border-slate-800 max-h-[250px] overflow-y-auto font-mono text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed select-all">
                ${formatWarningNotice()}
              </div>

              <div class="bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-3 flex gap-2 items-start">
                <i data-lucide="alert-triangle" class="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5"></i>
                <p class="text-[10px] text-slate-500 leading-relaxed font-sans">
                  <strong class="text-indigo-400">গুরুত্বপূর্ণ ফিক্স:</strong> নোটিশে মেম্বারদের নামের পাশে তাদের সঠিক ইনেক্টিভ দিনসমূহ নির্ভুলভাবে প্রদর্শন করা হয়েছে। এটি ডুপ্লিকেট এন্ট্রি দূর করেছে।
                </p>
              </div>
            </div>

            <!-- Freeze Members Panel -->
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
              <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                <h4 class="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-1.5 font-sans">
                  <i data-lucide="snowflake" class="w-4 h-4 text-rose-400"></i>
                  নিষ্ক্রিয় মেম্বার ফ্রিজ করুন (Freeze Members)
                </h4>
                <span class="text-[9px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded font-black uppercase font-mono">Select & Freeze</span>
              </div>

              <p class="text-xs text-slate-400 leading-relaxed font-sans">
                আপনি যে মেম্বারদের ফেসবুক গ্রুপ থেকে রিমুভ (Kick) করেছেন, তাদের নামের পাশের বক্সে টিক দিন এবং নিচের <b>Freeze Selected</b> বাটনে ক্লিক করুন। ফ্রোজেন মেম্বাররা কোনো নোটিশ, লিডারবোর্ড বা ডিরেক্টরিতে আর অন্তর্ভুক্ত হবে না।
              </p>

              ${warningMembers.length > 0 ? `
                <div class="flex items-center gap-2.5 pb-1">
                  <button id="freeze-select-all-btn" class="text-[10px] font-black uppercase tracking-wider px-3.5 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded-xl flex items-center gap-1.5 transition cursor-pointer select-none">
                    <i data-lucide="check-square" class="w-3.5 h-3.5"></i> Select All
                  </button>
                  <button id="freeze-unselect-all-btn" class="text-[10px] font-black uppercase tracking-wider px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl flex items-center gap-1.5 transition cursor-pointer select-none">
                    <i data-lucide="square" class="w-3.5 h-3.5"></i> Unselect All
                  </button>
                </div>
              ` : ''}

              <div class="max-h-[200px] overflow-y-auto space-y-2 pr-1 font-mono text-xs">
                ${warningMembers.length > 0 ? warningMembers.map(m => {
                  const isChecked = (state.selectedFreezeMemberIds || []).includes(m.id);
                  return `
                    <div class="flex items-center justify-between p-2.5 bg-slate-950/50 border ${isChecked ? 'border-rose-500/35 bg-rose-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition select-none">
                      <div class="flex items-center gap-3">
                        <input type="checkbox" data-freeze-member-id="${m.id}" ${isChecked ? 'checked' : ''} class="w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 rounded focus:ring-indigo-500 cursor-pointer" />
                        <div class="cursor-pointer group/name flex items-center gap-1.5" data-open-profile="${m.id}" title="Click to view Member Profile">
                          <span class="text-slate-200 font-bold font-sans group-hover/name:text-indigo-400 transition">${m.name}</span>
                          <span class="text-[10px] text-slate-500 font-mono">No.${m.member_number}</span>
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-rose-400 font-bold bg-rose-500/5 px-2 py-0.5 rounded border border-rose-500/10">${m.consecutive_inactive_days} দিন ইনেক্টিভ</span>
                        <button data-open-profile="${m.id}" class="text-[9px] bg-slate-850 hover:bg-indigo-600 hover:text-white text-slate-400 px-2 py-1 rounded-lg transition cursor-pointer font-bold font-sans">Profile</button>
                      </div>
                    </div>
                  `;
                }).join('') : `
                  <p class="text-xs text-slate-600 text-center py-6 font-sans">কোনো নিষ্ক্রিয় মেম্বার নেই।</p>
                `}
              </div>

              ${warningMembers.length > 0 ? `
                <div class="flex justify-between items-center pt-2">
                  <span class="text-[10px] text-slate-500 font-bold uppercase font-mono" id="freeze-selected-count">${(state.selectedFreezeMemberIds || []).length} Selected</span>
                  <button id="freeze-selected-btn" ${state.selectedFreezeMemberIds.length === 0 ? 'disabled' : ''} class="bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs px-5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-[0_4px_12px_rgba(244,63,94,0.2)]">
                    <i data-lucide="snowflake" class="w-4 h-4"></i>
                    Freeze Selected (${state.selectedFreezeMemberIds.length})
                  </button>
                </div>
              ` : ''}
            </div>
          </div>

        </div>
      `;
    }

    // TAB: LEADERBOARDS
    case 'leaderboards': {
      // Filter list for stats search (excluding frozen members)
      const rawSearch = (state.leaderboardSearchQuery || '').trim().toLowerCase().replace(/^#/, '');
      const filteredForStats = state.members.filter(m => 
        m.status !== 'frozen' && (!rawSearch ? true : (
          (m.name && m.name.toLowerCase().includes(rawSearch)) || 
          (m.display_name && m.display_name.toLowerCase().includes(rawSearch)) ||
          (m.member_number !== undefined && m.member_number !== null && m.member_number.toString().includes(rawSearch))
        ))
      );

      const activeList = [...filteredForStats]
        .filter(m => m.total_points >= state.leaderboardActiveThreshold)
        .sort((a, b) => b.total_points - a.total_points || b.current_streak - a.current_streak || (a.member_number || 0) - (b.member_number || 0));

      const inactiveList = [...filteredForStats]
        .filter(m => m.consecutive_inactive_days >= state.leaderboardInactiveThreshold)
        .sort((a, b) => b.consecutive_inactive_days - a.consecutive_inactive_days || (a.member_number || 0) - (b.member_number || 0));

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

          <!-- Top Stat Summary Cards with 3D Glossy Edge & Glow -->
          <div class="overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 relative z-10">
            <div class="flex sm:grid sm:grid-cols-4 gap-3.5 min-w-[620px] sm:min-w-0 pb-2">
              
              <!-- Total Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950 border-t border-indigo-400/30 border-x border-b border-indigo-500/15 p-4 rounded-2xl relative overflow-hidden group hover:-translate-y-1 hover:border-indigo-500/40 transition-all duration-300 shadow-[0_8px_25px_-5px_rgba(0,0,0,0.5),0_0_15px_rgba(99,102,241,0.1)]">
                <div class="absolute -right-4 -bottom-4 w-20 h-20 bg-indigo-500/10 rounded-full blur-xl group-hover:bg-indigo-500/20 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">মোট মেম্বার</span>
                  <span class="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_8px_#818cf8]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-white tracking-tight font-mono">${totalCount}</span>
                    <span class="text-[9px] text-indigo-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center text-indigo-400 border border-indigo-500/30 shadow-inner">
                    <i data-lucide="users" class="w-4 h-4"></i>
                  </div>
                </div>
              </div>

              <!-- Active Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950 border-t border-emerald-400/30 border-x border-b border-emerald-500/15 p-4 rounded-2xl relative overflow-hidden group hover:-translate-y-1 hover:border-emerald-500/40 transition-all duration-300 shadow-[0_8px_25px_-5px_rgba(0,0,0,0.5),0_0_15px_rgba(16,185,129,0.1)]">
                <div class="absolute -right-4 -bottom-4 w-20 h-20 bg-emerald-500/10 rounded-full blur-xl group-hover:bg-emerald-500/20 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">সক্রিয় মেম্বার</span>
                  <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-emerald-400 tracking-tight font-mono">${activeCount}</span>
                    <span class="text-[9px] text-emerald-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 border border-emerald-500/30 shadow-inner">
                    <i data-lucide="shield-check" class="w-4 h-4"></i>
                  </div>
                </div>
              </div>

              <!-- Inactive Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950 border-t border-rose-400/30 border-x border-b border-rose-500/15 p-4 rounded-2xl relative overflow-hidden group hover:-translate-y-1 hover:border-rose-500/40 transition-all duration-300 shadow-[0_8px_25px_-5px_rgba(0,0,0,0.5),0_0_15px_rgba(244,63,94,0.1)]">
                <div class="absolute -right-4 -bottom-4 w-20 h-20 bg-rose-500/10 rounded-full blur-xl group-hover:bg-rose-500/20 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">নিষ্ক্রিয় মেম্বার</span>
                  <span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse shadow-[0_0_8px_#f43f5e]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-rose-400 tracking-tight font-mono">${inactiveCount}</span>
                    <span class="text-[9px] text-rose-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-400 border border-rose-500/30 shadow-inner">
                    <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                  </div>
                </div>
              </div>

              <!-- Diamond Members Card -->
              <div class="flex-1 min-w-[145px] bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950 border-t border-cyan-400/30 border-x border-b border-cyan-500/15 p-4 rounded-2xl relative overflow-hidden group hover:-translate-y-1 hover:border-cyan-500/40 transition-all duration-300 shadow-[0_8px_25px_-5px_rgba(0,0,0,0.5),0_0_15px_rgba(34,211,238,0.1)]">
                <div class="absolute -right-4 -bottom-4 w-20 h-20 bg-cyan-500/10 rounded-full blur-xl group-hover:bg-cyan-500/20 transition duration-300 pointer-events-none"></div>
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">ডায়মন্ড মেম্বার</span>
                  <span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]"></span>
                </div>
                <div class="mt-3 flex items-center justify-between">
                  <div class="flex items-baseline gap-1">
                    <span class="text-2xl sm:text-3xl font-black text-cyan-400 tracking-tight font-mono">${diamondCount}</span>
                    <span class="text-[9px] text-cyan-400/80 font-bold">জন</span>
                  </div>
                  <div class="w-8 h-8 rounded-xl bg-cyan-500/15 flex items-center justify-center text-cyan-400 border border-cyan-500/30 shadow-inner">
                    <i data-lucide="gem" class="w-4 h-4"></i>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            <!-- Left: 3D Active Champions Leaderboard -->
            <div class="bg-gradient-to-b from-slate-900/95 to-slate-950 border border-slate-800 p-5 sm:p-6 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden space-y-5">
              
              <!-- Ambient Spotlight Aura -->
              <div class="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-36 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none"></div>

              <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-800/80 pb-4 gap-2 relative z-10">
                <div class="flex items-center gap-2.5">
                  <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/30 shadow-md">
                    <i data-lucide="flame" class="w-5 h-5 text-amber-400 animate-pulse"></i>
                  </div>
                  <div>
                    <h3 class="font-black text-slate-100 text-sm tracking-wide uppercase flex items-center gap-1.5">
                      ১. সক্রিয় মেম্বার লিডারবোর্ড (Active 3D Podium)
                    </h3>
                    <p class="text-[10px] text-slate-400 font-medium">সবচেয়ে বেশি ধারাবাহিক ও পয়েন্ট অর্জনকারী মেম্বারগণ</p>
                  </div>
                </div>

                <div>
                  <select id="leaderboard-active-filter" class="bg-slate-950/80 border border-slate-800 text-[11px] text-indigo-300 px-3 py-1.5 rounded-xl focus:outline-none focus:border-indigo-500 cursor-pointer font-bold shadow-sm">
                    <option value="1" ${state.leaderboardActiveThreshold === 1 ? 'selected' : ''}>১+ পয়েন্ট বা তার বেশি</option>
                    <option value="100" ${state.leaderboardActiveThreshold === 100 ? 'selected' : ''}>১০০+ (Silver Tier)</option>
                    <option value="300" ${state.leaderboardActiveThreshold === 300 ? 'selected' : ''}>৩০০+ (Gold Tier)</option>
                    <option value="500" ${state.leaderboardActiveThreshold === 500 ? 'selected' : ''}>৫০০+ (Diamond Level)</option>
                  </select>
                </div>
              </div>

              <!-- 3D Stadium Championship Podium for Active Members -->
              <div class="podium-3d-container pt-3 pb-6 relative z-10">
                
                <!-- Floor Shadow Ring -->
                <div class="absolute bottom-2 left-1/2 -translate-x-1/2 w-4/5 h-8 bg-black/60 rounded-full blur-xl pointer-events-none"></div>

                <div class="grid grid-cols-3 gap-2.5 sm:gap-4 items-end max-w-lg mx-auto">
                  
                  <!-- #2 Place (Silver 3D Pedestal) -->
                  <div class="podium-3d-card flex flex-col items-center justify-end h-44 relative cursor-pointer group" ${topActive[1] ? `data-open-profile="${topActive[1].id}"` : ''} title="Click to view #2 Profile">
                    
                    <!-- Floating 3D Silver Medal Coin -->
                    <div class="mb-2 relative flex flex-col items-center">
                      <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-full medal-3d-silver flex items-center justify-center text-white font-black text-xs sm:text-sm border border-white/50 group-hover:scale-110 transition-transform duration-300">
                        🥈
                      </div>
                      <span class="text-[9px] font-black text-slate-300 font-mono mt-1 bg-slate-900/90 border border-slate-700 px-2 py-0.5 rounded-full shadow">#2 Silver</span>
                    </div>

                    <!-- 3D Pedestal Column -->
                    <div class="w-full bg-gradient-to-b from-slate-700/50 via-slate-900/90 to-slate-950 border-t-2 border-slate-300/80 border-x border-slate-800/80 rounded-t-2xl p-2.5 text-center shadow-[0_10px_25px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.2)]">
                      <p class="text-[11px] font-black text-slate-100 truncate group-hover:text-indigo-300 transition">${topActive[1] ? (topActive[1].name || topActive[1].display_name || ('Member #' + topActive[1].member_number)) : '---'}</p>
                      <p class="text-[9px] text-indigo-400/90 font-bold font-mono truncate mt-0.5">${topActive[1] ? '🔥 ' + topActive[1].current_streak + 'd streak' : 'খালি স্লট'}</p>
                      
                      <div class="mt-2 w-full bg-slate-800/90 border border-slate-700 text-slate-200 rounded-lg py-1 px-1 text-[10px] font-black shadow-inner truncate">
                        ★ ${topActive[1] ? topActive[1].total_points + ' Pts' : '0 Pts'}
                      </div>
                    </div>
                  </div>

                  <!-- #1 Place (Gold 3D Champion Pedestal - Tallest Center) -->
                  <div class="podium-3d-card flex flex-col items-center justify-end h-56 relative cursor-pointer group" ${topActive[0] ? `data-open-profile="${topActive[0].id}"` : ''} title="Click to view #1 Champion Profile">
                    
                    <!-- 3D Floating Crown & Ambient Glow -->
                    <div class="absolute -top-7 text-yellow-400 text-xl sm:text-2xl animate-bounce drop-shadow-[0_4px_10px_rgba(234,179,8,0.8)] z-20">👑</div>
                    <div class="absolute top-2 w-20 h-20 bg-yellow-400/20 rounded-full blur-xl animate-pulse-glow pointer-events-none"></div>

                    <!-- Floating 3D Gold Champion Medal Coin -->
                    <div class="mb-2 relative flex flex-col items-center z-10">
                      <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-full medal-3d-gold flex items-center justify-center text-slate-950 font-black text-base sm:text-lg border-2 border-yellow-200 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_20px_rgba(234,179,8,0.5)]">
                        🥇
                      </div>
                      <span class="text-[9px] font-black text-yellow-300 font-mono mt-1 bg-yellow-950/90 border border-yellow-500/60 px-2.5 py-0.5 rounded-full shadow-lg">#1 Champion</span>
                    </div>

                    <!-- 3D Gold Pedestal Column -->
                    <div class="w-full bg-gradient-to-b from-yellow-500/25 via-slate-900/95 to-slate-950 border-t-2 border-yellow-300 border-x border-yellow-500/30 rounded-t-2xl p-2.5 text-center shadow-[0_15px_35px_rgba(234,179,8,0.25),inset_0_2px_4px_rgba(255,255,255,0.3)] relative">
                      <p class="text-xs sm:text-sm font-black text-white truncate group-hover:text-yellow-300 transition drop-shadow">${topActive[0] ? (topActive[0].name || topActive[0].display_name || ('Member #' + topActive[0].member_number)) : '---'}</p>
                      <p class="text-[9px] sm:text-[10px] text-yellow-400 font-bold font-mono truncate mt-0.5">${topActive[0] ? '🔥 ' + topActive[0].current_streak + ' days streak' : 'খালি স্লট'}</p>
                      
                      <div class="mt-2 w-full bg-gradient-to-r from-yellow-500 to-amber-500 text-slate-950 rounded-xl py-1.5 px-1 text-[11px] font-black shadow-[0_4px_12px_rgba(234,179,8,0.4)] truncate">
                        ★ ${topActive[0] ? topActive[0].total_points + ' Points' : '0 Pts'}
                      </div>
                    </div>
                  </div>

                  <!-- #3 Place (Bronze 3D Pedestal) -->
                  <div class="podium-3d-card flex flex-col items-center justify-end h-40 relative cursor-pointer group" ${topActive[2] ? `data-open-profile="${topActive[2].id}"` : ''} title="Click to view #3 Profile">
                    
                    <!-- Floating 3D Bronze Medal Coin -->
                    <div class="mb-2 relative flex flex-col items-center">
                      <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-full medal-3d-bronze flex items-center justify-center text-white font-black text-xs sm:text-sm border border-amber-200/50 group-hover:scale-110 transition-transform duration-300">
                        🥉
                      </div>
                      <span class="text-[9px] font-black text-amber-400 font-mono mt-1 bg-slate-900/90 border border-amber-700 px-2 py-0.5 rounded-full shadow">#3 Bronze</span>
                    </div>

                    <!-- 3D Bronze Pedestal Column -->
                    <div class="w-full bg-gradient-to-b from-amber-700/40 via-slate-900/90 to-slate-950 border-t-2 border-amber-500/80 border-x border-slate-800/80 rounded-t-2xl p-2.5 text-center shadow-[0_10px_25px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.2)]">
                      <p class="text-[11px] font-black text-slate-100 truncate group-hover:text-amber-300 transition">${topActive[2] ? (topActive[2].name || topActive[2].display_name || ('Member #' + topActive[2].member_number)) : '---'}</p>
                      <p class="text-[9px] text-amber-400/90 font-bold font-mono truncate mt-0.5">${topActive[2] ? '🔥 ' + topActive[2].current_streak + 'd streak' : 'খালি স্লট'}</p>
                      
                      <div class="mt-2 w-full bg-slate-800/90 border border-amber-800/50 text-amber-300 rounded-lg py-1 px-1 text-[10px] font-black shadow-inner truncate">
                        ★ ${topActive[2] ? topActive[2].total_points + ' Pts' : '0 Pts'}
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              <!-- 3D Ranked List Items -->
              <div class="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                ${activeList.length > 0 ? activeList.map((m, idx) => `
                  <div class="flex items-center justify-between bg-slate-950/60 hover:bg-slate-900/90 border border-slate-850 hover:border-indigo-500/40 p-3 rounded-2xl transition duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5" data-open-profile="${m.id}" title="Click to view Member Profile">
                    <div class="flex items-center gap-3">
                      <div class="w-7 h-7 rounded-xl border flex items-center justify-center text-xs font-black shadow-inner ${
                        idx === 0 ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40 shadow-yellow-500/10' :
                        idx === 1 ? 'bg-slate-300/20 text-slate-200 border-slate-400/40' :
                        idx === 2 ? 'bg-amber-600/20 text-amber-300 border-amber-600/40' : 'bg-slate-900 text-slate-400 border-slate-800'
                      }">${idx + 1}</div>
                      <div>
                        <p class="text-xs font-black text-slate-200 group-hover:text-indigo-300 transition">${m.name || m.display_name || ('Member #' + m.member_number)}</p>
                        <p class="text-[9px] text-slate-400 font-semibold font-mono">Lvl: ${m.level || 'Bronze'} • ID: #${m.member_number}</p>
                      </div>
                    </div>
                    <div class="text-right">
                      <p class="text-xs font-black text-indigo-400 flex items-center justify-end gap-1 font-mono">
                        <span class="text-amber-400">★</span> ${m.total_points} Pts
                      </p>
                      <p class="text-[10px] text-slate-400 mt-0.5 flex items-center justify-end gap-1 font-mono">
                        🔥 ${m.current_streak} days streak
                      </p>
                    </div>
                  </div>
                `).join('') : `
                  <p class="text-xs text-slate-600 text-center py-8">কোনো সক্রিয় মেম্বার পাওয়া যায়নি!</p>
                `}
              </div>
            </div>

            <!-- Right: 3D Inactive Warning Leaderboard -->
            <div class="bg-gradient-to-b from-slate-900/95 to-slate-950 border border-slate-800 p-5 sm:p-6 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden space-y-5">
              
              <!-- Ambient Red Warning Aura -->
              <div class="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-36 bg-rose-500/15 rounded-full blur-3xl pointer-events-none"></div>

              <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-800/80 pb-4 gap-2 relative z-10">
                <div class="flex items-center gap-2.5">
                  <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500/20 to-orange-500/10 flex items-center justify-center text-rose-400 border border-rose-500/30 shadow-md">
                    <i data-lucide="shield-alert" class="w-5 h-5 text-rose-400 animate-pulse"></i>
                  </div>
                  <div>
                    <h3 class="font-black text-slate-100 text-sm tracking-wide uppercase flex items-center gap-1.5">
                      ২. নিষ্ক্রিয় মেম্বার লিডারবোর্ড (Warning 3D Podium)
                    </h3>
                    <p class="text-[10px] text-slate-400 font-medium">সবচেয়ে বেশি দিন লিংক না দেওয়া মেম্বারগণ</p>
                  </div>
                </div>

                <div>
                  <select id="leaderboard-inactive-filter" class="bg-slate-950/80 border border-slate-800 text-[11px] text-rose-300 px-3 py-1.5 rounded-xl focus:outline-none focus:border-rose-500 cursor-pointer font-bold shadow-sm">
                    <option value="3" ${state.leaderboardInactiveThreshold === 3 ? 'selected' : ''}>৩+ দিন (সকল নিষ্ক্রিয় মেম্বার)</option>
                    <option value="5" ${state.leaderboardInactiveThreshold === 5 ? 'selected' : ''}>৫+ দিন ইনেক্টিভ</option>
                    <option value="7" ${state.leaderboardInactiveThreshold === 7 ? 'selected' : ''}>৭+ দিন (চূড়ান্ত ওয়ার্নিং)</option>
                    <option value="12" ${state.leaderboardInactiveThreshold === 12 ? 'selected' : ''}>১২+ দিন (রিমুভযোগ্য)</option>
                  </select>
                </div>
              </div>

              <!-- 3D Stadium Inactive Warning Podium -->
              <div class="podium-3d-container pt-3 pb-6 relative z-10">
                
                <!-- Floor Shadow Ring -->
                <div class="absolute bottom-2 left-1/2 -translate-x-1/2 w-4/5 h-8 bg-black/60 rounded-full blur-xl pointer-events-none"></div>

                <div class="grid grid-cols-3 gap-2.5 sm:gap-4 items-end max-w-lg mx-auto">
                  
                  <!-- #2 Most Inactive Pedestal -->
                  <div class="podium-3d-card flex flex-col items-center justify-end h-44 relative cursor-pointer group" ${topInactive[1] ? `data-open-profile="${topInactive[1].id}"` : ''} title="Click to view #2 Inactive Profile">
                    
                    <!-- Floating 3D Warning Beacon -->
                    <div class="mb-2 relative flex flex-col items-center">
                      <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-900 border-2 border-rose-400/60 shadow-[0_6px_16px_rgba(244,63,94,0.35)] flex items-center justify-center text-rose-400 font-black text-sm group-hover:scale-110 transition-transform duration-300">
                        ⚠️
                      </div>
                      <span class="text-[9px] font-black text-rose-300 font-mono mt-1 bg-slate-900/90 border border-rose-800 px-2 py-0.5 rounded-full shadow">#2 Warning</span>
                    </div>

                    <!-- 3D Pedestal Column -->
                    <div class="w-full bg-gradient-to-b from-rose-950/40 via-slate-900/90 to-slate-950 border-t-2 border-rose-500/70 border-x border-slate-800/80 rounded-t-2xl p-2.5 text-center shadow-[0_10px_25px_rgba(0,0,0,0.6)]">
                      <p class="text-[11px] font-black text-slate-100 truncate group-hover:text-rose-300 transition">${topInactive[1] ? (topInactive[1].name || topInactive[1].display_name || ('Member #' + topInactive[1].member_number)) : '---'}</p>
                      <p class="text-[9px] text-slate-400 font-bold font-mono truncate mt-0.5">${topInactive[1] ? 'Level: ' + (topInactive[1].level || 'Bronze') : 'খালি স্লট'}</p>
                      
                      <div class="mt-2 w-full bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-lg py-1 px-1 text-[10px] font-black shadow-inner truncate">
                        ${topInactive[1] ? topInactive[1].consecutive_inactive_days + ' দিন' : '0 দিন'}
                      </div>
                    </div>
                  </div>

                  <!-- #1 Most Inactive Pedestal (Danger Stage) -->
                  <div class="podium-3d-card flex flex-col items-center justify-end h-56 relative cursor-pointer group" ${topInactive[0] ? `data-open-profile="${topInactive[0].id}"` : ''} title="Click to view #1 Most Inactive Profile">
                    
                    <!-- 3D Floating Danger Badge -->
                    <div class="absolute -top-7 text-[9px] font-black bg-gradient-to-r from-rose-600 to-red-600 text-white border border-rose-300 px-2.5 py-0.5 rounded-full uppercase tracking-wider animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)] z-20">💀 Danger #1</div>
                    <div class="absolute top-2 w-20 h-20 bg-rose-500/20 rounded-full blur-xl animate-pulse-glow pointer-events-none"></div>

                    <!-- Floating 3D Danger Medal Coin -->
                    <div class="mb-2 relative flex flex-col items-center z-10">
                      <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-full medal-3d-danger flex items-center justify-center text-white font-black text-base sm:text-lg border-2 border-rose-200 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_20px_rgba(244,63,94,0.5)]">
                        🚨
                      </div>
                      <span class="text-[9px] font-black text-rose-200 font-mono mt-1 bg-rose-950/90 border border-rose-500/60 px-2.5 py-0.5 rounded-full shadow-lg">Critical Risk</span>
                    </div>

                    <!-- 3D Danger Pedestal Column -->
                    <div class="w-full bg-gradient-to-b from-rose-600/30 via-slate-900/95 to-slate-950 border-t-2 border-rose-400 border-x border-rose-500/30 rounded-t-2xl p-2.5 text-center shadow-[0_15px_35px_rgba(244,63,94,0.25)] relative">
                      <p class="text-xs sm:text-sm font-black text-white truncate group-hover:text-rose-300 transition drop-shadow">${topInactive[0] ? (topInactive[0].name || topInactive[0].display_name || ('Member #' + topInactive[0].member_number)) : '---'}</p>
                      <p class="text-[9px] sm:text-[10px] text-rose-300 font-bold font-mono truncate mt-0.5">${topInactive[0] ? 'Level: ' + (topInactive[0].level || 'Bronze') : 'খালি স্লট'}</p>
                      
                      <div class="mt-2 w-full bg-gradient-to-r from-rose-600 to-red-600 text-white rounded-xl py-1.5 px-1 text-[11px] font-black shadow-[0_4px_12px_rgba(244,63,94,0.4)] truncate">
                        ${topInactive[0] ? topInactive[0].consecutive_inactive_days + ' দিন নিষ্ক্রিয়' : '0 দিন'}
                      </div>
                    </div>
                  </div>

                  <!-- #3 Most Inactive Pedestal -->
                  <div class="podium-3d-card flex flex-col items-center justify-end h-40 relative cursor-pointer group" ${topInactive[2] ? `data-open-profile="${topInactive[2].id}"` : ''} title="Click to view #3 Inactive Profile">
                    
                    <!-- Floating 3D Warning Beacon -->
                    <div class="mb-2 relative flex flex-col items-center">
                      <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-900 border-2 border-orange-400/60 shadow-[0_6px_16px_rgba(249,115,22,0.35)] flex items-center justify-center text-orange-400 font-black text-sm group-hover:scale-110 transition-transform duration-300">
                        💤
                      </div>
                      <span class="text-[9px] font-black text-orange-300 font-mono mt-1 bg-slate-900/90 border border-orange-800 px-2 py-0.5 rounded-full shadow">#3 Warning</span>
                    </div>

                    <!-- 3D Pedestal Column -->
                    <div class="w-full bg-gradient-to-b from-orange-950/40 via-slate-900/90 to-slate-950 border-t-2 border-orange-500/70 border-x border-slate-800/80 rounded-t-2xl p-2.5 text-center shadow-[0_10px_25px_rgba(0,0,0,0.6)]">
                      <p class="text-[11px] font-black text-slate-100 truncate group-hover:text-orange-300 transition">${topInactive[2] ? (topInactive[2].name || topInactive[2].display_name || ('Member #' + topInactive[2].member_number)) : '---'}</p>
                      <p class="text-[9px] text-slate-400 font-bold font-mono truncate mt-0.5">${topInactive[2] ? 'Level: ' + (topInactive[2].level || 'Bronze') : 'খালি স্লট'}</p>
                      
                      <div class="mt-2 w-full bg-orange-500/15 border border-orange-500/30 text-orange-300 rounded-lg py-1 px-1 text-[10px] font-black shadow-inner truncate">
                        ${topInactive[2] ? topInactive[2].consecutive_inactive_days + ' দিন' : '0 দিন'}
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              <!-- 3D Ranked List Items -->
              <div class="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                ${inactiveList.length > 0 ? inactiveList.map((m, idx) => `
                  <div class="flex items-center justify-between bg-slate-950/60 hover:bg-slate-900/90 border border-slate-850 hover:border-rose-500/40 p-3 rounded-2xl transition duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5" data-open-profile="${m.id}" title="Click to view Member Profile">
                    <div class="flex items-center gap-3">
                      <div class="w-7 h-7 rounded-xl bg-slate-900 border border-rose-500/30 flex items-center justify-center text-xs font-black text-rose-400 shadow-inner">${idx + 1}</div>
                      <div>
                        <p class="text-xs font-black text-slate-200 group-hover:text-rose-400 transition">${m.name || m.display_name || ('Member #' + m.member_number)}</p>
                        <p class="text-[9px] text-slate-400 font-semibold font-mono">ID: #${m.member_number} • Level: ${m.level || 'Bronze'}</p>
                      </div>
                    </div>
                    <div class="text-right">
                      <p class="text-xs font-black text-rose-400 font-mono">${m.consecutive_inactive_days} দিন ইনেক্টিভ</p>
                      <p class="text-[9px] text-slate-500 mt-0.5 font-mono">শেষ একটিভ: ${m.last_active_date ? formatDisplayDate(m.last_active_date) : 'কখনো নয়'}</p>
                    </div>
                  </div>
                `).join('') : (
                  state.leaderboardInactiveThreshold > 3 && inactiveCount > 0 ? `
                    <div class="text-center py-8 space-y-2">
                      <p class="text-xs text-slate-400 font-sans">নির্বাচিত ফিল্টারে (${toBanglaNumber(state.leaderboardInactiveThreshold)}+ দিন) কোনো মেম্বার নেই।</p>
                      <p class="text-[11px] text-slate-500 font-mono">মোট নিষ্ক্রিয়: ${toBanglaNumber(inactiveCount)} জন</p>
                      <button id="reset-leaderboard-inactive-filter-btn" class="mt-2 text-[10px] font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-3.5 py-1.5 rounded-xl transition cursor-pointer">
                        সকল নিষ্ক্রিয় মেম্বার দেখুন (৩+ দিন)
                      </button>
                    </div>
                  ` : `
                    <p class="text-xs text-slate-500 text-center py-8 font-sans">কোনো নিষ্ক্রিয় মেম্বার নেই। সকল মেম্বার সক্রিয়!</p>
                  `
                )}
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
                        <div class="flex flex-wrap items-center gap-2 mb-2">
                          <span class="text-[11px] bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-extrabold px-3 py-1 rounded-lg tracking-widest uppercase shadow-[0_2px_8px_rgba(79,70,229,0.4)]">
                            Support Link Box
                          </span>
                          <span class="text-[9px] bg-slate-900 text-slate-400 border border-slate-800 px-2.5 py-1 rounded-lg font-bold uppercase tracking-wider font-mono">
                            Official Card
                          </span>
                        </div>
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
                        <div class="text-xl leading-none mb-1">🏆</div>
                        <p class="text-[9px] text-slate-500 uppercase font-bold">Total Points</p>
                        <p class="text-base font-black text-slate-200 font-mono">${selectedMember.total_points} Pts</p>
                      </div>
                      <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl text-center space-y-1">
                        <div class="text-xl leading-none mb-1 animate-pulse">🔥</div>
                        <p class="text-[9px] text-slate-500 uppercase font-bold">Current Streak</p>
                        <p class="text-base font-black text-rose-400 font-mono">${selectedMember.current_streak} Days</p>
                      </div>
                      <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl text-center space-y-1">
                        <div class="text-xl leading-none mb-1">✨</div>
                        <p class="text-[9px] text-slate-500 uppercase font-bold">Longest Streak</p>
                        <p class="text-base font-black text-indigo-400 font-mono">${selectedMember.longest_streak} Days</p>
                      </div>
                      <div class="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl text-center space-y-1">
                        <div class="text-xl leading-none mb-1">⭐</div>
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
                            <span class="text-slate-500">Group Name:</span>
                            <span class="text-indigo-400 font-extrabold tracking-wide">Support Link Box</span>
                          </li>
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
                        <p class="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <span>🏅</span> Earned Badges (${allBadges.length})
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
                        <div class="border-t border-slate-800/50 pt-3 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                          <span>Generated: ${new Date().toISOString().split('T')[0]}</span>
                          <span class="text-indigo-400 font-black tracking-widest uppercase">★ Support Link Box ★</span>
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
                    <div class="flex items-center justify-between mb-3">
                      <h3 class="font-bold text-slate-200 text-xs tracking-wider uppercase flex items-center gap-1.5">
                        <i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i> Recent Submission Logs
                      </h3>
                      <span class="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded font-mono">Click for details</span>
                    </div>
                    <div class="max-h-48 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-850/50">
                      ${allLogs.length > 0 ? allLogs.map(log => `
                        <div data-open-activity-detail="${log.id}" data-member-id="${state.reportSelectedMemberId}" class="flex justify-between items-center text-xs py-2 font-mono hover:bg-slate-950/60 p-2 rounded-xl cursor-pointer transition group">
                          <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full ${log.is_active ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
                            <span class="text-slate-300 font-bold group-hover:text-indigo-300 transition">${formatLogDate(log.activity_date)}</span>
                          </div>
                          <div class="flex items-center gap-2">
                            <span class="text-[10px] ${log.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'} px-2 py-0.5 rounded font-bold uppercase">${log.is_active ? 'Active' : 'Inactive'}</span>
                            <span class="text-[10px] text-slate-500">By: ${ADMIN_NAMES[log.submitted_by] || log.submitted_by || 'Admin'}</span>
                            <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400 transition"></i>
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

// Helper to render Member Profile Modal with 4 sub-tabs
function renderMemberProfileModal() {
  if (!state.memberProfileModal) return '';
  const memberId = state.memberProfileModal.memberId;
  const member = (state.members && state.members.find(m => String(m.id) === String(memberId) || String(m.member_number) === String(memberId))) || getMembers().find(m => String(m.id) === String(memberId) || String(m.member_number) === String(memberId));
  if (!member) return '';

  const activeTab = state.memberProfileModal.currentTab || 'overview';
  const allLogs = getActivityLogs().filter(l => l.member_id === memberId).sort((a, b) => new Date(b.activity_date).getTime() - new Date(a.activity_date).getTime());
  const allBadges = getBadges().filter(b => b.member_id === memberId);
  const aliases = Array.isArray(member.aliases) ? member.aliases : [];

  return `
    <div id="member-profile-modal-overlay" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div class="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full p-5 sm:p-7 shadow-[0_25px_60px_rgba(0,0,0,0.85)] relative space-y-5 animate-scale-in my-auto max-h-[92vh] flex flex-col overflow-hidden">
        
        <!-- Header -->
        <div class="flex items-start justify-between border-b border-slate-800 pb-4 gap-3 shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-2xl shadow-inner">
              ${member.level === 'Diamond' ? '💎' : member.level === 'Gold' ? '⭐' : member.level === 'Silver' ? '🥈' : '🥉'}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-extrabold text-slate-100 text-base sm:text-lg">${member.name}</h3>
                <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                  member.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                  member.status === 'warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                  member.status === 'frozen' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                  'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                }">● ${member.status}</span>
              </div>
              <p class="text-xs text-indigo-400 font-mono mt-0.5">${member.display_name || ''} <span class="text-slate-500 ml-1 font-bold">#${member.member_number}</span></p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button id="modal-download-png-btn" data-member-id="${member.id}" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-3.5 py-2 rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer" ${state.isDownloadingReport ? 'disabled' : ''}>
              <i data-lucide="download" class="w-3.5 h-3.5"></i>
              <span class="hidden sm:inline">${state.isDownloadingReport ? 'Downloading...' : 'Report PNG'}</span>
            </button>
            <button id="close-member-profile-modal-btn" class="text-slate-400 hover:text-slate-200 bg-slate-950 p-2 rounded-xl border border-slate-800 transition cursor-pointer">
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <!-- Inner Navigation Tabs -->
        <div class="flex items-center gap-1.5 border-b border-slate-800 pb-2.5 shrink-0 overflow-x-auto scrollbar-none">
          ${[
            { id: 'overview', label: '📊 Overview & Stats' },
            { id: 'history', label: `📅 এক্টিভ হিস্ট্রি (${activeLogs.length})` },
            { id: 'edit', label: '✏️ Edit Profile' },
            { id: 'aliases', label: `🏷️ Aliases (${aliases.length})` }
          ].map(tab => `
            <button data-profile-tab="${tab.id}" class="px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === tab.id
                ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-transparent'
            }">
              ${tab.label}
            </button>
          `).join('')}
        </div>

        <!-- Tab Contents (Scrollable body) -->
        <div class="overflow-y-auto pr-1 flex-grow space-y-4">
          
          ${activeTab === 'overview' ? `
            <!-- Overview Tab -->
            <div class="space-y-4">
              <!-- 4 Stat Cards -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center">
                  <div class="text-xl mb-1">🏆</div>
                  <p class="text-[9px] text-slate-500 uppercase font-bold">Total Points</p>
                  <p class="text-base font-black text-slate-200 font-mono">${member.total_points} Pts</p>
                </div>
                <div class="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center">
                  <div class="text-xl mb-1">🔥</div>
                  <p class="text-[9px] text-slate-500 uppercase font-bold">Current Streak</p>
                  <p class="text-base font-black text-rose-400 font-mono">${member.current_streak} Days</p>
                </div>
                <div class="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center">
                  <div class="text-xl mb-1">✨</div>
                  <p class="text-[9px] text-slate-500 uppercase font-bold">Longest Streak</p>
                  <p class="text-base font-black text-indigo-400 font-mono">${member.longest_streak} Days</p>
                </div>
                <div class="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center">
                  <div class="text-xl mb-1">⭐</div>
                  <p class="text-[9px] text-slate-500 uppercase font-bold">Level Tier</p>
                  <p class="text-base font-black text-emerald-400 font-mono">${member.level}</p>
                </div>
              </div>

              <!-- Diagnostics breakdown -->
              <div class="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl space-y-2.5">
                <h4 class="text-xs font-bold text-slate-300 uppercase tracking-wide">Activity Status Details</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div class="flex justify-between border-b border-slate-800/60 pb-1.5">
                    <span class="text-slate-500">Inactivity Counter:</span>
                    <span class="font-bold ${member.consecutive_inactive_days > 0 ? 'text-rose-400' : 'text-emerald-400'} font-mono">${member.consecutive_inactive_days} Days Inactive</span>
                  </div>
                  <div class="flex justify-between border-b border-slate-800/60 pb-1.5">
                    <span class="text-slate-500">Total Active Submissions:</span>
                    <span class="text-slate-200 font-bold font-mono">${member.total_active_days} Days</span>
                  </div>
                  <div class="flex justify-between border-b border-slate-800/60 pb-1.5">
                    <span class="text-slate-500">Last Active Date:</span>
                    <span class="text-slate-200 font-bold font-mono">${member.last_active_date || 'N/A'}</span>
                  </div>
                  <div class="flex justify-between border-b border-slate-800/60 pb-1.5">
                    <span class="text-slate-500">Member Status:</span>
                    <span class="font-bold uppercase ${member.status === 'active' ? 'text-emerald-400' : 'text-rose-400'}">${member.status}</span>
                  </div>
                </div>

                ${member.notes ? `
                  <div class="pt-2">
                    <span class="text-[10px] text-slate-500 font-bold uppercase">Admin Notes / Remarks:</span>
                    <p class="text-xs text-slate-300 mt-0.5 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">${member.notes}</p>
                  </div>
                ` : ''}
              </div>

              <!-- Active Link Submission Dates Section (লিংক জমার তারিখসমূহ) -->
              <div class="bg-slate-950/80 border border-slate-800/80 p-4 rounded-2xl space-y-3">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
                    <i data-lucide="calendar-check" class="w-4 h-4 text-emerald-400"></i>
                    লিংক জমা দেওয়ার তারিখসমূহ (Active Dates)
                  </h4>
                  <span class="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-lg border border-emerald-500/20">
                    মোট ${activeLogs.length} দিন জমা
                  </span>
                </div>

                ${activeLogs.length > 0 ? `
                  <div class="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                    ${activeLogs.map(l => {
                      const banglaFormatted = formatLogDate(l.activity_date);
                      return `
                        <div class="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 px-3 py-1.5 rounded-xl text-xs font-mono font-bold shadow-sm transition">
                          <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-400"></i>
                          <span>${l.activity_date}</span>
                          <span class="text-[10px] text-emerald-400/80 font-normal font-sans">(${banglaFormatted})</span>
                        </div>
                      `;
                    }).join('')}
                  </div>
                ` : `
                  <p class="text-xs text-slate-500 italic py-2">এই মেম্বার এখনো কোনো তারিখে লিংক জমা দেননি।</p>
                `}
              </div>

              <!-- Quick Action Bar -->
              <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                <button data-toggle-freeze-profile="${member.id}" class="px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                  member.status === 'frozen' 
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20' 
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-blue-400'
                }">
                  ${member.status === 'frozen' ? '❄️ Unfreeze Member' : '❄️ Freeze Member Activity'}
                </button>
                <button data-profile-tab="history" class="px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/25 transition cursor-pointer">
                  + Add Manual Submission
                </button>
              </div>
            </div>
          ` : ''}

          ${activeTab === 'history' ? (() => {
            const historyFilter = state.memberProfileHistoryFilter || 'all';
            const historySearch = (state.memberProfileHistorySearch || '').trim().toLowerCase();
            
            const activeLogsCount = allLogs.filter(l => l.is_active).length;
            const inactiveLogsCount = allLogs.length - activeLogsCount;

            const filteredLogs = allLogs.filter(log => {
              if (historyFilter === 'active' && !log.is_active) return false;
              if (historyFilter === 'inactive' && log.is_active) return false;
              if (historySearch) {
                const admin = (ADMIN_NAMES[log.submitted_by] || log.submitted_by || '').toLowerCase();
                const date = (log.activity_date || '').toLowerCase();
                const source = (log.source || '').toLowerCase();
                const notes = (log.notes || '').toLowerCase();
                return admin.includes(historySearch) || date.includes(historySearch) || source.includes(historySearch) || notes.includes(historySearch);
              }
              return true;
            });

            return `
            <!-- Activity History Tab -->
            <div class="space-y-4">
              
              <!-- Quick Stats Breakdown Banner -->
              <div class="grid grid-cols-3 gap-2 bg-slate-950 p-2.5 rounded-2xl border border-slate-800/80 text-center">
                <div class="p-1.5">
                  <span class="text-[9px] text-slate-500 font-bold uppercase block">Total Recorded</span>
                  <span class="text-sm font-black text-slate-200 font-mono">${allLogs.length} Days</span>
                </div>
                <div class="p-1.5 border-x border-slate-850">
                  <span class="text-[9px] text-emerald-400 font-bold uppercase block">Active Submitted</span>
                  <span class="text-sm font-black text-emerald-400 font-mono">${activeLogsCount} Days</span>
                </div>
                <div class="p-1.5">
                  <span class="text-[9px] text-rose-400 font-bold uppercase block">Inactive / Missed</span>
                  <span class="text-sm font-black text-rose-400 font-mono">${inactiveLogsCount} Days</span>
                </div>
              </div>

              <!-- Add Manual Submission Log Accordion/Card -->
              <div class="bg-slate-950 border border-slate-800/80 p-4 rounded-2xl space-y-3">
                <div class="flex items-center justify-between border-b border-slate-800/60 pb-2">
                  <h4 class="text-xs font-bold text-indigo-400 uppercase tracking-wide flex items-center gap-1.5">
                    <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
                    Add Manual Submission Log
                  </h4>
                  <span class="text-[10px] text-slate-500">Auto-recalculates streaks & levels</span>
                </div>
                
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Date</label>
                    <input id="profile-log-date-input" type="date" value="${state.memberProfileModal.manualLogDate || new Date().toISOString().split('T')[0]}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono" />
                  </div>
                  <div>
                    <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Points</label>
                    <input id="profile-log-points-input" type="number" value="${state.memberProfileModal.manualLogPoints !== undefined ? state.memberProfileModal.manualLogPoints : 10}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono" />
                  </div>
                  <div>
                    <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Status</label>
                    <select id="profile-log-status-select" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer">
                      <option value="true">Active (Approved)</option>
                      <option value="false">Inactive / Missed</option>
                    </select>
                  </div>
                </div>

                <div class="flex justify-end pt-1">
                  <button id="profile-save-log-btn" data-member-id="${member.id}" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i>
                    Save Submission
                  </button>
                </div>
              </div>

              <!-- History Timeline & Filters Bar -->
              <div class="space-y-3 pt-1">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-800 pb-2">
                  
                  <!-- Filter Pill Tabs -->
                  <div class="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-850 shrink-0">
                    <button data-profile-history-filter="all" class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      historyFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }">
                      All (${allLogs.length})
                    </button>
                    <button data-profile-history-filter="active" class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      historyFilter === 'active' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-400'
                    }">
                      Active (${activeLogsCount})
                    </button>
                    <button data-profile-history-filter="inactive" class="px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      historyFilter === 'inactive' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-rose-400'
                    }">
                      Inactive (${inactiveLogsCount})
                    </button>
                  </div>

                  <!-- Quick Search Filter -->
                  <div class="relative flex-grow sm:max-w-xs">
                    <i data-lucide="search" class="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2"></i>
                    <input id="profile-history-search-input" type="text" value="${state.memberProfileHistorySearch || ''}" placeholder="তারিখ বা অ্যাডমিন খুঁজুন..." class="w-full bg-slate-950 border border-slate-800 rounded-xl pl-7 pr-7 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 font-mono" />
                    ${state.memberProfileHistorySearch ? `
                      <button id="profile-history-clear-search-btn" class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                        <i data-lucide="x" class="w-3 h-3"></i>
                      </button>
                    ` : ''}
                  </div>
                </div>
                
                <!-- History Items List -->
                <div class="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                  ${filteredLogs.length > 0 ? filteredLogs.map(log => {
                    const formattedDate = formatLogDate(log.activity_date);
                    const adminName = ADMIN_NAMES[log.submitted_by] || log.submitted_by || 'Admin';
                    const sourceName = log.source || (log.id && log.id.startsWith('manual-') ? 'Manual Entry' : 'Daily Submission');
                    return `
                      <div class="flex items-center justify-between bg-slate-950/70 border border-slate-800/80 hover:border-indigo-500/50 p-3 rounded-2xl transition group shadow-sm">
                        <div data-open-activity-detail="${log.id}" data-member-id="${member.id}" class="flex items-center gap-3 cursor-pointer flex-grow min-w-0 pr-2">
                          <div class="w-8 h-8 rounded-xl ${log.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'} flex items-center justify-center font-bold shrink-0">
                            <i data-lucide="${log.is_active ? 'check' : 'x'}" class="w-4 h-4"></i>
                          </div>
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-xs font-bold text-slate-100 font-mono group-hover:text-indigo-300 transition">${formattedDate}</span>
                              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${log.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">${log.is_active ? 'Active' : 'Inactive'}</span>
                            </div>
                            <p class="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 truncate">
                              <span>By: <b class="text-slate-400">${adminName}</b></span>
                              <span>•</span>
                              <span>${sourceName}</span>
                            </p>
                          </div>
                        </div>

                        <div class="flex items-center gap-2 shrink-0">
                          <span class="text-xs font-black font-mono mr-1 ${log.is_active ? 'text-indigo-400' : 'text-slate-500'}">
                            +${log.points_earned !== undefined ? log.points_earned : (log.is_active ? 10 : 0)} Pts
                          </span>
                          <button data-open-activity-detail="${log.id}" data-member-id="${member.id}" title="View Activity Details" class="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 cursor-pointer">
                            <i data-lucide="eye" class="w-3 h-3"></i> Details
                          </button>
                          <button data-toggle-log-status="${log.id}" title="Toggle Active/Inactive" class="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 border border-slate-800 cursor-pointer transition">
                            <i data-lucide="refresh-cw" class="w-3 h-3"></i>
                          </button>
                          <button data-delete-log="${log.id}" title="Delete Log" class="p-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 cursor-pointer transition">
                            <i data-lucide="trash-2" class="w-3 h-3"></i>
                          </button>
                        </div>
                      </div>
                    `;
                  }).join('') : `
                    <p class="text-xs text-slate-500 italic text-center py-6">কোনো সাবমিশন হিস্টোরি পাওয়া যায়নি।</p>
                  `}
                </div>
              </div>
            </div>
            `;
          })() : ''}

          ${activeTab === 'edit' ? `
            <!-- Edit Profile Tab -->
            <div class="space-y-4">
              <div class="bg-slate-950 border border-slate-800/80 p-4 rounded-2xl space-y-3">
                <div>
                  <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Full Name</label>
                  <input id="profile-edit-name-input" type="text" value="${member.name}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
                </div>
                
                <div>
                  <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Display Name / Username</label>
                  <input id="profile-edit-display-input" type="text" value="${member.display_name || ''}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono" />
                </div>

                <div>
                  <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Admin Notes / Remarks</label>
                  <textarea id="profile-edit-notes-input" rows="3" class="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none">${member.notes || ''}</textarea>
                </div>

                <div class="flex justify-end pt-2">
                  <button id="profile-save-details-btn" data-member-id="${member.id}" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-lg transition cursor-pointer flex items-center gap-1.5">
                    <i data-lucide="save" class="w-3.5 h-3.5"></i>
                    Save Profile Changes
                  </button>
                </div>
              </div>
            </div>
          ` : ''}

          ${activeTab === 'aliases' ? `
            <!-- Aliases Tab -->
            <div class="space-y-4">
              <div class="bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl space-y-2">
                <h4 class="text-xs font-bold text-slate-300 uppercase tracking-wide">Name Aliases & Nicknames</h4>
                <p class="text-[11px] text-slate-400 leading-relaxed">
                  মেম্বার যে সমস্ত ভিন্ন নাম, টাইপো বা নিকনেইম দিয়ে লিংক জমা দেন, সেগুলো এখানে যোগ করুন। ডেইলি সাবমিশন প্রসেস করার সময় সিস্টেম স্বয়ংক্রিয়ভাবে এই মেম্বারের সাথে ম্যাচ করবে।
                </p>
              </div>

              <!-- Add New Alias Form -->
              <div class="flex items-center gap-2 bg-slate-950 border border-slate-800/80 p-3 rounded-2xl">
                <input id="profile-new-alias-input" type="text" placeholder="যেমন: S. M. Jakaria বা Jakaria H." class="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 flex-grow" />
                <button id="profile-add-alias-btn" data-member-id="${member.id}" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-md transition cursor-pointer flex items-center gap-1 shrink-0">
                  <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                  Add Alias
                </button>
              </div>

              <!-- Current Aliases List -->
              <div class="space-y-2">
                <h5 class="text-[10px] text-slate-500 font-bold uppercase">Linked Aliases (${aliases.length})</h5>
                ${aliases.length > 0 ? `
                  <div class="flex flex-wrap gap-2">
                    ${aliases.map(alias => `
                      <div class="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-xs text-slate-300 font-mono">
                        <span>@${alias}</span>
                        <button data-remove-alias="${alias}" data-member-id="${member.id}" class="text-slate-500 hover:text-rose-400 p-0.5 cursor-pointer transition">
                          <i data-lucide="x" class="w-3 h-3"></i>
                        </button>
                      </div>
                    `).join('')}
                  </div>
                ` : `
                  <p class="text-xs text-slate-500 italic py-3">কোনো অতিরিক্ত Alias যোগ করা নেই।</p>
                `}
              </div>
            </div>
          ` : ''}

        </div>
      </div>
    </div>
  `;
}

// Helper to format date into DD-MM-YY
function formatLogDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const day = parts[2].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[0].slice(-2);
      return `${day}-${month}-${year}`;
    }
  } catch (e) {}
  return dateStr;
}

// Helper to format timestamp into DD-MM-YY HH:mm
function formatLogTimestamp(isoStr) {
  if (!isoStr) return 'N/A';
  try {
    const d = new Date(isoStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = String(d.getFullYear()).slice(-2);
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${day}-${month}-${year} ${hours}:${mins}`;
    }
  } catch (e) {}
  return isoStr;
}

// Helper to render Activity Detail Modal
function renderActivityDetailModal() {
  if (!state.activityDetailModal) return '';
  const { logId, memberId, isEditing } = state.activityDetailModal;
  const logs = getActivityLogs();
  const log = logs.find(l => l.id === logId);
  const member = state.members.find(m => m.id === (log ? log.member_id : memberId));

  if (!log) {
    return `
      <div id="activity-detail-modal-overlay" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[120] flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4 text-center animate-scale-in">
          <p class="text-xs text-rose-400 font-bold">অ্যাক্টিভিটি রেকর্ড খুঁজে পাওয়া যায়নি অথবা মুছে ফেলা হয়েছে।</p>
          <button id="close-activity-detail-modal-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer">
            বন্ধ করুন
          </button>
        </div>
      </div>
    `;
  }

  const memberName = member ? member.name : 'Unknown Member';
  const memberNum = member ? `#${member.member_number}` : '';
  const adminDisplayName = ADMIN_NAMES[log.submitted_by] || log.submitted_by || 'Md Shihab Khan';
  const formattedDate = formatLogDate(log.activity_date);
  const formattedTimestamp = formatLogTimestamp(log.created_at || log.timestamp || new Date().toISOString());
  const sourceName = log.source || (log.id && log.id.startsWith('manual-') ? 'Manual Entry' : 'Daily Submission');

  return `
    <div id="activity-detail-modal-overlay" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[120] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div class="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-[0_25px_60px_rgba(0,0,0,0.9)] relative space-y-5 animate-scale-in my-auto">
        
        <!-- Header -->
        <div class="flex items-start justify-between border-b border-slate-800 pb-4 gap-3">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <i data-lucide="calendar-check-2" class="w-6 h-6"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-extrabold text-slate-100 text-base sm:text-lg">Activity Details</h3>
                <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                  log.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                }">● ${log.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <p class="text-xs text-indigo-400 font-mono mt-0.5">${memberName} <span class="text-slate-500 font-bold">${memberNum}</span></p>
            </div>
          </div>

          <button id="close-activity-detail-modal-btn" class="text-slate-400 hover:text-slate-200 bg-slate-950 p-2 rounded-xl border border-slate-800 transition cursor-pointer">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        ${!isEditing ? `
          <!-- Read-Only View of Requested Details -->
          <div class="space-y-4">
            <div class="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 space-y-3.5 divide-y divide-slate-850">
              
              <!-- Activity Date -->
              <div class="flex items-center justify-between pt-1">
                <div>
                  <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Activity Date</p>
                  <p class="text-sm font-black text-slate-100 font-mono mt-0.5">${formattedDate}</p>
                </div>
                <span class="text-[10px] bg-slate-900 border border-slate-800 px-2 py-1 rounded-md text-slate-400 font-mono">${log.activity_date}</span>
              </div>

              <!-- Status -->
              <div class="flex items-center justify-between pt-3">
                <div>
                  <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Status</p>
                  <p class="text-xs font-black mt-0.5 ${log.is_active ? 'text-emerald-400' : 'text-rose-400'} flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full ${log.is_active ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}"></span>
                    ${log.is_active ? 'Active (Approved)' : 'Inactive (Missed)'}
                  </p>
                </div>
                <span class="text-xs font-black font-mono ${log.is_active ? 'text-indigo-400' : 'text-slate-500'}">
                  +${log.points_earned !== undefined ? log.points_earned : (log.is_active ? 10 : 0)} Pts
                </span>
              </div>

              <!-- Submitted By -->
              <div class="flex items-center justify-between pt-3">
                <div>
                  <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Submitted By</p>
                  <p class="text-xs font-bold text-slate-200 mt-0.5 flex items-center gap-1.5">
                    <i data-lucide="user-check" class="w-3.5 h-3.5 text-indigo-400"></i>
                    ${adminDisplayName}
                  </p>
                </div>
                <span class="text-[10px] text-slate-500 font-mono">${log.submitted_by || 'Admin'}</span>
              </div>

              <!-- Submitted At -->
              <div class="flex items-center justify-between pt-3">
                <div>
                  <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Submitted At</p>
                  <p class="text-xs font-bold text-slate-200 font-mono mt-0.5 flex items-center gap-1.5">
                    <i data-lucide="clock" class="w-3.5 h-3.5 text-indigo-400"></i>
                    ${formattedTimestamp}
                  </p>
                </div>
                <span class="text-[9px] text-slate-500">Timestamp</span>
              </div>

              <!-- Source -->
              <div class="flex items-center justify-between pt-3">
                <div>
                  <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Source</p>
                  <p class="text-xs font-bold text-slate-200 mt-0.5 flex items-center gap-1.5">
                    <i data-lucide="layers" class="w-3.5 h-3.5 text-indigo-400"></i>
                    ${sourceName}
                  </p>
                </div>
                <span class="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-md font-bold">${sourceName}</span>
              </div>

              <!-- Activity ID -->
              <div class="flex items-center justify-between pt-3">
                <div class="min-w-0 flex-grow pr-2">
                  <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Activity ID</p>
                  <p class="text-[11px] font-mono text-slate-300 truncate mt-0.5">${log.id}</p>
                </div>
                <button data-copy-activity-id="${log.id}" class="text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 border border-slate-800 px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition shrink-0">
                  <i data-lucide="copy" class="w-3 h-3"></i> Copy ID
                </button>
              </div>

            </div>

            <!-- Audit Trail notice badge -->
            <div class="bg-indigo-950/30 border border-indigo-500/20 rounded-xl p-3 flex items-center gap-2 text-[11px] text-indigo-300">
              <i data-lucide="shield-check" class="w-4 h-4 text-indigo-400 shrink-0"></i>
              <span>Authorized Admin can Edit/Delete this activity. All operations will automatically be recorded in Audit Log.</span>
            </div>

            <!-- Action Buttons for Admin -->
            <div class="flex items-center justify-between pt-2">
              <button data-delete-activity-detail="${log.id}" class="bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/60 text-rose-300 hover:text-white font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete Activity
              </button>

              <div class="flex items-center gap-2">
                <button id="close-activity-detail-modal-secondary-btn" class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer">
                  Close
                </button>
                <button data-start-edit-activity="${log.id}" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer">
                  <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Edit Activity
                </button>
              </div>
            </div>
          </div>
        ` : `
          <!-- Edit Form Mode -->
          <div class="space-y-4">
            <div class="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-3.5">
              <div class="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 class="text-xs font-bold text-indigo-400 uppercase tracking-wide flex items-center gap-1.5">
                  <i data-lucide="edit-2" class="w-3.5 h-3.5"></i> Edit Activity Record
                </h4>
                <span class="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                  <i data-lucide="shield-alert" class="w-3 h-3"></i> Will log to Audit Trail
                </span>
              </div>

              <div class="space-y-3">
                <!-- Activity Date -->
                <div>
                  <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Activity Date</label>
                  <input id="edit-activity-date-input" type="date" value="${log.activity_date}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono" />
                </div>

                <!-- Status & Points -->
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Status</label>
                    <select id="edit-activity-status-select" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer">
                      <option value="true" ${log.is_active ? 'selected' : ''}>Active (Approved)</option>
                      <option value="false" ${!log.is_active ? 'selected' : ''}>Inactive / Missed</option>
                    </select>
                  </div>

                  <div>
                    <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Points Earned</label>
                    <input id="edit-activity-points-input" type="number" value="${log.points_earned !== undefined ? log.points_earned : (log.is_active ? 10 : 0)}" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono" />
                  </div>
                </div>

                <!-- Source -->
                <div>
                  <label class="text-[10px] text-slate-400 font-bold uppercase block mb-1">Source</label>
                  <select id="edit-activity-source-select" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer">
                    <option value="Daily Submission" ${sourceName === 'Daily Submission' ? 'selected' : ''}>Daily Submission</option>
                    <option value="Manual Entry" ${sourceName === 'Manual Entry' ? 'selected' : ''}>Manual Entry</option>
                    <option value="Direct Import" ${sourceName === 'Direct Import' ? 'selected' : ''}>Direct Import</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Edit Buttons -->
            <div class="flex items-center justify-end gap-3 pt-2">
              <button data-cancel-activity-edit class="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer">
                Cancel
              </button>
              <button data-save-activity-edit="${log.id}" class="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6 py-2.5 rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer">
                <i data-lucide="check" class="w-3.5 h-3.5"></i> Save & Record to Audit
              </button>
            </div>
          </div>
        `}

      </div>
    </div>
  `;
}

// Global helper to open activity detail modal
function openActivityDetail(logId, memberId) {
  updateState({
    activityDetailModal: {
      logId,
      memberId,
      isEditing: false
    }
  });
}

// Global helper to open member profile modal
function openMemberProfile(memberIdentifier) {
  if (!memberIdentifier) return;
  const currentMembers = getMembers();
  let member = currentMembers.find(m => String(m.id) === String(memberIdentifier));
  if (!member) {
    member = currentMembers.find(m => String(m.member_number) === String(memberIdentifier));
  }
  if (!member) {
    member = currentMembers.find(m => (m.name || '').toLowerCase() === String(memberIdentifier).toLowerCase());
  }
  if (!member) {
    const matched = findMatchingMember(String(memberIdentifier), currentMembers);
    if (matched && matched.member) {
      member = matched.member;
    }
  }

  if (!member) {
    showToast('মেম্বার প্রোফাইল খুঁজে পাওয়া যায়নি!', 'error');
    return;
  }

  updateState({
    members: currentMembers,
    memberProfileModal: {
      memberId: member.id,
      currentTab: 'overview',
      manualLogDate: new Date().toISOString().split('T')[0],
      manualLogPoints: 10
    }
  });
}
window.openMemberProfile = openMemberProfile;

// Helper to generate and download high-resolution PNG Performance Card
function downloadMemberReportCardPng(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (!member) {
    showToast('মেম্বার খুঁজে পাওয়া যায়নি!', 'error');
    return;
  }

  updateState({ isDownloadingReport: true });
  showToast('পারফরম্যান্স রিপোর্ট কার্ড তৈরি হচ্ছে...', 'info');

  setTimeout(() => {
    const html2canvasFn = window.html2canvas || (typeof html2canvas !== 'undefined' ? html2canvas : null);
    if (!html2canvasFn) {
      showToast('ডাউনলোড ব্যর্থ: html2canvas লাইব্রেরি লোড হয়নি। পেজ রিফ্রেশ করুন।', 'error');
      updateState({ isDownloadingReport: false });
      return;
    }

    const allBadges = getBadges().filter(b => b.member_id === memberId);

    // Create custom offscreen rendering element for pristine PNG export
    const allLogs = getActivityLogs().filter(l => l.member_id === member.id && l.is_active);
    const activeDatesList = allLogs.map(l => l.activity_date).slice(0, 10);

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '-9999px';
    container.style.left = '-9999px';
    container.style.width = '760px';
    container.style.height = 'auto';
    container.style.zIndex = '-9999';
    container.style.margin = '0';
    container.style.boxSizing = 'border-box';
    container.style.backgroundColor = '#020617';
    container.style.color = '#f8fafc';
    container.style.fontFamily = 'system-ui, -apple-system, sans-serif';

    container.innerHTML = `
      <div style="background-color: #020617; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8); position: relative; overflow: hidden;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #1e293b; padding-bottom: 20px;">
          <div>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 11px; background: linear-gradient(to right, #4f46e5, #7c3aed); color: #ffffff; font-weight: 800; padding: 4px 12px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.1em;">
                Support Link Box
              </span>
              <span style="font-size: 9px; background: #0f172a; color: #94a3b8; border: 1px solid #1e293b; padding: 4px 10px; border-radius: 8px; font-weight: 700; text-transform: uppercase;">
                Official Performance Card
              </span>
            </div>
            <h2 style="font-size: 24px; font-weight: 800; color: #f8fafc; margin: 8px 0 0 0;">
              ${member.name}
            </h2>
            <p style="font-size: 12px; font-weight: 600; color: #64748b; margin: 2px 0 0 0;">
              ${member.display_name || ''}
            </p>
          </div>
          <div style="text-align: right; font-family: monospace;">
            <p style="font-size: 11px; color: #94a3b8; font-weight: 700; text-transform: uppercase; margin: 0;">Member Serial</p>
            <p style="font-size: 22px; font-weight: 900; color: #818cf8; margin: 4px 0 0 0;">#${member.member_number}</p>
          </div>
        </div>

        <!-- 4 Stat Cards -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 24px;">
          <div style="background-color: rgba(15, 23, 42, 0.7); border: 1px solid #1e293b; border-radius: 12px; padding: 14px; text-align: center;">
            <div style="font-size: 20px; margin-bottom: 4px;">🏆</div>
            <p style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 700; margin: 0;">Total Points</p>
            <p style="font-size: 17px; font-weight: 900; color: #f8fafc; font-family: monospace; margin: 4px 0 0 0;">${member.total_points} Pts</p>
          </div>
          <div style="background-color: rgba(15, 23, 42, 0.7); border: 1px solid #1e293b; border-radius: 12px; padding: 14px; text-align: center;">
            <div style="font-size: 20px; margin-bottom: 4px;">🔥</div>
            <p style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 700; margin: 0;">Current Streak</p>
            <p style="font-size: 17px; font-weight: 900; color: #fb7185; font-family: monospace; margin: 4px 0 0 0;">${member.current_streak} Days</p>
          </div>
          <div style="background-color: rgba(15, 23, 42, 0.7); border: 1px solid #1e293b; border-radius: 12px; padding: 14px; text-align: center;">
            <div style="font-size: 20px; margin-bottom: 4px;">✨</div>
            <p style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 700; margin: 0;">Longest Streak</p>
            <p style="font-size: 17px; font-weight: 900; color: #818cf8; font-family: monospace; margin: 4px 0 0 0;">${member.longest_streak} Days</p>
          </div>
          <div style="background-color: rgba(15, 23, 42, 0.7); border: 1px solid #1e293b; border-radius: 12px; padding: 14px; text-align: center;">
            <div style="font-size: 20px; margin-bottom: 4px;">⭐</div>
            <p style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 700; margin: 0;">Group Level</p>
            <p style="font-size: 17px; font-weight: 900; color: #34d399; font-family: monospace; margin: 4px 0 0 0;">${member.level}</p>
          </div>
        </div>

        <!-- Diagnostics & Details -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 24px; border-top: 1px solid #1e293b; padding-top: 20px;">
          <div>
            <p style="font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 12px 0;">Activity Diagnostics</p>
            <div style="font-size: 12px; color: #cbd5e1;">
              <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(30, 41, 59, 0.5); padding-bottom: 6px; margin-bottom: 6px;">
                <span style="color: #64748b;">Current Status:</span>
                <span style="font-weight: 700; color: ${member.status === 'active' ? '#34d399' : '#f43f5e'}; text-transform: capitalize;">● ${member.status}</span>
              </div>
              <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(30, 41, 59, 0.5); padding-bottom: 6px; margin-bottom: 6px;">
                <span style="color: #64748b;">Total Active Days:</span>
                <span style="font-weight: 700; font-family: monospace;">${member.total_active_days} Days</span>
              </div>
              <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(30, 41, 59, 0.5); padding-bottom: 6px; margin-bottom: 6px;">
                <span style="color: #64748b;">Inactivity Counter:</span>
                <span style="font-weight: 700; color: #f43f5e; font-family: monospace;">${member.consecutive_inactive_days} Days</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding-top: 2px;">
                <span style="color: #64748b;">Last Active Date:</span>
                <span style="font-weight: 700; font-family: monospace; color: #e2e8f0;">${member.last_active_date || 'N/A'}</span>
              </div>
            </div>

            <!-- Active Dates Summary -->
            <div style="margin-top: 14px;">
              <p style="font-size: 10px; font-weight: 700; color: #34d399; text-transform: uppercase; margin: 0 0 6px 0;">
                ✓ Submitted Link Dates (${allLogs.length})
              </p>
              ${activeDatesList.length > 0 ? `
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${activeDatesList.map(d => `
                    <span style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 6px; border-radius: 6px; font-size: 9px; font-weight: 700; color: #6ee7b7; font-family: monospace;">${d}</span>
                  `).join('')}
                  ${allLogs.length > 10 ? `<span style="font-size: 9px; color: #64748b; font-family: monospace; padding-top: 2px;">+${allLogs.length - 10} more</span>` : ''}
                </div>
              ` : `
                <p style="font-size: 10px; color: #64748b; font-style: italic; margin: 0;">No active submissions recorded</p>
              `}
            </div>
          </div>

          <div style="background-color: rgba(15, 23, 42, 0.5); border: 1px solid #1e293b; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <p style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin: 0 0 8px 0;">
                🏅 Earned Badges (${allBadges.length})
              </p>
              ${allBadges.length > 0 ? `
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                  ${allBadges.map(b => `
                    <span style="background: #020617; border: 1px solid #1e293b; padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; color: #cbd5e1; font-family: monospace;">${b.badge_name}</span>
                  `).join('')}
                </div>
              ` : `
                <p style="font-size: 11px; color: #64748b; font-style: italic; margin: 4px 0;">No badges earned yet.</p>
              `}
            </div>
            <div style="border-top: 1px solid rgba(30, 41, 59, 0.5); padding-top: 10px; margin-top: 12px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; font-family: monospace;">
              <span>Generated: ${new Date().toISOString().split('T')[0]}</span>
              <span style="color: #818cf8; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">★ SUPPORT LINK BOX ★</span>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const filename = `${member.name.replace(/\s+/g, '_')}_Performance_Card.png`;

    const options = {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#020617',
      logging: false
    };

    html2canvasFn(container, options).then(canvas => {
      document.body.removeChild(container);
      try {
        const imgData = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imgData;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showToast(`"${filename}" ডাউনলোড সম্পন্ন হয়েছে!`, 'success');
        updateState({ isDownloadingReport: false });
      } catch (e) {
        showToast('ছবি তৈরি হয়েছে কিন্তু সরাসরি ডাউনলোড করা যায়নি।', 'info');
        updateState({ isDownloadingReport: false });
      }
    }).catch(err => {
      if (container && container.parentNode) {
        document.body.removeChild(container);
      }
      console.error('Report card generation error:', err);
      showToast('রিপোর্ট কার্ড তৈরি করতে সমস্যা হয়েছে!', 'error');
      updateState({ isDownloadingReport: false });
    });
  }, 300);
}

// Helper to analyze and open unregistered member resolution modal with Fuzzy Matching AI suggestions
function triggerUnregisteredResolution(text, onComplete) {
  const { unregisteredNames } = parseBulkActivityText(text);
  if (unregisteredNames.length === 0) {
    onComplete(text, []);
    return false;
  }

  const mList = getMembers();
  const modalNames = unregisteredNames.map(name => {
    const fuzzySuggestion = findFuzzyMemberSuggestion(name, mList, 0.70);
    const hasStrongMatch = fuzzySuggestion && (fuzzySuggestion.similarity >= 0.85 || fuzzySuggestion.score >= 85);
    
    return {
      originalName: name,
      action: hasStrongMatch ? 'link_alias' : 'register',
      resolvedName: hasStrongMatch ? fuzzySuggestion.member.name : name,
      suggestedMember: hasStrongMatch ? fuzzySuggestion.member : null,
      similarity: fuzzySuggestion ? (fuzzySuggestion.similarity || (fuzzySuggestion.score / 100)) : 0
    };
  });

  updateState({
    unregisteredResolutionModal: {
      unregisteredNames: modalNames,
      onResolve: (resolvedNames) => {
        let currentMembers = getMembers();
        const auditTrails = getAuditTrails();
        const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
        let maxMemberNum = currentMembers.reduce((max, m) => m.member_number > max ? m.member_number : max, 0);

        resolvedNames.forEach(item => {
          if (item.action === 'link_alias' && item.suggestedMember) {
            // Add as alias to the suggested registered member
            addMemberAlias(item.suggestedMember.id, item.originalName);
            
            auditTrails.unshift({
              id: `audit-${generateUUID()}`,
              admin_email: state.currentAdminEmail,
              admin_name: adminName,
              action: 'UPDATE_MEMBER',
              entity_type: 'MEMBER',
              description: `Linked alias "${item.originalName}" to member ${item.suggestedMember.name} (#${item.suggestedMember.member_number})`,
              timestamp: new Date().toISOString()
            });
          } else if (item.action === 'register' || item.action === 'rename') {
            const cleaned = cleanName(item.resolvedName);
            const isAlreadyInDb = currentMembers.some(m => getNormalizedName(m.name) === getNormalizedName(cleaned));
            if (!isAlreadyInDb) {
              maxMemberNum++;
              currentMembers.push({
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
                aliases: item.action === 'rename' && item.originalName !== cleaned ? [item.originalName] : [],
                notes: '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });

              auditTrails.unshift({
                id: `audit-${generateUUID()}`,
                admin_email: state.currentAdminEmail,
                admin_name: adminName,
                action: 'ADD_MEMBER',
                entity_type: 'MEMBER',
                description: `Registered resolved member: ${cleaned} (No. ${maxMemberNum})`,
                timestamp: new Date().toISOString()
              });
            }
          }
        });

        saveMembers(currentMembers);
        saveAuditTrails(auditTrails);

        showToast('মেম্বারদের রেজোলিউশন সফলভাবে সম্পন্ন হয়েছে!', 'success');

        // Map mentions in the daily submission activity list
        const mentionRegex = /@([^\n\r📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;
        let nextText = text.replace(mentionRegex, (match, p1) => {
          const extracted = p1.trim();
          const cleaned = extracted.replace(/^[➤\s]+/, '').trim();
          const cleanedFinal = cleanName(cleaned);
          const norm = getNormalizedName(cleanedFinal);

          const item = resolvedNames.find(rn => getNormalizedName(rn.originalName) === norm);
          if (item) {
            if (item.action === 'skip') {
              return '';
            } else if (item.action === 'link_alias' && item.suggestedMember) {
              return `@${item.suggestedMember.name}`;
            } else {
              return `@${item.resolvedName}`;
            }
          }
          return match;
        });

        // Clean up empty lines from skipped entries
        nextText = nextText.split('\n')
          .map(line => {
            const cleanLine = line.replace(/[0-9📅📆✅👇🅾️➤〰️💤⚠️\s.\-()]/g, '');
            if (cleanLine.length === 0) return '';
            return line;
          })
          .filter(line => line.trim().length > 0)
          .join('\n');

        updateState({
          bulkInputText: nextText,
          members: getMembers(),
          unregisteredResolutionModal: null
        });

        onComplete(nextText, resolvedNames);
      }
    }
  });

  return true;
}

// Unified pipeline for processing Daily Submission Workflow:
// Paste/Submit -> Resolve Duplicates (if any) -> Resolve Unregistered (if any) -> Preview Modal
function processDailySubmissionWorkflow(text, isAutoTrigger = false) {
  const duplicates = analyzeAllDuplicates(text);
  
  if (duplicates.length > 0) {
    const mListLocal = getMembers();
    const modalDuplicates = duplicates.map(d => {
      const occurrences = [];
      const isRegistered = mListLocal.some(m => getNormalizedName(m.name) === getNormalizedName(d.name));
      
      for (let i = 0; i < d.count; i++) {
        occurrences.push({
          id: i,
          originalName: d.name,
          resolvedName: isRegistered 
            ? (i === 0 ? d.name : `${d.name} ${i + 1}`) 
            : `${d.name} ${i + 1}`,
          skipped: false,
          isRegistered: isRegistered && i === 0
        });
      }
      return {
        name: d.name,
        count: d.count,
        occurrences,
        isRegistered: isRegistered
      };
    });

    updateState({
      duplicateResolutionModal: {
        duplicates: modalDuplicates,
        onResolve: (resolvedDuplicates) => {
          // 1. Bulk register new members for non-skipped renamed occurrences!
          const mList = getMembers();
          const auditTrails = getAuditTrails();
          const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
          let maxMemberNum = mList.reduce((max, m) => m.member_number > max ? m.member_number : max, 0);

          resolvedDuplicates.forEach(dup => {
            dup.occurrences.forEach(occ => {
              if (!occ.skipped) {
                const cleaned = cleanName(occ.resolvedName);
                const isAlreadyInDb = mList.some(m => getNormalizedName(m.name) === getNormalizedName(cleaned));
                
                if (!isAlreadyInDb) {
                  maxMemberNum++;
                  mList.push({
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
                  });

                  auditTrails.unshift({
                    id: `audit-${generateUUID()}`,
                    admin_email: state.currentAdminEmail,
                    admin_name: adminName,
                    action: 'ADD_MEMBER',
                    entity_type: 'MEMBER',
                    description: `Registered resolved duplicate member: ${cleaned} (No. ${maxMemberNum})`,
                    timestamp: new Date().toISOString()
                  });
                }
              }
            });
          });

          saveMembers(mList);
          saveAuditTrails(auditTrails);

          showToast('ডুপ্লিকেট মেম্বার সমাধান করা হয়েছে এবং রিনেম করা মেম্বারদের রেজিস্টার করা হয়েছে!', 'success');

          // 2. Map the occurrences in the daily submission activity list!
          const occurrenceCounters = {};
          const mentionRegex = /@([^\n\r📅📆✅👇🅾️➤〰️💤⚠️\r\n\t(@]+)/g;

          let nextText = text.replace(mentionRegex, (match, p1) => {
            const extracted = p1.trim();
            const cleaned = extracted.replace(/^[➤\s]+/, '').trim();
            const cleanedFinal = cleanName(cleaned);
            const norm = getNormalizedName(cleanedFinal);

            // Find if this name is in our duplicates
            const dup = resolvedDuplicates.find(d => getNormalizedName(d.name) === norm);
            if (dup) {
              if (occurrenceCounters[norm] === undefined) {
                occurrenceCounters[norm] = 0;
              }
              const occIdx = occurrenceCounters[norm];
              occurrenceCounters[norm]++;

              const occ = dup.occurrences[occIdx];
              if (occ) {
                if (occ.skipped) {
                  return ''; // Completely skip/ignore this occurrence
                } else {
                  return `@${occ.resolvedName}`;
                }
              }
            }
            return match; // Return unchanged if not found or not a duplicate
          });

          // Clean up empty lines from skipped entries and bullet items
          nextText = nextText.split('\n')
            .map(line => {
              const cleanLine = line.replace(/[0-9📅📆✅👇🅾️➤〰️💤⚠️\s.\-()]/g, '');
              if (cleanLine.length === 0) return '';
              return line;
            })
            .filter(line => line.trim().length > 0)
            .join('\n');

          updateState({
            bulkInputText: nextText,
            members: getMembers(),
            duplicateResolutionModal: null
          });

          // Move to next step: Resolve Unregistered
          triggerUnregisteredResolution(nextText, (finalText, resolvedUnreg) => {
            openSubmissionPreviewFlow(text, finalText, resolvedDuplicates);
          });
        }
      }
    });
    return true;
  } else {
    // No duplicates exist.
    if (isAutoTrigger) {
      // Just auto-triggered onpaste, no duplicates, so do nothing.
      return false;
    }

    // Trigger unregistered member resolution
    triggerUnregisteredResolution(text, (finalText, resolvedUnreg) => {
      openSubmissionPreviewFlow(text, finalText, []);
    });
    return true;
  }
}

// Helper to open Pending Submission Preview Flow
function openSubmissionPreviewFlow(rawText, resolvedText, resolvedDuplicates = []) {
  const textToParse = resolvedText || rawText;
  const stats = calculateSubmissionStats(rawText, resolvedText, resolvedDuplicates);

  const onConfirm = () => {
    updateState({ submissionPreviewModal: null });

    const { matchedMembers } = parseBulkActivityText(textToParse);
    if (matchedMembers.length === 0) return;

    const frozenInList = matchedMembers.filter(m => m.status === 'frozen');

    const proceedWithSubmission = () => {
      if (frozenInList.length > 0) {
        const checkAndProcessFrozen = (index, currentMatchedIds, toReactivateIds) => {
          if (index >= frozenInList.length) {
            if (toReactivateIds.length > 0) {
              const members = getMembers();
              toReactivateIds.forEach(id => {
                const idx = members.findIndex(m => m.id === id);
                if (idx !== -1) {
                  members[idx].status = 'active';
                  members[idx].consecutive_inactive_days = 0;
                  members[idx].updated_at = new Date().toISOString();
                }
              });
              saveMembers(members);
              showToast(`${toReactivateIds.length} জন ফ্রোজেন মেম্বার পুনরায় একটিভ করা হয়েছে।`, 'success');
            }

            const finalActiveIds = currentMatchedIds.filter(id => {
              const isFrozen = frozenInList.some(f => f.id === id);
              if (isFrozen) {
                return toReactivateIds.includes(id);
              }
              return true;
            });

            submitBulkActivity(state.bulkInputDate, finalActiveIds);
            return;
          }

          const frozenMember = frozenInList[index];
          showConfirm(
            `Daily Submission List-এ ফ্রোজেন মেম্বার <b>${frozenMember.name}</b> (No. ${frozenMember.member_number}) সনাক্ত হয়েছে।<br><br>আপনি কি তাকে পুনরায় <b>Reactivate (সক্রিয়)</b> করতে চান নাকি <b>Ignore (উপেক্ষা)</b> করতে চান?`,
            () => {
              toReactivateIds.push(frozenMember.id);
              checkAndProcessFrozen(index + 1, currentMatchedIds, toReactivateIds);
            },
            () => {
              checkAndProcessFrozen(index + 1, currentMatchedIds, toReactivateIds);
            },
            'ফ্রিজড মেম্বার সনাক্ত হয়েছে',
            'Reactivate Member',
            'Ignore'
          );
        };

        checkAndProcessFrozen(0, matchedMembers.map(m => m.id), []);
      } else {
        submitBulkActivity(state.bulkInputDate, matchedMembers.map(m => m.id));
      }
    };

    proceedWithSubmission();
  };

  const onCancel = () => {
    updateState({ submissionPreviewModal: null });
  };

  updateState({
    submissionPreviewModal: {
      stats,
      textToParse,
      onConfirm,
      onCancel
    }
  });
}

// Interactive Event binding to the generated HTML elements
function bindEvents() {
  
  // Pending Submission Preview Modal buttons binding
  const previewSubmitBtn = document.getElementById('submission-preview-submit-btn');
  if (previewSubmitBtn && state.submissionPreviewModal) {
    previewSubmitBtn.onclick = () => {
      state.submissionPreviewModal.onConfirm();
    };
  }

  const previewCancelBtn = document.getElementById('submission-preview-cancel-btn');
  if (previewCancelBtn && state.submissionPreviewModal) {
    previewCancelBtn.onclick = () => {
      state.submissionPreviewModal.onCancel();
    };
  }

  const previewDownloadBtn = document.getElementById('download-preview-btn');
  if (previewDownloadBtn && state.submissionPreviewModal) {
    previewDownloadBtn.onclick = () => {
      const stats = state.submissionPreviewModal.stats;
      const textToParse = state.submissionPreviewModal.textToParse;
      const { matchedMembers } = parseBulkActivityText(textToParse);
      
      const fileContent = `========================================
SUPPORT LINK BOX - DAILY SUBMISSION PREVIEW
========================================
📅 Submission Date: ${stats.submissionDate}
👥 মোট Parsed Member: ${stats.totalParsed}
✅ Registered Member: ${stats.registeredCount}
🆕 New Member: ${stats.newCount}
⚠️ Duplicate Name: ${stats.duplicateCount}
⏭️ Skipped Member: ${stats.skippedCount}
❄️ Frozen Member Found: ${stats.frozenCount}
🔄 Alias Match: ${stats.aliasCount}
❌ Invalid Name: ${stats.invalidCount}
📝 Total Activity Added: ${stats.totalActivityAdded}
========================================
Active Members List:
${matchedMembers.map((m, i) => `${i + 1}. ${m.name} (No. ${m.member_number})`).join('\n')}
========================================
Generated on: ${new Date().toLocaleString()}
`;
      const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `linkbox-submission-preview-${stats.submissionDate}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('প্রিভিউ ফাইলটি ডাউনলোড করা হয়েছে!', 'success');
    };
  }

  // Undo Last Submission button binding
  const undoLastSubmissionBtn = document.getElementById('undo-last-submission-btn');
  if (undoLastSubmissionBtn && state.lastSubmissionSnapshot) {
    undoLastSubmissionBtn.onclick = () => {
      const snapshot = state.lastSubmissionSnapshot;
      showConfirm(
        `আপনি কি নিশ্চিত?<br><br><b>${snapshot.submissionDate}</b> তারিখের Submission সম্পূর্ণভাবে <b>Rollback</b> হবে। এই পরিবর্তন আর ফেরত আনা যাবে না।`,
        async () => {
          // Perform rollback
          saveMembers(snapshot.membersState);
          saveActivityLogs(snapshot.logsState);
          saveBadges(snapshot.badgesState);

          // Delete added members / activity logs / badges on Supabase if enabled
          const client = getSupabase();
          if (state.supabaseSyncEnabled && client) {
            try {
              // Delete activity logs for that date
              await client.from('activity_logs').delete().eq('activity_date', snapshot.submissionDate);
              
              // Find added member IDs
              const prevMemberIds = new Set(snapshot.membersState.map(m => m.id));
              const currentMembers = getMembers();
              const addedMemberIds = currentMembers.filter(m => !prevMemberIds.has(m.id)).map(m => m.id);
              if (addedMemberIds.length > 0) {
                await client.from('members').delete().in('id', addedMemberIds);
              }
              
              // Find added badge IDs
              const prevBadgeIds = new Set(snapshot.badgesState.map(b => b.id));
              const currentBadges = getBadges();
              const addedBadgeIds = currentBadges.filter(b => !prevBadgeIds.has(b.id)).map(b => b.id);
              if (addedBadgeIds.length > 0) {
                await client.from('badges').delete().in('id', addedBadgeIds);
              }
            } catch (e) {
              console.error('Supabase rollback failed:', e);
            }
          }

          // Log rollback in Audit Log
          const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
          const auditTrails = getAuditTrails();
          auditTrails.unshift({
            id: `audit-${generateUUID()}`,
            admin_email: state.currentAdminEmail,
            admin_name: adminName,
            action: 'ROLLBACK_SUBMISSION',
            entity_type: 'ACTIVITY',
            description: `${snapshot.submissionDate} তারিখের সাবমিশন সফলভাবে রোলব্যাক করেছেন।`,
            timestamp: new Date().toISOString()
          });
          saveAuditTrails(auditTrails);

          // Clear snapshot
          localStorage.removeItem('support_linkbox_last_submission_snapshot');
          updateState({
            members: getMembers(),
            auditTrails: getAuditTrails(),
            lastSubmissionSnapshot: null
          });

          showToast('সাবমিশন সফলভাবে রোলব্যাক করা হয়েছে!', 'success');
        },
        null,
        'রোলব্যাক নিশ্চিত করুন',
        'রোলব্যাক করুন',
        'বাতিল'
      );
    };
  }

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

  // Duplicate resolution modal interactive events
  if (state.duplicateResolutionModal) {
    // Save button
    const dupSaveBtn = document.getElementById('dup-resolve-save-btn');
    if (dupSaveBtn) {
      dupSaveBtn.onclick = () => {
        const onResolve = state.duplicateResolutionModal.onResolve;
        const duplicates = state.duplicateResolutionModal.duplicates;
        
        // 1. Read current names from all active text fields in DOM
        document.querySelectorAll('.rename-occ-input').forEach(inp => {
          const dIdx = parseInt(inp.getAttribute('data-dup-idx'), 10);
          const oIdx = parseInt(inp.getAttribute('data-occ-idx'), 10);
          if (duplicates[dIdx] && duplicates[dIdx].occurrences[oIdx]) {
            duplicates[dIdx].occurrences[oIdx].resolvedName = inp.value.trim();
          }
        });

        const allResolvedNames = [];
        let hasValidationError = false;
        let validationMsg = '';
        
        duplicates.forEach(dup => {
          dup.occurrences.forEach(occ => {
            if (!occ.skipped) {
              const nameClean = occ.resolvedName.trim();
              if (!nameClean) {
                hasValidationError = true;
                validationMsg = 'মেম্বার এর নাম ফাঁকা হতে পারে না!';
              }
              if (allResolvedNames.includes(nameClean.toLowerCase())) {
                hasValidationError = true;
                validationMsg = `"${nameClean}" নামটি একাধিকবার ব্যবহার করা হয়েছে। প্রতিটি মেম্বার এর নাম ইউনিক হতে হবে!`;
              }
              allResolvedNames.push(nameClean.toLowerCase());
            }
          });
        });
        
        if (hasValidationError) {
          showToast(validationMsg, 'error');
          return;
        }
        
        updateState({ duplicateResolutionModal: null });
        if (onResolve) {
          onResolve(duplicates);
        }
      };
    }

    // Cancel button
    const dupCancelBtn = document.getElementById('dup-resolve-cancel-btn');
    if (dupCancelBtn) {
      dupCancelBtn.onclick = () => {
        updateState({ duplicateResolutionModal: null });
        showToast('ডুপ্লিকেট মেম্বার সমাধান বাতিল করা হয়েছে।', 'info');
      };
    }

    // Skip / Undo toggle
    document.querySelectorAll('.toggle-skip-btn').forEach(btn => {
      btn.onclick = (e) => {
        const dupIdx = parseInt(e.currentTarget.getAttribute('data-dup-idx'), 10);
        const occIdx = parseInt(e.currentTarget.getAttribute('data-occ-idx'), 10);
        
        const nextDuplicates = [...state.duplicateResolutionModal.duplicates];
        
        // Capture typed text from the DOM inputs first, so they aren't lost on re-render
        document.querySelectorAll('.rename-occ-input').forEach(inp => {
          const dIdx = parseInt(inp.getAttribute('data-dup-idx'), 10);
          const oIdx = parseInt(inp.getAttribute('data-occ-idx'), 10);
          if (nextDuplicates[dIdx] && nextDuplicates[dIdx].occurrences[oIdx]) {
            nextDuplicates[dIdx].occurrences[oIdx].resolvedName = inp.value.trim();
          }
        });

        nextDuplicates[dupIdx].occurrences[occIdx].skipped = !nextDuplicates[dupIdx].occurrences[occIdx].skipped;
        updateState({
          duplicateResolutionModal: {
            ...state.duplicateResolutionModal,
            duplicates: nextDuplicates
          }
        });
      };
    });
  }

  // Unregistered resolution modal interactive events
  if (state.unregisteredResolutionModal) {
    // Save button
    const unregSaveBtn = document.getElementById('unreg-resolve-save-btn');
    if (unregSaveBtn) {
      unregSaveBtn.onclick = () => {
        const onResolve = state.unregisteredResolutionModal.onResolve;
        const unregNames = state.unregisteredResolutionModal.unregisteredNames;
        
        // Read current names from all input text fields in DOM
        document.querySelectorAll('.unreg-resolved-input').forEach(inp => {
          const idx = parseInt(inp.getAttribute('data-unreg-idx'), 10);
          if (unregNames[idx]) {
            unregNames[idx].resolvedName = inp.value.trim();
          }
        });

        // Validation
        let hasValidationError = false;
        let validationMsg = '';
        const allResolvedNames = [];

        for (let i = 0; i < unregNames.length; i++) {
          const item = unregNames[i];
          if (item.action !== 'skip') {
            const nameClean = item.resolvedName.trim();
            if (!nameClean) {
              hasValidationError = true;
              validationMsg = 'মেম্বার এর নাম ফাঁকা হতে পারে না!';
              break;
            }
            if (allResolvedNames.includes(nameClean.toLowerCase())) {
              hasValidationError = true;
              validationMsg = `"${nameClean}" নামটি একাধিকবার ব্যবহার করা হয়েছে!`;
              break;
            }
            allResolvedNames.push(nameClean.toLowerCase());
          }
        }

        if (hasValidationError) {
          showToast(validationMsg, 'error');
          return;
        }

        updateState({ unregisteredResolutionModal: null });
        if (onResolve) {
          onResolve(unregNames);
        }
      };
    }

    // Cancel button
    const unregCancelBtn = document.getElementById('unreg-resolve-cancel-btn');
    if (unregCancelBtn) {
      unregCancelBtn.onclick = () => {
        updateState({ unregisteredResolutionModal: null });
        showToast('নতুন মেম্বার সমাধান বাতিল করা হয়েছে।', 'info');
      };
    }

    // Action select change handler
    document.querySelectorAll('.unreg-action-select').forEach(sel => {
      sel.onchange = (e) => {
        const idx = parseInt(e.target.getAttribute('data-unreg-idx'), 10);
        const action = e.target.value;
        
        const nextUnreg = [...state.unregisteredResolutionModal.unregisteredNames];
        
        // Capture typed names from DOM first
        document.querySelectorAll('.unreg-resolved-input').forEach(inp => {
          const i = parseInt(inp.getAttribute('data-unreg-idx'), 10);
          if (nextUnreg[i]) {
            nextUnreg[i].resolvedName = inp.value.trim();
          }
        });

        nextUnreg[idx].action = action;
        if (action === 'register') {
          // Reset to original name if register is chosen
          nextUnreg[idx].resolvedName = nextUnreg[idx].originalName;
        }

        updateState({
          unregisteredResolutionModal: {
            ...state.unregisteredResolutionModal,
            unregisteredNames: nextUnreg
          }
        });
      };
    });
  }

  // Tab change button event delegation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = (e) => {
      const targetTab = e.currentTarget.getAttribute('data-tab');
      updateState({ 
        currentTab: targetTab,
        isFabOpen: false,
        isHeaderMenuOpen: false,
        selectedFreezeMemberIds: []
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

  // Logout handler
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      showConfirm(
        'আপনি কি সত্যিই এডমিন প্যানেল থেকে লগআউট করতে চান?',
        () => {
          localStorage.removeItem('support_linkbox_logged_in');
          updateState({ 
            isLoggedIn: false,
            loginEmailInput: '',
            loginPasswordInput: '',
            loginError: null
          });
          showToast('সফলভাবে লগআউট করা হয়েছে!', 'success');
        },
        null,
        'লগআউট করুন'
      );
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
    
    // Activity input text area modification: pure local setting with zero background parsing lag on mobile/desktop
    const textarea = document.getElementById('bulk-activity-textarea');
    if (textarea) {
      textarea.oninput = (e) => {
        state.bulkInputText = e.target.value;
      };

      textarea.onpaste = () => {
        // Zero lag on paste! Fast and smooth for 200-300+ entries
      };
    }

    // Clear text button
    const clearBtn = document.getElementById('clear-bulk-textarea-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        const ta = document.getElementById('bulk-activity-textarea');
        if (ta) ta.value = '';
        updateState({
          bulkInputText: '',
          processedBulkResult: null
        });
      };
    }

    // Change date selector
    const dateSel = document.getElementById('bulk-input-date');
    if (dateSel) {
      dateSel.onchange = (e) => {
        updateState({ bulkInputDate: e.target.value });
      };
    }

    // Manual "⚙️ Process List" Button Handler
    const processBtn = document.getElementById('process-bulk-list-btn');
    if (processBtn) {
      processBtn.onclick = () => {
        const ta = document.getElementById('bulk-activity-textarea');
        const text = (ta ? ta.value : state.bulkInputText || '').trim();
        if (!text) {
          showToast('দয়া করে ডেইলি লিঙ্ক সাবমিশনের টেক্সট পেস্ট করুন!', 'error');
          return;
        }

        state.bulkInputText = text;
        const detectedDate = detectDateFromText(text);
        if (detectedDate) {
          state.bulkInputDate = detectedDate;
        }

        processBtn.disabled = true;
        processBtn.innerHTML = `<span class="inline-block animate-spin mr-1.5">⚙️</span> প্রসেসিং হচ্ছে (Processing)...`;
        
        setTimeout(() => {
          try {
            const parsed = parseBulkActivityText(text);
            updateState({
              bulkInputText: text,
              processedBulkResult: parsed
            });

            // Trigger workflow check for duplicates and unregistered members
            processDailySubmissionWorkflow(text, false);
          } catch (err) {
            console.error(err);
            showToast('প্রসেসিংয়ে ত্রুটি হয়েছে: ' + err.message, 'error');
          } finally {
            if (processBtn) {
              processBtn.disabled = false;
              processBtn.innerHTML = `<i data-lucide="play-circle" class="w-4 h-4"></i> ⚙️ Process List`;
              if (window.lucide) window.lucide.createIcons();
            }
          }
        }, 30);
      };
    }

    // Open submission preview and confirm from processed state
    const openPreviewBtn = document.getElementById('open-preview-from-processed-btn');
    if (openPreviewBtn) {
      openPreviewBtn.onclick = () => {
        const ta = document.getElementById('bulk-activity-textarea');
        const text = (ta ? ta.value : state.bulkInputText || '').trim();
        if (text) {
          processDailySubmissionWorkflow(text, false);
        }
      };
    }

    // Quick add name helper from warning box directly
    document.querySelectorAll('[data-quick-add-name]').forEach(btn => {
      btn.onclick = (e) => {
        const rawName = e.currentTarget.getAttribute('data-quick-add-name');
        if (handleAddMember(rawName)) {
          showToast(`"${rawName}" সফলভাবে ডাটাবেজে রেজিস্টার হয়েছে এবং এখন একটিভ তালিকায় সনাক্ত করা যাবে!`, 'success');
          if (state.bulkInputText) {
            updateState({
              processedBulkResult: parseBulkActivityText(state.bulkInputText)
            });
          }
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
              updateState({
                processedBulkResult: state.bulkInputText ? parseBulkActivityText(state.bulkInputText) : null
              });
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
        const val = e.target.value;
        if (val === 'custom') {
          updateState({ noticeFilterDays: 10, copiedNotice: false, selectedFreezeMemberIds: [] });
        } else {
          updateState({ noticeFilterDays: Number(val), copiedNotice: false, selectedFreezeMemberIds: [] });
        }
      };
    }

    // Custom days input
    const customDaysInp = document.getElementById('notice-custom-days');
    if (customDaysInp) {
      customDaysInp.oninput = (e) => {
        const val = Number(e.target.value);
        if (val > 0) {
          updateState({ noticeFilterDays: val, copiedNotice: false, selectedFreezeMemberIds: [] });
          // Re-focus because state update re-renders the DOM
          const inp = document.getElementById('notice-custom-days');
          if (inp) {
            inp.focus();
            inp.setSelectionRange(inp.value.length, inp.value.length);
          }
        }
      };
    }

    // Notice Type Radio Buttons
    document.querySelectorAll('input[name="notice-type-radio"]').forEach(radio => {
      radio.onchange = (e) => {
        updateState({ noticeType: e.target.value, copiedNotice: false });
      };
    });

    // Filter Mode Radio Buttons
    document.querySelectorAll('input[name="notice-filter-mode"]').forEach(radio => {
      radio.onchange = (e) => {
        updateState({ noticeFilterMode: e.target.value, copiedNotice: false, selectedFreezeMemberIds: [] });
      };
    });

    // Freeze Select All Button
    const selectAllBtn = document.getElementById('freeze-select-all-btn');
    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        let warningMembers = state.members.filter(m => m.status !== 'frozen');
        if (state.noticeFilterMode === 'exact') {
          warningMembers = warningMembers.filter(m => m.consecutive_inactive_days === state.noticeFilterDays);
        } else if (state.noticeFilterMode === 'less') {
          warningMembers = warningMembers.filter(m => m.consecutive_inactive_days < state.noticeFilterDays);
        } else {
          warningMembers = warningMembers.filter(m => m.consecutive_inactive_days >= state.noticeFilterDays);
        }
        const allIds = warningMembers.map(m => m.id);
        updateState({ selectedFreezeMemberIds: allIds });
      };
    }

    // Freeze Unselect All Button
    const unselectAllBtn = document.getElementById('freeze-unselect-all-btn');
    if (unselectAllBtn) {
      unselectAllBtn.onclick = () => {
        updateState({ selectedFreezeMemberIds: [] });
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

    // Toggle individual member freeze selection
    document.querySelectorAll('[data-freeze-member-id]').forEach(chk => {
      chk.onchange = (e) => {
        const memberId = e.currentTarget.getAttribute('data-freeze-member-id');
        let selectedList = [...(state.selectedFreezeMemberIds || [])];
        if (e.target.checked) {
          if (!selectedList.includes(memberId)) {
            selectedList.push(memberId);
          }
        } else {
          selectedList = selectedList.filter(id => id !== memberId);
        }
        updateState({ selectedFreezeMemberIds: selectedList });
      };
    });

    // Freeze selected inactive members action handler
    const freezeSelectedBtn = document.getElementById('freeze-selected-btn');
    if (freezeSelectedBtn) {
      freezeSelectedBtn.onclick = () => {
        const selectedIds = state.selectedFreezeMemberIds || [];
        if (selectedIds.length === 0) return;

        showConfirm(
          `আপনি কি নির্বাচিত ${selectedIds.length} জন নিষ্ক্রিয় মেম্বারকে Freeze করতে চান? ফ্রিজ করলে তারা আর কোনো নোটিশ বা লিডারবোর্ডে আসবে না।`,
          () => {
            const members = getMembers();
            let frozenNames = [];
            selectedIds.forEach(id => {
              const idx = members.findIndex(m => m.id === id);
              if (idx !== -1) {
                members[idx].status = 'frozen';
                members[idx].consecutive_inactive_days = 0;
                members[idx].updated_at = new Date().toISOString();
                frozenNames.push(members[idx].name);
              }
            });

            saveMembers(members);

            // Audit Trails log
            const trails = getAuditTrails();
            frozenNames.forEach(name => {
              trails.unshift({
                id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                admin_email: state.currentAdminEmail,
                admin_name: ADMIN_NAMES[state.currentAdminEmail] || 'Admin',
                action: 'FREEZE_MEMBER',
                entity_type: 'MEMBER',
                description: `Toggled status of ${name} to frozen (archived)`,
                timestamp: new Date().toISOString()
              });
            });
            saveAuditTrails(trails);

            showToast(`${selectedIds.length} জন মেম্বারকে সফলভাবে Freeze করা হয়েছে।`, 'success');
            updateState({ selectedFreezeMemberIds: [] });
            loadStateFromStorage();
            updateState({});
          }
        );
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

    const resetInactiveFilterBtn = document.getElementById('reset-leaderboard-inactive-filter-btn');
    if (resetInactiveFilterBtn) {
      resetInactiveFilterBtn.onclick = () => {
        updateState({ leaderboardInactiveThreshold: 3 });
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

    // Unified PNG downloader triggers (CORS/IFrame proof & clone solution)
    const triggerPngDownload = () => {
      const selectedMember = state.members.find(m => m.id === state.reportSelectedMemberId);
      if (!selectedMember) return;

      updateState({ isDownloadingReport: true });
      showToast('ইমেজ তৈরি হচ্ছে...', 'info');

      setTimeout(() => {
        const reportCard = document.getElementById('printable-report-card');
        if (!reportCard) {
          showToast('ডাউনলোড ব্যর্থ: কার্ড এলিমেন্ট খুঁজে পাওয়া যায়নি।', 'error');
          updateState({ isDownloadingReport: false });
          return;
        }

        const html2canvasFn = window.html2canvas || (typeof html2canvas !== 'undefined' ? html2canvas : null);
        if (!html2canvasFn) {
          showToast('ডাউনলোড ব্যর্থ: html2canvas লাইব্রেরি লোড হয়নি। দয়া করে পেজটি রিলোড দিন।', 'error');
          updateState({ isDownloadingReport: false });
          return;
        }

        const filename = `${selectedMember.name.replace(/\s+/g, '_')}_Performance_Card.png`;

        // Clone the card to bypass iframe/transform scroll locator issues in html2canvas
        const clone = reportCard.cloneNode(true);
        const origRect = reportCard.getBoundingClientRect();
        
        // Setup direct absolute body placement offscreen so it's fully visible to the cloner
        clone.style.position = 'fixed';
        clone.style.top = '0px';
        clone.style.left = '-9999px';
        clone.style.width = (origRect.width || 720) + 'px';
        clone.style.height = 'auto';
        clone.style.zIndex = '-9999';
        clone.style.margin = '0';
        clone.style.boxSizing = 'border-box';
        
        document.body.appendChild(clone);

        const options = {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#020617', // Match Slate 950
          logging: false,
          scrollX: 0,
          scrollY: 0
        };

        html2canvasFn(clone, options).then(canvas => {
          document.body.removeChild(clone);
          try {
            const imgData = canvas.toDataURL('image/png');
            
            const a = document.createElement('a');
            a.href = imgData;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            showToast(`"${filename}" ডাউনলোড হচ্ছে!`, 'success');

            updateState({ 
              isDownloadingReport: false,
              generatedPngUrl: imgData,
              generatedPngMemberName: selectedMember.name
            });
          } catch (urlErr) {
            console.warn('Direct save link failed, displaying image fallback popup:', urlErr);
            showToast('ছবি তৈরি হয়েছে! ব্রাউজারের সুরক্ষার কারণে সরাসরি ডাউনলোড না হলে নিচের ছবিটিতে চেপে ধরে রাখুন।', 'info');
            
            try {
              const imgData = canvas.toDataURL('image/png');
              updateState({ 
                isDownloadingReport: false,
                generatedPngUrl: imgData,
                generatedPngMemberName: selectedMember.name
              });
            } catch (err) {
              updateState({ isDownloadingReport: false });
            }
          }
        }).catch(err => {
          if (clone && clone.parentNode) {
            document.body.removeChild(clone);
          }
          console.error('Canvas generation failed:', err);
          const errorMsg = err && err.message ? err.message : String(err);
          showToast(`ইমেজ সেভ করতে সমস্যা হয়েছে। Error: ${errorMsg}`, 'error');
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
          const pass = passInp.value.trim();
          if (pass === 'Sm.Shihab211' || pass.toLowerCase() === 'sm.shihab211' || pass.toLowerCase() === 'shihab211') {
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

    // Wipe Local Cache Only button handler
    const wipeLocalCacheBtn = document.getElementById('wipe-local-cache-btn');
    if (wipeLocalCacheBtn) {
      wipeLocalCacheBtn.onclick = () => {
        showConfirm(
          'আপনি কি সত্যিই আপনার ব্রাউজারের লোকাল ক্যাশ সম্পূর্ণ মুছে ফেলতে চান? (ক্লাউড Supabase-এর কোনো ডেটা ডিলিট হবে না)',
          async () => {
            try {
              await wipeDatabaseAll(false);
              initializeDatabase();
              loadStateFromStorage();
              updateState({
                members: [],
                auditTrails: getAuditTrails()
              });
              showToast('ব্রাউজার লোকাল ক্যাশ সফলভাবে রিসেট করা হয়েছে!', 'success');
            } catch (err) {
              showToast(`রিসেট করতে ব্যর্থ হয়েছে: ${err.message}`, 'error');
            }
          },
          null,
          'লোকাল ক্যাশ মুছুন'
        );
      };
    }

    // Wipe Both Local + Supabase Database button handler
    const wipeAllSysBtn = document.getElementById('wipe-all-sys-btn');
    if (wipeAllSysBtn) {
      wipeAllSysBtn.onclick = () => {
        showConfirm(
          'সতর্কতা! আপনি কি সত্যিই লোকাল ব্রাউজার ক্যাশ এবং ক্লাউড Supabase ডাটাবেজের সমস্ত রেকর্ড সম্পূর্ণভাবে মুছে ফেলতে চান? এটি সমস্ত মেম্বার এবং অ্যাক্টিভিটি ডেটা পার্মানেন্টলি ডিলিট করবে!',
          () => {
            showConfirm(
              'আপনি কি চূড়ান্তভাবে নিশ্চিত? এই কাজটি করার সাথে সাথে ক্লাউড Supabase থেকে সমস্ত ডেটা ডিলিট হয়ে যাবে এবং এটি আর ফেরত পাওয়া সম্ভব নয়!',
              async () => {
                try {
                  await wipeDatabaseAll(true);
                  initializeDatabase();
                  loadStateFromStorage();
                  updateState({
                    members: [],
                    auditTrails: getAuditTrails()
                  });
                  showToast('লোকাল এবং ক্লাউড Supabase ডাটাবেজ সফলভাবে সম্পূর্ণ রিসেট করা হয়েছে!', 'success');
                } catch (err) {
                  showToast(`সম্পূর্ণ রিসেট ব্যর্থ হয়েছে: ${err.message}`, 'error');
                }
              },
              null,
              'হ্যাঁ, সম্পূর্ণ মুছুন'
            );
          },
          null,
          'হ্যাঁ, সম্পূর্ণ ডিলিট করুন'
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

function renderLoginPage() {
  const errorHtml = state.loginError 
    ? `<div class="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2 animate-pulse">
         <i data-lucide="alert-circle" class="w-4 h-4 text-rose-400 shrink-0"></i>
         <p class="font-bold">${state.loginError}</p>
       </div>`
    : '';

  const showPassword = state.showPasswordState || false;

  return `
    <div class="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden font-sans">
      <!-- Glow background bubbles -->
      <div class="absolute -left-32 -top-32 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="absolute -right-32 -bottom-32 w-96 h-96 bg-rose-500/5 rounded-full blur-3xl pointer-events-none"></div>

      <div class="w-full max-w-md bg-slate-900 border border-slate-800 p-6 sm:p-8 rounded-3xl shadow-[0_24px_50px_rgba(0,0,0,0.8)] space-y-6 relative overflow-hidden">
        <!-- Brand identity -->
        <div class="flex flex-col items-center text-center space-y-2">
          <div class="w-14 h-14 bg-gradient-to-tr from-indigo-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-[0_0_25px_rgba(99,102,241,0.4)] transform hover:scale-105 transition-transform duration-300">
            <i data-lucide="shield-check" class="w-8 h-8"></i>
          </div>
          <h2 class="text-xl sm:text-2xl font-black text-white tracking-tight mt-3">এডমিন লগইন (Admin Login)</h2>
          <p class="text-xs text-slate-400 max-w-xs leading-relaxed font-medium">Support Link Box ও মেম্বার অ্যাক্টিভিটি ডেটা পরিচালনা করার জন্য আপনার অ্যাকাউন্ট লগইন করুন</p>
        </div>

        <!-- Notification/Alert Box -->
        ${errorHtml}

        <!-- Login Form -->
        <form id="login-form" class="space-y-4" onsubmit="return false;">
          <div class="space-y-1.5">
            <label class="block text-xs font-bold text-slate-400 uppercase tracking-wide">এডমিন ইমেইল (Email)</label>
            <div class="relative">
              <i data-lucide="mail" class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
              <input id="login-email-input" type="email" required placeholder="example@linkbox.com" value="${state.loginEmailInput || ''}" class="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium" />
            </div>
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="block text-xs font-bold text-slate-400 uppercase tracking-wide">পাসওয়ার্ড (Password)</label>
            </div>
            <div class="relative">
              <i data-lucide="lock" class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
              <input id="login-password-input" type="${showPassword ? 'text' : 'password'}" required placeholder="••••••••" value="${state.loginPasswordInput || ''}" class="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium" />
              <button type="button" id="toggle-login-password" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer transition">
                <i data-lucide="${showPassword ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <button type="submit" id="login-submit-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs py-3.5 rounded-xl shadow-[0_4px_12px_rgba(79,70,229,0.3)] hover:shadow-[0_4px_20px_rgba(79,70,229,0.4)] transition-all flex items-center justify-center gap-2 cursor-pointer">
            ${state.loginSubmitting 
              ? `<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> ভেরিফাই করা হচ্ছে...`
              : `<i data-lucide="log-in" class="w-4 h-4"></i> প্রবেশ করুন (Login)`
            }
          </button>
        </form>

        <!-- Quick Admin Fill Box -->
        <div class="space-y-2 border-t border-slate-850 pt-4">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-500 uppercase font-black tracking-wider flex items-center gap-1.5">
              <i data-lucide="users" class="w-3.5 h-3.5"></i> কুইক সিলেক্ট (Registered Admins)
            </span>
            <span class="text-[9px] text-indigo-400 font-bold">অটো-ফিল করতে ক্লিক করুন</span>
          </div>
          <div class="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto pr-1">
            ${Object.entries(ADMIN_NAMES).map(([email, name]) => `
              <button type="button" data-quick-admin="${email}" class="text-left bg-slate-950 hover:bg-indigo-950/20 border border-slate-850 hover:border-indigo-500/20 rounded-xl p-2 transition group cursor-pointer shrink-0">
                <p class="text-[10px] font-bold text-slate-300 group-hover:text-white transition truncate">${name}</p>
                <p class="text-[8px] text-slate-600 group-hover:text-indigo-400 transition truncate">${email}</p>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Help Info Box -->
        <div class="bg-indigo-950/20 border border-indigo-900/40 rounded-2xl p-3.5 flex gap-2.5 items-start">
          <i data-lucide="help-circle" class="w-4.5 h-4.5 text-indigo-400 shrink-0 mt-0.5"></i>
          <p class="text-[10px] text-slate-400 leading-relaxed font-medium">
            <strong class="text-indigo-300">정보 / তথ্য নির্দেশিকা:</strong> <br/>
            ১. আপনার এডমিন প্যানেলে নিরাপদ প্রবেশ নিশ্চিত করতে সঠিক এডমিন ইমেইল ও পাসওয়ার্ড ব্যবহার করুন। <br/>
            ২. Supabase ক্লাউড ডাটাবেজ কানেকশন অ্যাক্টিভ থাকলে সরাসরি ডাটাবেজ থেকে তথ্য ভেরিফাই করা হবে।
          </p>
        </div>
      </div>
    </div>
  `;
}

function bindLoginEvents() {
  const emailInp = document.getElementById('login-email-input');
  if (emailInp) {
    emailInp.oninput = (e) => {
      state.loginEmailInput = e.target.value;
    };
  }

  const passInp = document.getElementById('login-password-input');
  if (passInp) {
    passInp.oninput = (e) => {
      state.loginPasswordInput = e.target.value;
    };
  }

  const togglePassBtn = document.getElementById('toggle-login-password');
  if (togglePassBtn) {
    togglePassBtn.onclick = () => {
      const current = state.showPasswordState || false;
      updateState({ showPasswordState: !current });
    };
  }

  document.querySelectorAll('[data-quick-admin]').forEach(btn => {
    btn.onclick = (e) => {
      const email = e.currentTarget.getAttribute('data-quick-admin');
      updateState({ loginEmailInput: email, loginError: null });
    };
  });

  const form = document.getElementById('login-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      
      const email = (state.loginEmailInput || '').trim();
      const password = (state.loginPasswordInput || '').trim();

      if (!email || !password) {
        updateState({ loginError: 'অনুগ্রহ করে ইমেইল এবং পাসওয়ার্ড উভয়ই প্রদান করুন!' });
        return;
      }

      updateState({ loginSubmitting: true, loginError: null });

      try {
        const client = getSupabase();
        let success = false;
        
        if (client) {
          try {
            // First check if user can log in via Supabase Auth (Authentication -> Users)
            const { data: authData, error: authError } = await client.auth.signInWithPassword({
              email: email,
              password: password
            });
            if (!authError && authData && authData.user) {
              success = true;
            } else {
              // Fallback to table lookup in 'admins'
              const { data, error } = await client.from('admins').select('*').eq('email', email);
              if (!error && data && data.length > 0) {
                const matchedAdmin = data[0];
                const dbPass = matchedAdmin.password || matchedAdmin.pass;
                if (dbPass && String(dbPass).trim() === String(password).trim()) {
                  success = true;
                }
              }
            }
          } catch (err) {
            console.warn('Supabase authentication check failed, trying fallback lists:', err);
          }
        }

        const isPredefinedAdmin = Object.keys(ADMIN_NAMES).includes(email);
        const isDefaultPassword = ['linkbox123', '123456', 'admin123', 'SLBAD220'].includes(password);
        
        if (!success && isPredefinedAdmin && isDefaultPassword) {
          success = true;
        }

        if (success) {
          localStorage.setItem('support_linkbox_logged_in', 'true');
          setCurrentAdmin(email);
          
          const trails = getAuditTrails();
          trails.unshift({
            id: `audit-${Date.now()}`,
            admin_email: email,
            admin_name: ADMIN_NAMES[email] || email,
            action: 'LOGIN',
            entity_type: 'SYSTEM',
            description: `Admin logged in successfully from browser`,
            timestamp: new Date().toISOString()
          });
          saveAuditTrails(trails);

          updateState({ 
            isLoggedIn: true, 
            currentAdminEmail: email,
            loginSubmitting: false,
            loginError: null,
            loginEmailInput: '',
            loginPasswordInput: ''
          });
          
          showToast('সফলভাবে এডমিন প্যানেলে লগইন করা হয়েছে!', 'success');

          // Immediately perform bidirectional smart sync and set up realtime channels on login success
          silentPullFromSupabase().then(() => {
            setupSupabaseRealtime();
          });
        } else {
          updateState({ 
            loginSubmitting: false, 
            loginError: 'ভুল ইমেইল অথবা পাসওয়ার্ড! পুনরায় সঠিক তথ্য দিয়ে চেষ্টা করুন।' 
          });
        }
      } catch (err) {
        console.error('Error during login authentication:', err);
        updateState({ 
          loginSubmitting: false, 
          loginError: 'লগইন ভেরিফিকেশন করার সময় ত্রুটি ঘটেছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।' 
        });
      }
    };
  }

  // GLOBAL: Open Member Profile from any view (robust event delegation)
  document.querySelectorAll('[data-open-profile]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const mId = el.getAttribute('data-open-profile') || el.closest('[data-open-profile]')?.getAttribute('data-open-profile');
      if (mId) {
        openMemberProfile(mId);
      }
    };
  });

  // MODAL EVENTS: MEMBER PROFILE MODAL
  if (state.memberProfileModal) {
    const profileMemberId = state.memberProfileModal.memberId;

    // Close Button
    const closeProfileBtn = document.getElementById('close-member-profile-modal-btn');
    if (closeProfileBtn) {
      closeProfileBtn.onclick = () => {
        updateState({ memberProfileModal: null });
      };
    }

    // Close on clicking backdrop overlay
    const profileOverlay = document.getElementById('member-profile-modal-overlay');
    if (profileOverlay) {
      profileOverlay.onclick = (e) => {
        if (e.target === profileOverlay) {
          updateState({ memberProfileModal: null });
        }
      };
    }

    // Tab Navigation
    document.querySelectorAll('[data-profile-tab]').forEach(btn => {
      btn.onclick = (e) => {
        const tab = e.currentTarget.getAttribute('data-profile-tab');
        updateState({
          memberProfileModal: {
            ...state.memberProfileModal,
            currentTab: tab
          }
        });
      };
    });

    // Download PNG from Profile Modal
    const modalDownloadPngBtn = document.getElementById('modal-download-png-btn');
    if (modalDownloadPngBtn) {
      modalDownloadPngBtn.onclick = () => {
        downloadMemberReportCardPng(profileMemberId);
      };
    }

    // Toggle Freeze Button in Profile Overview
    document.querySelectorAll('[data-toggle-freeze-profile]').forEach(btn => {
      btn.onclick = (e) => {
        const memberId = e.currentTarget.getAttribute('data-toggle-freeze-profile');
        const members = getMembers();
        const mIdx = members.findIndex(m => m.id === memberId);
        if (mIdx !== -1) {
          const isCurrentlyFrozen = members[mIdx].status === 'frozen';
          const newStatus = isCurrentlyFrozen ? 'active' : 'frozen';
          members[mIdx].status = newStatus;
          if (newStatus === 'frozen') {
            members[mIdx].consecutive_inactive_days = 0;
          }
          members[mIdx].updated_at = new Date().toISOString();
          saveMembers(members);

          const auditTrails = getAuditTrails();
          const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Admin';
          auditTrails.unshift({
            id: `audit-${Date.now()}`,
            admin_email: state.currentAdminEmail,
            admin_name: adminName,
            action: isCurrentlyFrozen ? 'UNFREEZE_MEMBER' : 'FREEZE_MEMBER',
            entity_type: 'MEMBER',
            description: `${isCurrentlyFrozen ? 'Unfroze' : 'Froze'} member activity: ${members[mIdx].name}`,
            timestamp: new Date().toISOString()
          });
          saveAuditTrails(auditTrails);

          showToast(`${members[mIdx].name} ${isCurrentlyFrozen ? 'কে Unfreeze করা হয়েছে।' : 'কে Freeze করা হয়েছে।'}`, 'success');
          loadStateFromStorage();
          updateState({});
        }
      };
    });

    // Add Manual Submission Log (History Tab)
    const saveLogBtn = document.getElementById('profile-save-log-btn');
    if (saveLogBtn) {
      saveLogBtn.onclick = () => {
        const dateInp = document.getElementById('profile-log-date-input');
        const pointsInp = document.getElementById('profile-log-points-input');
        const statusSel = document.getElementById('profile-log-status-select');

        const dateStr = dateInp ? dateInp.value : new Date().toISOString().split('T')[0];
        const points = pointsInp ? parseInt(pointsInp.value, 10) || 10 : 10;
        const isActive = statusSel ? statusSel.value === 'true' : true;

        addManualMemberLog(profileMemberId, dateStr, points, isActive, state.currentAdminEmail);
      };
    }

    // Toggle Log Active/Inactive status
    document.querySelectorAll('[data-toggle-log-status]').forEach(btn => {
      btn.onclick = (e) => {
        const logId = e.currentTarget.getAttribute('data-toggle-log-status');
        const logs = getActivityLogs();
        const log = logs.find(l => l.id === logId);
        if (log) {
          updateMemberLogStatus(logId, !log.is_active);
        }
      };
    });

    // Delete Log
    document.querySelectorAll('[data-delete-log]').forEach(btn => {
      btn.onclick = (e) => {
        const logId = e.currentTarget.getAttribute('data-delete-log');
        showConfirm(
          'আপনি কি সত্যিই এই সাবমিশন লগটি মুছে ফেলতে চান? মেম্বারের পয়েন্ট ও স্ট্রেইক স্বয়ংক্রিয়ভাবে পুনরায় গণনা হবে।',
          () => {
            deleteMemberLog(logId);
          },
          null,
          'লগ মুছুন'
        );
      };
    });

    // Save Profile Edit Changes (Edit Tab)
    const saveDetailsBtn = document.getElementById('profile-save-details-btn');
    if (saveDetailsBtn) {
      saveDetailsBtn.onclick = () => {
        const nameInp = document.getElementById('profile-edit-name-input');
        const displayInp = document.getElementById('profile-edit-display-input');
        const notesInp = document.getElementById('profile-edit-notes-input');

        const updates = {};
        if (nameInp) updates.name = nameInp.value;
        if (displayInp) updates.display_name = displayInp.value;
        if (notesInp) updates.notes = notesInp.value;

        if (updateMemberDetails(profileMemberId, updates)) {
          showToast('মেম্বার প্রোফাইল সফলভাবে আপডেট করা হয়েছে!', 'success');
        } else {
          showToast('প্রোফাইল আপডেট করতে সমস্যা হয়েছে।', 'error');
        }
      };
    }

    // Add Alias (Aliases Tab)
    const addAliasBtn = document.getElementById('profile-add-alias-btn');
    const aliasInp = document.getElementById('profile-new-alias-input');
    if (addAliasBtn) {
      addAliasBtn.onclick = () => {
        if (aliasInp) {
          const alias = aliasInp.value.trim();
          if (!alias) {
            showToast('দয়া করে Alias লিখুন!', 'error');
            return;
          }
          if (addMemberAlias(profileMemberId, alias)) {
            showToast(`"${alias}" Alias সফলভাবে যুক্ত করা হয়েছে!`, 'success');
            aliasInp.value = '';
          }
        }
      };
    }
    if (aliasInp) {
      aliasInp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          if (addAliasBtn) addAliasBtn.click();
        }
      };
    }

    // Remove Alias (Aliases Tab)
    document.querySelectorAll('[data-remove-alias]').forEach(btn => {
      btn.onclick = (e) => {
        const alias = e.currentTarget.getAttribute('data-remove-alias');
        const memberId = e.currentTarget.getAttribute('data-member-id') || profileMemberId;
        if (removeMemberAlias(memberId, alias)) {
          showToast(`"${alias}" Alias মুছে ফেলা হয়েছে!`, 'info');
        }
      };
    });

    // Profile History Filter Tabs
    document.querySelectorAll('[data-profile-history-filter]').forEach(btn => {
      btn.onclick = (e) => {
        const filter = e.currentTarget.getAttribute('data-profile-history-filter');
        updateState({ memberProfileHistoryFilter: filter });
      };
    });

    // Profile History Search Input
    const profileHistorySearchInp = document.getElementById('profile-history-search-input');
    if (profileHistorySearchInp) {
      profileHistorySearchInp.oninput = (e) => {
        updateState({ memberProfileHistorySearch: e.target.value });
      };
    }
    const profileHistoryClearBtn = document.getElementById('profile-history-clear-search-btn');
    if (profileHistoryClearBtn) {
      profileHistoryClearBtn.onclick = () => {
        updateState({ memberProfileHistorySearch: '' });
      };
    }
  }

  // ================= MANAGEMENT SECTION EVENTS =================
  // Quick Recorded Dates Dropdown
  const mgmtDateSelect = document.getElementById('management-recorded-dates-select');
  if (mgmtDateSelect) {
    mgmtDateSelect.onchange = (e) => {
      if (e.target.value) {
        updateState({ managementSelectedDate: e.target.value });
      }
    };
  }

  // Date picker input
  const mgmtDateInp = document.getElementById('management-date-input');
  if (mgmtDateInp) {
    mgmtDateInp.oninput = mgmtDateInp.onchange = (e) => {
      if (e.target.value) {
        updateState({ managementSelectedDate: e.target.value });
      }
    };
  }

  // Prev / Next / Today Date buttons
  const mgmtPrevDateBtn = document.getElementById('management-prev-date-btn');
  if (mgmtPrevDateBtn) {
    mgmtPrevDateBtn.onclick = () => {
      const cur = state.managementSelectedDate || new Date().toISOString().split('T')[0];
      const d = new Date(cur);
      d.setDate(d.getDate() - 1);
      updateState({ managementSelectedDate: d.toISOString().split('T')[0] });
    };
  }

  const mgmtNextDateBtn = document.getElementById('management-next-date-btn');
  if (mgmtNextDateBtn) {
    mgmtNextDateBtn.onclick = () => {
      const cur = state.managementSelectedDate || new Date().toISOString().split('T')[0];
      const d = new Date(cur);
      d.setDate(d.getDate() + 1);
      updateState({ managementSelectedDate: d.toISOString().split('T')[0] });
    };
  }

  const mgmtTodayBtn = document.getElementById('management-today-btn');
  if (mgmtTodayBtn) {
    mgmtTodayBtn.onclick = () => {
      updateState({ managementSelectedDate: new Date().toISOString().split('T')[0] });
    };
  }

  // Management Sub-tabs
  document.querySelectorAll('[data-management-tab]').forEach(btn => {
    btn.onclick = (e) => {
      const tab = e.currentTarget.getAttribute('data-management-tab');
      updateState({ managementActiveTab: tab });
    };
  });

  // Archive select date
  document.querySelectorAll('[data-management-select-date]').forEach(btn => {
    btn.onclick = (e) => {
      const date = e.currentTarget.getAttribute('data-management-select-date');
      updateState({ 
        managementSelectedDate: date,
        managementActiveTab: 'active'
      });
    };
  });

  // Delete Date Submission Record
  const deleteDateHandler = (date) => {
    if (!date) return;
    showConfirm(
      `${date} তারিখের সম্পূর্ণ Daily Link Submission মুছে ফেলতে চান? সেদিনের সকল মেম্বারের স্ট্যাটাস ও পয়েন্ট স্বয়ংক্রিয়ভাবে পুনরায় গণনা করা হবে এবং Audit Log-এ সংরক্ষিত হবে।`,
      () => {
        if (deleteDailySubmissionRecord(date, state.currentAdminEmail)) {
          showToast(`${date} তারিখের সাবমিশন সফলভাবে মুছে ফেলা হয়েছে!`, 'success');
        } else {
          showToast('সাবমিশন মুছতে সমস্যা হয়েছে।', 'error');
        }
      },
      null,
      'তারিখের রেকর্ড মুছুন'
    );
  };

  const mgmtDeleteDateBtn = document.getElementById('management-delete-date-submission-btn');
  if (mgmtDeleteDateBtn) {
    mgmtDeleteDateBtn.onclick = () => {
      deleteDateHandler(state.managementSelectedDate);
    };
  }

  document.querySelectorAll('[data-management-delete-date]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const date = e.currentTarget.getAttribute('data-management-delete-date');
      deleteDateHandler(date);
    };
  });

  // Search input in management
  const mgmtSearchInp = document.getElementById('management-search-input');
  if (mgmtSearchInp) {
    mgmtSearchInp.oninput = (e) => {
      updateState({ managementSearchQuery: e.target.value });
    };
  }

  const mgmtClearSearchBtn = document.getElementById('management-clear-search-btn');
  if (mgmtClearSearchBtn) {
    mgmtClearSearchBtn.onclick = () => {
      updateState({ managementSearchQuery: '' });
    };
  }

  // Open Add Member to Date Modal
  const mgmtAddMemberDateBtn = document.getElementById('management-add-member-date-btn');
  if (mgmtAddMemberDateBtn) {
    mgmtAddMemberDateBtn.onclick = () => {
      updateState({
        managementAddMemberModal: {
          date: state.managementSelectedDate || new Date().toISOString().split('T')[0],
          selectedMemberId: '',
          points: 10
        }
      });
    };
  }

  // Quick Mark Active from Inactive Tab
  document.querySelectorAll('[data-management-add-active]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const memberId = e.currentTarget.getAttribute('data-management-add-active');
      const date = state.managementSelectedDate || new Date().toISOString().split('T')[0];
      if (addMemberToDateSubmission(date, memberId, 10, state.currentAdminEmail)) {
        showToast('মেম্বারকে এই দিনের তালিকায় Active হিসেবে যোগ করা হয়েছে!', 'success');
      } else {
        showToast('মেম্বার যোগ করতে সমস্যা হয়েছে।', 'error');
      }
    };
  });

  // Mark Submission Invalid
  document.querySelectorAll('[data-management-invalidate-member]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const logId = e.currentTarget.getAttribute('data-management-invalidate-member');
      const name = e.currentTarget.getAttribute('data-member-name') || 'মেম্বার';
      showConfirm(
        `আপনি কি নিশ্চিতভাবে ${name}-এর লিঙ্ক সাবমিশন ইনভ্যালিড করতে চান?`,
        () => {
          if (markSubmissionInvalid(logId, state.currentAdminEmail)) {
            showToast(`${name}-এর সাবমিশন ইনভ্যালিড করা হয়েছে।`, 'info');
          } else {
            showToast('অপারেশন ব্যর্থ হয়েছে।', 'error');
          }
        },
        null,
        'ইনভ্যালিড করুন'
      );
    };
  });

  // Remove Member from Date
  document.querySelectorAll('[data-management-remove-member]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const logId = e.currentTarget.getAttribute('data-management-remove-member');
      const name = e.currentTarget.getAttribute('data-member-name') || 'মেম্বার';
      showConfirm(
        `আপনি কি নিশ্চিতভাবে এই দিনের তালিকা থেকে ${name}-কে বাদ দিতে চান?`,
        () => {
          if (removeMemberFromDateSubmission(logId, state.currentAdminEmail)) {
            showToast(`${name}-কে তালিকা থেকে বাদ দেওয়া হয়েছে।`, 'info');
          } else {
            showToast('বাদ দিতে সমস্যা হয়েছে।', 'error');
          }
        },
        null,
        'বাদ দিন'
      );
    };
  });

  // Open Replace Member Modal
  document.querySelectorAll('[data-management-replace-member]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const logId = e.currentTarget.getAttribute('data-management-replace-member');
      const oldMemberId = e.currentTarget.getAttribute('data-old-member-id');
      const oldMemberName = e.currentTarget.getAttribute('data-old-member-name') || 'মেম্বার';
      updateState({
        managementReplaceMemberModal: {
          logId,
          oldMemberId,
          oldMemberName,
          date: state.managementSelectedDate,
          replacementMemberId: ''
        }
      });
    };
  });

  // Add Member Modal Actions
  if (state.managementAddMemberModal) {
    const closeAddModal = () => updateState({ managementAddMemberModal: null });
    const closeAddBtn = document.getElementById('close-management-add-member-modal-btn');
    const cancelAddBtn = document.getElementById('cancel-management-add-member-btn');
    const addOverlay = document.getElementById('management-add-member-modal-overlay');
    const submitAddBtn = document.getElementById('submit-management-add-member-btn');

    if (closeAddBtn) closeAddBtn.onclick = closeAddModal;
    if (cancelAddBtn) cancelAddBtn.onclick = closeAddModal;
    if (addOverlay) {
      addOverlay.onclick = (e) => {
        if (e.target === addOverlay) closeAddModal();
      };
    }

    if (submitAddBtn) {
      submitAddBtn.onclick = () => {
        const sel = document.getElementById('management-add-member-select');
        const pts = document.getElementById('management-add-points-input');
        const memberId = sel ? sel.value : '';
        const points = pts ? parseInt(pts.value, 10) || 10 : 10;
        const date = state.managementAddMemberModal.date;

        if (!memberId) {
          showToast('দয়া করে একজন মেম্বার নির্বাচন করুন!', 'error');
          return;
        }

        if (addMemberToDateSubmission(date, memberId, points, state.currentAdminEmail)) {
          showToast('মেম্বারকে সফলভাবে সাবমিশনে যোগ করা হয়েছে!', 'success');
          closeAddModal();
        } else {
          showToast('মেম্বার যোগ করতে সমস্যা হয়েছে।', 'error');
        }
      };
    }
  }

  // Replace Member Modal Actions
  if (state.managementReplaceMemberModal) {
    const closeReplaceModal = () => updateState({ managementReplaceMemberModal: null });
    const closeReplaceBtn = document.getElementById('close-management-replace-member-modal-btn');
    const cancelReplaceBtn = document.getElementById('cancel-management-replace-member-btn');
    const replaceOverlay = document.getElementById('management-replace-member-modal-overlay');
    const submitReplaceBtn = document.getElementById('submit-management-replace-member-btn');

    if (closeReplaceBtn) closeReplaceBtn.onclick = closeReplaceModal;
    if (cancelReplaceBtn) cancelReplaceBtn.onclick = closeReplaceModal;
    if (replaceOverlay) {
      replaceOverlay.onclick = (e) => {
        if (e.target === replaceOverlay) closeReplaceModal();
      };
    }

    if (submitReplaceBtn) {
      submitReplaceBtn.onclick = () => {
        const sel = document.getElementById('management-replace-member-select');
        const newMemberId = sel ? sel.value : '';
        const logId = state.managementReplaceMemberModal.logId;

        if (!newMemberId) {
          showToast('দয়া করে সঠিক মেম্বার নির্বাচন করুন!', 'error');
          return;
        }

        if (replaceMemberInDateSubmission(logId, newMemberId, state.currentAdminEmail)) {
          showToast('মেম্বার সফলভাবে প্রতিস্থাপন করা হয়েছে!', 'success');
          closeReplaceModal();
        } else {
          showToast('প্রতিস্থাপন করতে সমস্যা হয়েছে।', 'error');
        }
      };
    }
  }

  // Bind Global Activity Detail Modal Trigger (from History, Overview, or Reports)
  document.querySelectorAll('[data-open-activity-detail]').forEach(elem => {
    elem.onclick = (e) => {
      e.stopPropagation();
      const logId = e.currentTarget.getAttribute('data-open-activity-detail');
      const memberId = e.currentTarget.getAttribute('data-member-id');
      if (logId) {
        openActivityDetail(logId, memberId);
      }
    };
  });

  // Bind Activity Detail Modal Controls
  if (state.activityDetailModal) {
    const closeBtn = document.getElementById('close-activity-detail-modal-btn');
    const closeSecBtn = document.getElementById('close-activity-detail-modal-secondary-btn');
    const overlay = document.getElementById('activity-detail-modal-overlay');

    const handleClose = () => {
      updateState({ activityDetailModal: null });
    };

    if (closeBtn) closeBtn.onclick = handleClose;
    if (closeSecBtn) closeSecBtn.onclick = handleClose;
    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) handleClose();
      };
    }

    // Copy Activity ID
    document.querySelectorAll('[data-copy-activity-id]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = e.currentTarget.getAttribute('data-copy-activity-id');
        if (id && navigator.clipboard) {
          navigator.clipboard.writeText(id).then(() => {
            showToast('Activity ID ক্লিপবোর্ডে কপি করা হয়েছে!', 'success');
          }).catch(() => {
            showToast(`ID: ${id}`, 'info');
          });
        }
      };
    });

    // Start Edit Activity Form
    document.querySelectorAll('[data-start-edit-activity]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        updateState({
          activityDetailModal: {
            ...state.activityDetailModal,
            isEditing: true
          }
        });
      };
    });

    // Cancel Edit Activity
    document.querySelectorAll('[data-cancel-activity-edit]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        updateState({
          activityDetailModal: {
            ...state.activityDetailModal,
            isEditing: false
          }
        });
      };
    });

    // Save Edit Activity Changes
    document.querySelectorAll('[data-save-activity-edit]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const logId = e.currentTarget.getAttribute('data-save-activity-edit');
        const dateInp = document.getElementById('edit-activity-date-input');
        const statusSel = document.getElementById('edit-activity-status-select');
        const pointsInp = document.getElementById('edit-activity-points-input');
        const sourceSel = document.getElementById('edit-activity-source-select');

        const updates = {
          activity_date: dateInp ? dateInp.value : undefined,
          is_active: statusSel ? (statusSel.value === 'true') : true,
          points_earned: pointsInp ? parseInt(pointsInp.value, 10) || 0 : 10,
          source: sourceSel ? sourceSel.value : 'Daily Submission'
        };

        if (updateActivityLog(logId, updates)) {
          showToast('অ্যাক্টিভিটি সফলভাবে আপডেট ও অডিটে রেকর্ড করা হয়েছে!', 'success');
          updateState({
            activityDetailModal: {
              ...state.activityDetailModal,
              isEditing: false
            }
          });
        } else {
          showToast('অ্যাক্টিভিটি আপডেট করতে সমস্যা হয়েছে।', 'error');
        }
      };
    });

    // Delete Activity Record
    document.querySelectorAll('[data-delete-activity-detail]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const logId = e.currentTarget.getAttribute('data-delete-activity-detail');
        showConfirm(
          'আপনি কি নিশ্চিতভাবে এই অ্যাক্টিভিটি রেকর্ডটি মুছে ফেলতে চান? এটি Audit Log-এ সংরক্ষিত হবে এবং সংশ্লিষ্ট মেম্বারের স্ট্রেইক ও মোট পয়েন্ট পুনরায় হিসাব করা হবে।',
          () => {
            if (deleteActivityLog(logId)) {
              showToast('অ্যাক্টিভিটি মুছে ফেলা হয়েছে এবং অডিটে সংরক্ষিত হয়েছে।', 'info');
              updateState({ activityDetailModal: null });
            } else {
              showToast('অ্যাক্টিভিটি মুছতে সমস্যা হয়েছে।', 'error');
            }
          },
          null,
          'অ্যাক্টিভিটি মুছুন'
        );
      };
    });
  }
}

// Kickstart Application
window.addEventListener('DOMContentLoaded', () => {
  // Global robust delegation for data-open-profile clicks anywhere in document
  document.addEventListener('click', (e) => {
    const profileEl = e.target.closest('[data-open-profile]');
    if (profileEl) {
      const memberId = profileEl.getAttribute('data-open-profile');
      if (memberId) {
        e.preventDefault();
        e.stopPropagation();
        openMemberProfile(memberId);
      }
    }
  }, true);

  loadStateFromStorage();
  recalculateAllMemberStatsFromLogs();
  updateState({ members: getMembers() });

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered with scope:', reg.scope))
      .catch(err => console.warn('Service Worker registration failed:', err));
  }

  // Wait for Supabase CDN to load, then run initial sync and setup realtime listeners
  ensureSupabaseLoaded().then(loaded => {
    if (loaded) {
      initSupabaseConfig();
      silentPullFromSupabase().then(() => {
        setupSupabaseRealtime();
      });
    }
  });

  // Periodic automatic sync every 2 minutes (120,000 ms)
  setInterval(() => {
    silentPullFromSupabase();
  }, 2 * 60 * 1000);

  // Periodic countdown check for the undo last submission rollback card (runs every 1 second)
  setInterval(() => {
    if (state.lastSubmissionSnapshot) {
      const elapsed = Date.now() - new Date(state.lastSubmissionSnapshot.timestamp).getTime();
      const remaining = Math.max(0, 5 * 60 * 1000 - elapsed);
      if (remaining <= 0) {
        localStorage.removeItem('support_linkbox_last_submission_snapshot');
        updateState({ lastSubmissionSnapshot: null });
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const countdownText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        const countdownEl = document.getElementById('undo-countdown');
        if (countdownEl) {
          countdownEl.textContent = countdownText;
        }
      }
    }
  }, 1000);
});
