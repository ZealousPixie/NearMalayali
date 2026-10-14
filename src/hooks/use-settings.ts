// Load-once / save-on-change pattern for settings rows. Changes are applied
// optimistically and rolled back if the server rejects them, so the screen
// never shows a setting that wasn't actually saved.
import { useCallback, useState } from 'react';

import { friendlyError } from '@/lib/errors';

import { useAsync } from './use-async';

export function useSettings<T extends object>(
  load: () => Promise<T>,
  save: (patch: Partial<T>) => Promise<T | void>,
) {
  const { data, error: loadError, reload, setData: setValue } = useAsync(load);
  const value = data ?? null;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const update = useCallback(
    async (patch: Partial<T>) => {
      if (!value) return;
      const previous = value;
      setValue({ ...value, ...patch });
      setSaving(true);
      setSaveError(null);
      try {
        const result = await save(patch);
        if (result) setValue(result);
      } catch (e) {
        setValue(previous);
        setSaveError(friendlyError(e));
      } finally {
        setSaving(false);
      }
    },
    [value, save, setValue],
  );

  return { value, loadError, saveError, saving, reload, update };
}
