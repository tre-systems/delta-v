export interface ReconnectOverlayState {
  attempt: number;
  maxAttempts: number;
  onCancel: () => void;
}
