import type { Session } from '@supabase/supabase-js';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';

import { fetchOwnProfile } from '@/lib/api';
import { env } from '@/lib/env';
import { stopAllTracking } from '@/lib/location';
import { unregisterPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

interface AuthState {
  /** True until the stored session (and profile, if any) has been loaded. */
  initializing: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Set when the profile could not be loaded (e.g. offline at launch). */
  profileError: unknown;
  /**
   * True while a password-reset code is being exchanged: verifying the code
   * signs the person in, but they must stay on the reset screen until the new
   * password is saved.
   */
  recoveryInProgress: boolean;
  setRecoveryInProgress: (v: boolean) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [initializing, setInitializing] = useState(env.isConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<unknown>(null);
  const [recoveryInProgress, setRecoveryInProgress] = useState(false);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    try {
      setProfile(await fetchOwnProfile(s.user.id));
      setProfileError(null);
    } catch (e) {
      setProfileError(e);
    }
  }, []);

  useEffect(() => {
    if (!env.isConfigured) return;
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Don't await inside the callback (supabase-js warns about deadlocks).
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(() => loadProfile(s), 0);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // Stop background location and detach this device's push token first,
    // while we still have a session to do it with.
    await stopAllTracking().catch(() => undefined);
    await unregisterPush().catch(() => undefined);
    // Local sign-out still succeeds when offline; the server session expires.
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: 'local' });
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{
        initializing,
        session,
        profile,
        profileError,
        recoveryInProgress,
        setRecoveryInProgress,
        refreshProfile,
        signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
