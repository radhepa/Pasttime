import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  /** e.g. "Undo" */
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, action?: Toast['action']) {
  const t = { id: nextId++, text, action };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), action ? 5000 : 2200);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
}
