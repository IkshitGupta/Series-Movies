import type { showAlert as NativeShowAlert, showConfirm as NativeShowConfirm } from '@/lib/alert';

// Web versions of `showAlert` / `showConfirm`, using the browser's `alert` and
// `confirm` dialogs. Metro resolves this file for the `web` platform; native
// uses `alert.ts`.

/** Run `show` once the page is visible: a browser may drop a dialog requested
 * from a hidden tab (Chrome's `confirm()` returns false there without asking). */
function whenVisible(show: () => void): void {
  if (document.visibilityState !== 'hidden') {
    show();
    return;
  }
  const onChange = () => {
    if (document.visibilityState === 'hidden') return;
    document.removeEventListener('visibilitychange', onChange);
    show();
  };
  document.addEventListener('visibilitychange', onChange);
}

const dialogText = (title: string, message?: string) =>
  message ? `${title}\n\n${message}` : title;

export const showAlert: typeof NativeShowAlert = (title, message) => {
  whenVisible(() => window.alert(dialogText(title, message)));
};

/** The browser's dialog has its own OK / Cancel buttons; OK runs `onConfirm`. */
export const showConfirm: typeof NativeShowConfirm = (title, message, { onConfirm }) => {
  whenVisible(() => {
    if (window.confirm(dialogText(title, message))) onConfirm();
  });
};
