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
}

const PlanContext = createContext<PlanContextValue>({
  planId: 'self_hosted',
  isCloud: false,
  allowedModelIds: null,
});

export function PlanProvider({
  planId,
  allowedModelIds = null,
  children,
}: {
  planId: PlanId;
  allowedModelIds?: string[] | null;
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
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlanContext() {
  return useContext(PlanContext);
}
