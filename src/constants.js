// Support Link Box - Constants and Configuration

export const ADMIN_NAMES = {
  'shihab@linkbox.com': 'Md Shihab Khan',
  'mamun@linkbox.com': 'Mamun Aravi',
  'shuvo@linkbox.com': 'Shuvo Sutradhar',
  'shadat@linkbox.com': 'ShaDat Hossain',
  'rubel@linkbox.com': 'Ariyan Ahmed Rubel',
  'hanif@linkbox.com': 'Mohammad Abu Hanif'
};

export const STORAGE_KEYS = {
  MEMBERS: 'support_linkbox_members',
  LOGS: 'support_linkbox_logs',
  AUDIT: 'support_linkbox_audit',
  BADGES: 'support_linkbox_badges',
  CURRENT_ADMIN: 'support_linkbox_current_admin',
  SUPABASE_URL: 'support_linkbox_supabase_url',
  SUPABASE_KEY: 'support_linkbox_supabase_key',
  SUPABASE_SYNC_ENABLED: 'support_linkbox_supabase_sync_enabled',
  SYNC_QUEUE: 'support_linkbox_sync_queue'
};

// Default credentials
export const DEFAULT_SUPABASE_URL = 'https://qjqjyvxqeleasnodyexq.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'sb_publishable_UpxW8v9KvV6AAeLlTNNTvA_basZF9bF';

// Status Calculation Thresholds & Magic Numbers
export const CONFIG = {
  ACTIVE_DAYS_THRESHOLD: 1,      // Max days since last active for active status
  INACTIVE_DAYS_THRESHOLD: 3,    // Days since last active to mark inactive/warning
  STREAK_STRICT_DAYS: 2,         // Max days between activities to maintain streak
  POINTS: {
    DAILY_ACTIVITY: 10,
    LONG_STREAK_BONUS_10: 50,    // 10 day streak bonus
    LONG_STREAK_BONUS_30: 150,   // 30 day streak bonus
    LONG_STREAK_BONUS_50: 300,   // 50 day streak bonus
    LONG_STREAK_BONUS_100: 1000  // 100 day streak bonus
  },
  LEVELS: {
    BRONZE: 'Bronze',
    SILVER: 'Silver',
    GOLD: 'Gold',
    PLATINUM: 'Platinum',
    DIAMOND: 'Diamond'
  },
  LEVEL_POINTS: {
    SILVER: 100,
    GOLD: 300,
    PLATINUM: 600,
    DIAMOND: 1200
  }
};
