// Support Link Box - Custom Modal Alert & Confirm Systems

import { updateState } from './state.js';

export function showAlert(message, title = 'সতর্কতা', onOk = null) {
  updateState({
    confirmModal: {
      title,
      message,
      onConfirm: () => {
        updateState({ confirmModal: null });
        if (onOk) onOk();
      },
      onCancel: () => {
        updateState({ confirmModal: null });
        if (onOk) onOk();
      },
      confirmText: 'ঠিক আছে',
      cancelText: '' // Empty means alert modal (no cancel button)
    }
  });
}

export function showConfirm(message, onConfirm, onCancel = null, title = 'অনুমোদন দিন', confirmText = 'নিশ্চিত করুন', cancelText = 'বাতিল') {
  updateState({
    confirmModal: {
      title,
      message,
      onConfirm: () => {
        updateState({ confirmModal: null });
        if (onConfirm) onConfirm();
      },
      onCancel: () => {
        updateState({ confirmModal: null });
        if (onCancel) onCancel();
      },
      confirmText,
      cancelText
    }
  });
}
