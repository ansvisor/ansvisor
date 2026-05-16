"use client";

import { useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { useAuthStore } from "@/stores/use-auth-store";
import { createClient } from "@/lib/supabase/client";
import { identify, reset as resetAnalytics } from "@/lib/analytics";

interface AuthProviderProps {
  user: User | null;
}

export function AuthProvider({ user }: AuthProviderProps) {
  const { setUser, setLoading } = useAuthStore();

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
      if (
        (event === "INITIAL_SESSION" || event === "SIGNED_IN") &&
        session?.user
      ) {
        identify(session.user.id, {
          email: session.user.email,
        });
      } else if (event === "SIGNED_OUT") {
        resetAnalytics();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return null;
}
