/**
 * The Action Center's tabs, in order: Actions first (New Ansvisor, AC-ALT2 §3:
 * everything starts at Actions), then Signals, KPIs and History.
 */
export const ACTION_CENTER_TABS = [
  { key: 'actions', href: '/dashboard/action-center/actions' },
  { key: 'signals', href: '/dashboard/action-center/signals' },
  { key: 'kpis', href: '/dashboard/action-center/kpis' },
  { key: 'history', href: '/dashboard/action-center/history' },
] as const;
