'use client';

import { createContext, useContext } from 'react';
import type { PlanId } from '@/config/plans';

interface PlanContextValue {
  planId: PlanId;
  isCloud: boolean;
  /**
   * Effective API-model allowlist for the org, with Enterprise
   * `plan_overrides` already merged server-side (dashboard layout).
   * `null` means every model is allowed (self-host, or a plan without an
   * `allowedModels` restriction). Consumers must read this instead of the
   * static `PLANS[planId].limits.allowedModels`, which can't see
   * per-customer overrides.
   */
  allowedModelIds: string[] | null;
  /**
   * Whether the org's plan is active (or trialing). When it isn't, the
   * dashboard is read-only: every page opens, and an action opens the
   * upgrade dialog instead of running (useUpgradeGate). Always true
   * self-hosted.
   */
  subscriptionActive: boolean;
  /** Stripe's subscription status, for why it isn't active; null self-hosted. */
  subscriptionStatus: string | null;
}

const PlanContext = createContext<PlanContextValue>({
  planId: 'self_hosted',
  isCloud: false,
  allowedModelIds: null,
  subscriptionActive: true,
  subscriptionStatus: null,
});

export function PlanProvider({
  planId,
  allowedModelIds = null,
  subscriptionActive = true,
  subscriptionStatus = null,
  children,
}: {
  planId: PlanId;
  allowedModelIds?: string[] | null;
  subscriptionActive?: boolean;
  subscriptionStatus?: string | null;
  children: React.ReactNode;
}) {
  const isCloud = process.env.NEXT_PUBLIC_IS_CLOUD === 'true';
  const effectivePlan: PlanId = isCloud ? planId : 'self_hosted';

  return (
    <PlanContext.Provider
      value={{
        planId: effectivePlan,
        isCloud,
        allowedModelIds: isCloud ? allowedModelIds : null,
        subscriptionActive: isCloud ? subscriptionActive : true,
        subscriptionStatus: isCloud ? subscriptionStatus : null,
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlanContext() {
  return useContext(PlanContext);
}
