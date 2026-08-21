// Support Link Box - Central Reactive State Machine

import { STORAGE_KEYS, DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY } from './constants.js';

let state = {
  isLoggedIn: localStorage.getItem('support_linkbox_logged_in') === 'true',
  currentTab: 'leaderboards',
  isFabOpen: false,
  isHeaderMenuOpen: false,
  currentAdminEmail: localStorage.getItem(STORAGE_KEYS.CURRENT_ADMIN) || 'shihab@linkbox.com',
  members: [],
  auditTrails: [],
  searchQueryMembers: '',
  memberFilterStatus: 'all',
  editingNotesMemberId: null,
  editingNotesText: '',
  bulkInputText: '',
  bulkInputDate: new Date().toISOString().split('T')[0],
  noticeFilterDays: 3,
  noticeFilterMode: 'above',
  noticeType: 'simple',
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
  supabaseUrl: localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || DEFAULT_SUPABASE_URL,
  supabaseKey: localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || DEFAULT_SUPABASE_KEY,
  supabaseSyncEnabled: localStorage.getItem(STORAGE_KEYS.SUPABASE_SYNC_ENABLED) !== 'false',
  supabaseConnectionStatus: 'idle',
  supabaseConnectionError: '',
  supabaseSyncing: false,
  loadedFromEnv: !localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) && !localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY),
  showUrlInput: false,
  showKeyInput: false,
  uncheckedUnregisteredNames: [],
  developerUnlocked: typeof sessionStorage !== 'undefined' && sessionStorage.getItem('developer_unlocked') === 'true',
  selectedFreezeMemberIds: [],
  toast: null,
  confirmModal: null,
  duplicateResolutionModal: null,
  unregisteredResolutionModal: null,
  submissionPreviewModal: null,
  memberProfileModal: null,
  activityDetailModal: null,
  bulkEditSession: null
};

const listeners = new Set();

export function getState() {
  return state;
}

export function updateState(newState) {
  state = { ...state, ...newState };
  listeners.forEach(listener => {
    try {
      listener(state);
    } catch (err) {
      console.error('State listener error:', err);
    }
  });
}

export function subscribeState(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
