'use client';

import { useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { useAuthStore } from '@/stores/use-auth-store';
import { createClient } from '@/lib/supabase/client';
import { identify, reset as resetAnalytics, setPersonProperties } from '@/lib/analytics';

/**
 * The workspace facts PostHog keeps on the person, so its cohorts can pick,
 * for instance, the people whose plan ends: ids and states, never a name.
 */
export interface AnalyticsPerson {
  organizationId: string;
  plan: string;
  /** Stripe's status (active, trialing, past_due, canceled…); null self-hosted. */
  subscriptionStatus: string | null;
  /** The plan was cancelled and runs to the end of its period. */
  cancelAtPeriodEnd: boolean;
  role: string;
}

/** The person's properties as PostHog stores them. */
export function personProperties(person: AnalyticsPerson): Record<string, unknown> {
  return {
    organization_id: person.organizationId,
    plan: person.plan,
    subscription_status: person.subscriptionStatus,
    cancel_at_period_end: person.cancelAtPeriodEnd,
    team_role: person.role,
  };
}

interface AuthProviderProps {
  user: User | null;
  /** Where the dashboard knows it: the workspace's plan, kept on the person in PostHog. */
  person?: AnalyticsPerson;
}

export function AuthProvider({ user, person }: AuthProviderProps) {
  const { setUser, setLoading } = useAuthStore();
  // Read when PostHog identifies the person, which can come after the first render.
  const personRef = useRef(person);
  useEffect(() => {
    personRef.current = person;
  });

  useEffect(() => {
    setUser(user);
    setLoading(false);
  }, [user, setUser, setLoading]);

  // Bridge Supabase auth state to PostHog so the analytics identity stays in
  // sync with whoever is signed in, regardless of how they got there (form
  // submit, OAuth redirect, page reload with a valid cookie, email-confirm
  // callback, etc.). Without this, only users coming through the sign-in
  // form get a person profile in PostHog and everyone else shows up as a
  // random anonymous distinct_id.
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
        identify(session.user.id, {
          email: session.user.email,
          ...(personRef.current ? personProperties(personRef.current) : {}),
        });
      } else if (event === 'SIGNED_OUT') {
        resetAnalytics();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // The plan as it changes in the session: cancelled, reactivated or bought
  // (the layout reads it again after each).
  const organizationId = person?.organizationId;
  const plan = person?.plan;
  const subscriptionStatus = person?.subscriptionStatus ?? null;
  const cancelAtPeriodEnd = person?.cancelAtPeriodEnd ?? false;
  const role = person?.role;
  useEffect(() => {
    if (!organizationId || !plan || !role) return;
    setPersonProperties(
      personProperties({ organizationId, plan, subscriptionStatus, cancelAtPeriodEnd, role }),
    );
  }, [organizationId, plan, subscriptionStatus, cancelAtPeriodEnd, role]);

  return null;
}
