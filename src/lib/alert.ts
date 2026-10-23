import { Alert } from 'react-native';

// Metro resolves `alert.web.ts` for web, where react-native-web's `Alert.alert`
// does nothing.

export interface ConfirmOptions {
  /** Label of the button that runs `onConfirm` (web shows the browser's OK). */
  confirmText: string;
  /** Style that button as destructive (red on iOS). */
  destructive?: boolean;
  onConfirm: () => void;
}

/** Show a message with an OK button. */
export function showAlert(title: string, message?: string): void {
  Alert.alert(title, message);
}

/** Ask before an action: Cancel, or `confirmText`, which runs `onConfirm`. */
export function showConfirm(
  title: string,
  message: string,
  { confirmText, destructive = false, onConfirm }: ConfirmOptions,
): void {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
