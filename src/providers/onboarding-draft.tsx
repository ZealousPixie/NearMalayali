// Holds onboarding answers between steps until complete_onboarding() runs.
import { createContext, type PropsWithChildren, useContext, useState } from 'react';

export interface OnboardingDraft {
  username: string;
  displayName: string;
  dateOfBirth: Date | null;
}

const DraftContext = createContext<{
  draft: OnboardingDraft;
  setDraft: (d: OnboardingDraft) => void;
} | null>(null);

export function useOnboardingDraft() {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useOnboardingDraft outside onboarding');
  return ctx;
}

export function OnboardingDraftProvider({ children }: PropsWithChildren) {
  const [draft, setDraft] = useState<OnboardingDraft>({ username: '', displayName: '', dateOfBirth: null });
  return <DraftContext.Provider value={{ draft, setDraft }}>{children}</DraftContext.Provider>;
}
