// How much one background run may do (docs/ADMIN-PHASE-5.md §3).
//
// On Cloudflare's Workers Free plan one run (a page request, or a cron run) may call outside services
// (Razorpay, Resend) at most 50 times. Database queries count separately (Cloudflare's Workers limits
// page gives 1,000 calls to its own services per run on Free; its D1 page still says 50 queries). If
// System health ever shows "Too many API requests" or "Too many subrequests" for a job, lower these.
// The 10-minute cron run shares those 50 between payment checks, institute payment checks, email
// retries, announcements and campaigns, so each gets a small slice below. On Workers Paid the limit
// is 10,000: set the variable WORKERS_PLAN = paid in Cloudflare and the larger batches apply.
//
// Nothing is lost when a batch is small: whatever is left waits for the next run, ten minutes later.

export const paidPlan = (env) => String((env && env.WORKERS_PLAN) || '').trim().toLowerCase() === 'paid';

const FREE = { reconcile: 6, instituteReconcile: 4, instituteInvoices: 4, emailRetries: 6, announcements: 10, campaigns: 10 };
const PAID = { reconcile: 25, instituteReconcile: 25, instituteInvoices: 25, emailRetries: 50, announcements: 100, campaigns: 40 };

/** The batch sizes for this deployment: { reconcile, instituteReconcile, instituteInvoices, emailRetries, announcements, campaigns }. */
export const perRun = (env) => (paidPlan(env) ? PAID : FREE);

/** Outside calls one run may make on the free plan, and the most the 10-minute run plans to use. */
export const FREE_OUTSIDE_CALLS = 50;
export const freePlanBudget = () => Object.values(FREE).reduce((s, n) => s + n, 0);
