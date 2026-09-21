import type { Session, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { hasSupabase, supabase } from '@/api/supabase';

export interface AuthState {
  session: Session | null;
  user: User | null;
  /** True until the initial session check completes. */
  loading: boolean;
}

/**
 * Subscribes to Supabase auth state (session + user) with an initial-load flag.
 * When Supabase isn't configured, resolves immediately with no session so the
 * app can fall back to a local-only experience instead of hanging.
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(hasSupabase());

  useEffect(() => {
    // When Supabase isn't configured, `loading` already initialised to false.
    if (!hasSupabase()) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        // Never leave the app stuck on a blank loading screen if the initial
        // session read fails (e.g. corrupt stored token) — fall back to no session.
        if (!active) return;
        setSession(null);
        setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}

/**
 * The user's display name: their chosen username, falling back to the local part
 * of their email (e.g. `test1@seenit.app` → `test1`), then a generic label.
 */
export function displayName(user: User | null): string {
  if (!user) return 'You';
  const username = user.user_metadata?.username;
  if (typeof username === 'string' && username.trim()) return username.trim();
  const email = user.email;
  if (email && email.includes('@')) return email.split('@')[0];
  return 'You';
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{2,20}$/;

/**
 * Map a Supabase auth error to a friendly, user-facing message. Falls back to
 * the raw message for anything we don't specifically handle.
 */
export function friendlyAuthError(message: string, mode: 'signin' | 'signup'): string {
  const m = message.toLowerCase();
  if (m.includes('already registered') || m.includes('already exists') || m.includes('user_already')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'Incorrect email or password.';
  }
  if (m.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }
  if (m.includes('password') && (m.includes('should be') || m.includes('at least') || m.includes('weak'))) {
    return 'Password must be at least 6 characters.';
  }
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('email address') && m.includes('invalid')) {
    return 'Enter a valid email address.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to')) {
    return 'Network error. Check your connection and try again.';
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'New sign-ups are currently disabled.';
  }
  // Fall back to the original message (capitalized) for anything unmapped.
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/**
 * Validate a display-name username. Returns an error message, or null if valid.
 */
export function validateUsername(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Choose a username.';
  if (name.length < 2) return 'Username must be at least 2 characters.';
  if (name.length > 20) return 'Username must be at most 20 characters.';
  if (!USERNAME_RE.test(name)) {
    return 'Use only letters, numbers, and . _ -';
  }
  return null;
}

