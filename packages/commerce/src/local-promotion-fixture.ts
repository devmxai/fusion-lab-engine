import type { PromotionVersion } from "./types.ts";

export const localPromotionVersions: readonly PromotionVersion[] = [
  {
    id: "promotion:local-video-launch:v1",
    campaignKey: "local-video-launch",
    version: 1,
    code: "LOCAL50",
    lifecycle: "PUBLISHED",
    discountCredits: 20,
    budget: { credits: 40, microusd: "150000" },
    window: {
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2099-01-01T00:00:00.000Z",
    },
    eligibility: {
      products: ["video.generate"],
      routes: ["route:local/test-video-v1:v1"],
      cohorts: ["local-development"],
    },
    caps: { perUserRedemptions: 1, globalRedemptions: 2 },
    stacking: { mode: "EXCLUSIVE", allowedCampaignKeys: [] },
    fraudRules: {
      blockedUserIds: ["local-fraud-blocked"],
      maxReservationsPerUserPerUtcDay: 2,
    },
    attribution: "local-stage-12-4",
    stopCondition: { minimumRemainingCredits: 0, minimumRemainingMicrousd: "0" },
    approvals: {
      createdBy: "local-growth-maker",
      approvedBy: ["local-finance-approver", "local-risk-approver"],
      publishedAt: "2026-08-01T00:00:00.000Z",
    },
    killSwitch: { enabled: false, reasonCode: null },
  },
] as const;
