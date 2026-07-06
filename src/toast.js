// Support Link Box - Custom Toast System

import { getState, updateState } from './state.js';

export function showToast(message, type = 'success') {
  updateState({ toast: { message, type } });
  
  setTimeout(() => {
    const state = getState();
    if (state.toast && state.toast.message === message) {
      updateState({ toast: null });
    }
  }, 4000);
}
