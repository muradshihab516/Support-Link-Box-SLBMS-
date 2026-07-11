// Support Link Box - Core Administration Engine (Vanilla JS Edition)
// High-performance client-side state machine with localStorage persistence

import { ADMIN_NAMES, STORAGE_KEYS, CONFIG } from './src/constants.js';
import { getState, updateState, subscribeState } from './src/state.js';
import { 
  initializeDatabase, getMembers, saveMembers, getActivityLogs, saveActivityLogs, 
  getAuditTrails, saveAuditTrails, getBadges, saveBadges, getCurrentAdmin, setCurrentAdmin,
  cleanName, getNormalizedName, detectDateFromText, getYesterdayDateStr, getDiffDays, 
  dataURLtoBlob, deduplicateMembers, registerSyncEnqueueHandler
} from './src/database.js';
import { 
  getSupabase, setupSupabaseRealtime, initSupabaseConfig, testSupabaseConnection, 
  performSmartSync, pullFromSupabase, silentPullFromSupabase, pushToSupabase, enqueueSyncJob,
  wipeDatabaseAll
} from './src/supabase.js';
import { 
  handleAddMember, handleBulkAddMembers, parseBulkActivityText, submitBulkActivity,
  analyzeUnregisteredDuplicates
} from './src/member.js';
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
  
  updateState({
    members: cleanedMembers,
    auditTrails: getAuditTrails(),
    currentAdminEmail: getCurrentAdmin()
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
  const nonFrozenMembers = state.members.filter(m => m.status !== 'frozen');
  const totalCount = nonFrozenMembers.length;
  const activeCount = nonFrozenMembers.filter(m => m.status === 'active').length;
  const inactiveCount = nonFrozenMembers.filter(m => m.status === 'inactive' || m.status === 'warning').length;
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

    ${state.duplicateResolutionModal ? `
    <!-- Custom beautiful duplicate resolution modal -->
    <div id="duplicate-resolution-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
        <div class="flex items-center gap-3 text-amber-500 border-b border-slate-800 pb-3">
          <i data-lucide="alert-triangle" class="w-6 h-6 animate-pulse"></i>
          <h3 class="font-extrabold text-slate-100 text-sm tracking-wide uppercase">⚠️ Duplicate Member Name Detected</h3>
        </div>
        <p class="text-[11px] text-slate-300 font-medium leading-relaxed">
          নিচের নামগুলো একাধিকবার পাওয়া গেছে। অনুগ্রহ করে প্রতিটি Member-এর জন্য আলাদা নাম নির্ধারণ করুন অথবা প্রয়োজনে Skip করুন।
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
                    <span class="text-[10px] text-slate-400 font-mono">Occur ${occIdx + 1}</span>
                    
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
  `;

  // Hot Reload Icons
  lucide.createIcons();
  
  // Bind dynamic interactive events
  bindEvents();
}

// Sub-Tab HTML Render templates
function renderTabContent(totalCount, activeCount, inactiveCount, diamondCount) {
  switch (state.currentTab) {
    
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
                      <div>
                        <p class="font-bold text-slate-200 text-xs sm:text-sm">${m.name}</p>
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
      // Inactive members query calculations (Excluding frozen members)
      const warningMembers = state.members.filter(m => m.status !== 'frozen' && m.consecutive_inactive_days >= state.noticeFilterDays);
      
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

          <!-- Notice Content Box & Freeze Panel stacked -->
          <div class="lg:col-span-8 space-y-6">
            <!-- Notice Output -->
            <div class="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
              <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                <span class="text-xs font-bold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider font-sans">
                  <i data-lucide="calendar" class="w-3.5 h-3.5 text-indigo-400"></i> Notice Output
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

              <div class="max-h-[200px] overflow-y-auto space-y-2 pr-1 font-mono text-xs">
                ${warningMembers.length > 0 ? warningMembers.map(m => {
                  const isChecked = (state.selectedFreezeMemberIds || []).includes(m.id);
                  return `
                    <label class="flex items-center justify-between p-2.5 bg-slate-950/50 border ${isChecked ? 'border-rose-500/35 bg-rose-500/5' : 'border-slate-800'} rounded-xl hover:border-slate-700 transition cursor-pointer select-none">
                      <div class="flex items-center gap-3">
                        <input type="checkbox" data-freeze-member-id="${m.id}" ${isChecked ? 'checked' : ''} class="w-4 h-4 text-indigo-600 bg-slate-950 border-slate-800 rounded focus:ring-indigo-500 cursor-pointer" />
                        <div>
                          <span class="text-slate-200 font-bold font-sans">${m.name}</span>
                          <span class="text-[10px] text-slate-500 ml-1.5 font-mono">No.${m.member_number}</span>
                        </div>
                      </div>
                      <span class="text-rose-400 font-bold bg-rose-500/5 px-2 py-0.5 rounded border border-rose-500/10">${m.consecutive_inactive_days} দিন ইনেক্টিভ</span>
                    </label>
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

  // Duplicate resolution modal interactive events
  if (state.duplicateResolutionModal) {
    // Save button
    const dupSaveBtn = document.getElementById('dup-resolve-save-btn');
    if (dupSaveBtn) {
      dupSaveBtn.onclick = () => {
        const onResolve = state.duplicateResolutionModal.onResolve;
        const duplicates = state.duplicateResolutionModal.duplicates;
        
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
              const existingInDb = state.members.some(m => m.name.toLowerCase() === nameClean.toLowerCase());
              if (existingInDb) {
                hasValidationError = true;
                validationMsg = `"${nameClean}" নামের মেম্বার ইতিমধ্যে ডাটাবেজে রেজিস্টার আছে! অনুগ্রহ করে ইউনিক নাম দিন।`;
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

    // Input changes
    document.querySelectorAll('.rename-occ-input').forEach(inp => {
      inp.oninput = (e) => {
        const dupIdx = parseInt(e.target.getAttribute('data-dup-idx'), 10);
        const occIdx = parseInt(e.target.getAttribute('data-occ-idx'), 10);
        const value = e.target.value;
        
        const nextDuplicates = [...state.duplicateResolutionModal.duplicates];
        nextDuplicates[dupIdx].occurrences[occIdx].resolvedName = value;
        updateState({
          duplicateResolutionModal: {
            ...state.duplicateResolutionModal,
            duplicates: nextDuplicates
          }
        });
        const refreshedInput = document.querySelector(`.rename-occ-input[data-dup-idx="${dupIdx}"][data-occ-idx="${occIdx}"]`);
        if (refreshedInput) {
          refreshedInput.focus();
          refreshedInput.setSelectionRange(value.length, value.length);
        }
      };
    });

    // Skip / Undo toggle
    document.querySelectorAll('.toggle-skip-btn').forEach(btn => {
      btn.onclick = (e) => {
        const dupIdx = parseInt(e.currentTarget.getAttribute('data-dup-idx'), 10);
        const occIdx = parseInt(e.currentTarget.getAttribute('data-occ-idx'), 10);
        
        const nextDuplicates = [...state.duplicateResolutionModal.duplicates];
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
        // Run unregistered duplicates analysis first
        const duplicates = analyzeUnregisteredDuplicates(state.bulkInputText);
        
        if (duplicates.length > 0) {
          // Construct duplicates list with default occurrences
          const modalDuplicates = duplicates.map(d => {
            const occurrences = [];
            for (let i = 0; i < d.count; i++) {
              occurrences.push({
                id: i,
                originalName: d.name,
                resolvedName: `${d.name} ${i + 1}`, // Default proposal: "Rakib Islam 1", "Rakib Islam 2"
                skipped: false
              });
            }
            return {
              name: d.name,
              count: d.count,
              occurrences
            };
          });

          updateState({
            duplicateResolutionModal: {
              duplicates: modalDuplicates,
              onResolve: (resolvedDuplicates) => {
                // Helper to escape regex
                const escapeRegExp = (string) => {
                  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                };

                // 1. Bulk register the resolved names!
                const members = getMembers();
                const auditTrails = getAuditTrails();
                const adminName = ADMIN_NAMES[state.currentAdminEmail] || 'Unknown Admin';
                let maxMemberNum = members.reduce((max, m) => m.member_number > max ? m.member_number : max, 0);

                resolvedDuplicates.forEach(dup => {
                  dup.occurrences.forEach(occ => {
                    if (!occ.skipped) {
                      maxMemberNum++;
                      const cleaned = cleanName(occ.resolvedName);
                      members.push({
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
                  });
                });

                saveMembers(members);
                saveAuditTrails(auditTrails);

                showToast('ডুপ্লিকেট মেম্বারদের ইউনিক নাম দিয়ে রেজিস্টার করা হয়েছে!', 'success');

                // 2. Map the occurrences in the daily submission activity list!
                let nextText = state.bulkInputText;
                
                resolvedDuplicates.forEach(dup => {
                  dup.occurrences.forEach(occ => {
                    const regex = new RegExp(`@${escapeRegExp(dup.name)}`, 'i');
                    if (occ.skipped) {
                      nextText = nextText.replace(regex, '');
                    } else {
                      nextText = nextText.replace(regex, `@${occ.resolvedName}`);
                    }
                  });
                });

                updateState({
                  bulkInputText: nextText,
                  members: getMembers(),
                  auditTrails: getAuditTrails()
                });

                // 3. Re-run parsing on the updated text and proceed
                const { matchedMembers } = parseBulkActivityText(nextText);
                if (matchedMembers.length === 0) return;

                const frozenInList = matchedMembers.filter(m => m.status === 'frozen');
                
                const proceedWithSubmission = () => {
                  if (frozenInList.length > 0) {
                    const checkAndProcessFrozen = (index, currentMatchedIds, toReactivateIds) => {
                      if (index >= frozenInList.length) {
                        if (toReactivateIds.length > 0) {
                          const mList = getMembers();
                          toReactivateIds.forEach(id => {
                            const idx = mList.findIndex(m => m.id === id);
                            if (idx !== -1) {
                              mList[idx].status = 'active';
                              mList[idx].consecutive_inactive_days = 0;
                              mList[idx].updated_at = new Date().toISOString();
                            }
                          });
                          saveMembers(mList);
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

                showConfirm(
                  `আপনি কি সত্যিই নির্বাচিত তারিখ (${state.bulkInputDate}) এ ${matchedMembers.length} জন মেম্বারের ডেইলি এক্টিভিটি সেভ করতে চান?`,
                  () => {
                    proceedWithSubmission();
                  },
                  null,
                  'এক্টিভিটি সেভ করুন'
                );
              }
            }
          });
          return;
        }

        // Standard flow when no duplicates exist
        const { matchedMembers } = parseBulkActivityText(state.bulkInputText);
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

        showConfirm(
          `আপনি কি সত্যিই নির্বাচিত তারিখ (${state.bulkInputDate}) এ ${matchedMembers.length} জন মেম্বারের ডেইলি এক্টিভিটি সেভ করতে চান?`,
          () => {
            proceedWithSubmission();
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
        updateState({ noticeFilterDays: Number(e.target.value), copiedNotice: false, selectedFreezeMemberIds: [] });
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
      showToast('ইমেজ তৈরি হচ্ছে...', 'info');

      setTimeout(() => {
        const html2canvasFn = window.html2canvas || (typeof html2canvas !== 'undefined' ? html2canvas : null);
        if (!html2canvasFn) {
          showToast('ডাউনলোড ব্যর্থ: html2canvas লাইব্রেরি লোড হয়নি। দয়া করে পেজটি রিলোড দিন।', 'error');
          updateState({ isDownloadingReport: false });
          return;
        }

        const filename = `${selectedMember.name.replace(/\s+/g, '_')}_Performance_Card.png`;

        html2canvasFn(reportCard, {
          scale: 3,
          useCORS: true,
          backgroundColor: null,
          logging: false
        }).then(canvas => {
          const imgData = canvas.toDataURL('image/png');
          
          const a = document.createElement('a');
          a.href = imgData;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          showToast(`"${filename}" ডাউনলোড হচ্ছে!`, 'success');

          // Open state modal with the image URL for mobile users or cross-origin fallbacks
          updateState({ 
            isDownloadingReport: false,
            generatedPngUrl: imgData,
            generatedPngMemberName: selectedMember.name
          });
        }).catch(err => {
          console.error('Canvas image generation failed:', err);
          showToast('ইমেজ সেভ করতে সমস্যা হয়েছে।', 'error');
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
            const { data, error } = await client.from('admins').select('*').eq('email', email);
            if (!error && data && data.length > 0) {
              const matchedAdmin = data[0];
              const dbPass = matchedAdmin.password || matchedAdmin.pass;
              if (dbPass && String(dbPass).trim() === String(password).trim()) {
                success = true;
              }
            }
          } catch (err) {
            console.warn('Supabase admins table check failed, using fallback list:', err);
          }
        }

        const isPredefinedAdmin = Object.keys(ADMIN_NAMES).includes(email);
        const isDefaultPassword = ['linkbox123', '123456', 'admin123'].includes(password);
        
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
}

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
});
