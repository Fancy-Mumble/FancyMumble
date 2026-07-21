import { create } from "zustand";

export interface PromptOptions {
  readonly title: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

interface PromptState {
  readonly open: boolean;
  readonly options: PromptOptions | null;
  readonly resolve: ((value: string | null) => void) | null;
  openPrompt: (options: PromptOptions) => Promise<string | null>;
  confirm: (value: string) => void;
  cancel: () => void;
}

export const usePromptDialogStore = create<PromptState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  openPrompt: (options) =>
    new Promise<string | null>((resolve) => {
      get().resolve?.(null);
      set({ open: true, options, resolve });
    }),
  confirm: (value) => {
    const { resolve } = get();
    resolve?.(value);
    set({ open: false, options: null, resolve: null });
  },
  cancel: () => {
    const { resolve } = get();
    resolve?.(null);
    set({ open: false, options: null, resolve: null });
  },
}));

/**
 * Open the native prompt dialog and resolve with the trimmed input value, or
 * `null` if the user cancelled.  A `<PromptDialog/>` host must be mounted.
 */
export function openPrompt(options: PromptOptions): Promise<string | null> {
  return usePromptDialogStore.getState().openPrompt(options);
}
