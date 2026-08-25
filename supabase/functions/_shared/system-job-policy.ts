export type SystemJob = "all" | "cleanup-reservations" | "expire-subscriptions" | "reconciliation";

export type SystemJobPlan = {
  job: SystemJob;
  holdStaleReservations: boolean;
  holdSubscriptionExpiry: boolean;
  runReconciliation: boolean;
};

const supportedJobs = new Set<SystemJob>(["all", "expire-subscriptions", "cleanup-reservations", "reconciliation"]);

export function resolveSystemJobPlan(job: unknown): SystemJobPlan | null {
  if (typeof job !== "string" || !supportedJobs.has(job as SystemJob)) return null;
  const selectedJob = job as SystemJob;
  return {
    job: selectedJob,
    holdSubscriptionExpiry: selectedJob === "all" || selectedJob === "expire-subscriptions",
    holdStaleReservations: selectedJob === "all" || selectedJob === "cleanup-reservations",
    runReconciliation: selectedJob === "all" || selectedJob === "reconciliation",
  };
}
