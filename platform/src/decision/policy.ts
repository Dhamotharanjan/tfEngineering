// Policy dials. Loaded from config / UI. Conservative, non-customer defaults.
export interface Policy {
  block: {
    onBreaking: boolean;
    onDisturbedPattern: boolean;
  };
  // When true, UNKNOWN escalates to BLOCK; when false, UNKNOWN is WARN only.
  // Default false: we never guess BREAKING; we warn and enqueue an async refresh.
  failClosedOnUnknown: boolean;
  notify: {
    prAuthorOnImpact: boolean;
    consumerOwnersOnBreakingOrUnknown: boolean;
    architectOnDisturbedPattern: boolean;
  };
}

export const DEFAULT_POLICY: Policy = {
  block: {
    onBreaking: true,
    onDisturbedPattern: true,
  },
  failClosedOnUnknown: false,
  notify: {
    prAuthorOnImpact: true,
    consumerOwnersOnBreakingOrUnknown: true,
    architectOnDisturbedPattern: true,
  },
};

export function mergePolicy(base: Policy, override: DeepPartial<Policy> | undefined): Policy {
  if (!override) return base;
  return {
    block: {
      onBreaking: override.block?.onBreaking ?? base.block.onBreaking,
      onDisturbedPattern: override.block?.onDisturbedPattern ?? base.block.onDisturbedPattern,
    },
    failClosedOnUnknown: override.failClosedOnUnknown ?? base.failClosedOnUnknown,
    notify: {
      prAuthorOnImpact: override.notify?.prAuthorOnImpact ?? base.notify.prAuthorOnImpact,
      consumerOwnersOnBreakingOrUnknown:
        override.notify?.consumerOwnersOnBreakingOrUnknown ?? base.notify.consumerOwnersOnBreakingOrUnknown,
      architectOnDisturbedPattern:
        override.notify?.architectOnDisturbedPattern ?? base.notify.architectOnDisturbedPattern,
    },
  };
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
