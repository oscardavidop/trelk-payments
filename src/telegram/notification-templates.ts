/**
 * notification-templates.ts
 *
 * Premium lifecycle notification templates.
 * All messages are in English for billing consistency.
 * Each template receives structured data and returns a formatted HTML string.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return 'N/A';
  return new Date(dateInput).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtAmount(amount: number | null | undefined, currency = 'USD'): string {
  if (!amount) return '';
  return `$${Number(amount).toFixed(2)} ${currency}`;
}

function planLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

// ── Plan feature summaries ───────────────────────────────────────────────────

const PLAN_FEATURES: Record<string, string[]> = {
  pro: [
    '100 downloads / day',
    '200 AI requests / day',
    '75 premium AI requests / day',
    '50 custom commands',
    'High-priority queue',
    'Priority support',
  ],
  ultra: [
    '200 downloads / day',
    '500 AI requests / day',
    '150 premium AI requests / day',
    '75 custom commands',
    'Ultra-priority queue',
    'Priority support',
    'Live chat access',
  ],
};

// ── Templates ────────────────────────────────────────────────────────────────

export interface ActivatedData {
  planName: string;
  amount?: number | null;
  currency?: string;
  nextBillingDate?: Date | string | null;
}

export function tplSubscriptionActivated(d: ActivatedData): string {
  const plan = planLabel(d.planName);
  const features = PLAN_FEATURES[d.planName.toLowerCase()] ?? [];
  const featureLines = features.map((f) => `  ▸ ${f}`).join('\n');
  const billing = d.nextBillingDate
    ? `\n🗓️  <b>Next payment:</b> ${fmtDate(d.nextBillingDate)}`
    : '';
  const price = d.amount ? `  ${fmtAmount(d.amount, d.currency)} / month` : '';

  return [
    `🎉 <b>Welcome to ${plan}!</b>`,
    '',
    `Your subscription is now <b>active</b>. Here's what you unlocked:`,
    '',
    featureLines,
    '',
    `💳 <b>Plan:</b> ${plan}${price}`,
    billing,
    '',
    `Open the mini app to start using your premium features.`,
    '',
    `Need help? Reply to this message or use <code>/support</code>.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RenewalData {
  planName: string;
  amount: number;
  currency?: string;
  nextBillingDate?: Date | string | null;
}

export function tplPaymentRenewal(d: RenewalData): string {
  const plan = planLabel(d.planName);
  const billing = d.nextBillingDate
    ? `\n🗓️  <b>Next renewal:</b> ${fmtDate(d.nextBillingDate)}`
    : '';

  return [
    `✅ <b>Payment confirmed</b>`,
    '',
    `Your <b>${plan}</b> subscription has been renewed.`,
    '',
    `💳 <b>Amount charged:</b> ${fmtAmount(d.amount, d.currency)}`,
    billing,
    '',
    `Your premium features remain active — no action required.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface CancelledData {
  planName: string;
  accessUntil?: Date | string | null;
}

export function tplSubscriptionCancelled(d: CancelledData): string {
  const plan = planLabel(d.planName);
  const until = d.accessUntil
    ? `\n📅 <b>Access continues until:</b> ${fmtDate(d.accessUntil)}\n\nYour premium features remain active until that date.`
    : '';

  return [
    `📋 <b>Subscription cancelled</b>`,
    '',
    `Your <b>${plan}</b> subscription has been cancelled as requested.`,
    until,
    '',
    `After the access period ends, your account will revert to the Free plan automatically.`,
    '',
    `<b>Changed your mind?</b> You can resubscribe anytime from the mini app.`,
    '',
    `Questions? Use <code>/support</code> and we'll help.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface SuspendedData {
  planName: string;
}

export function tplSubscriptionSuspended(d: SuspendedData): string {
  const plan = planLabel(d.planName);

  return [
    `⏸️ <b>Subscription suspended</b>`,
    '',
    `Your <b>${plan}</b> subscription has been suspended due to a payment issue.`,
    '',
    `<b>What this means:</b>`,
    `  ▸ Premium features are temporarily unavailable`,
    `  ▸ Your data and settings are preserved`,
    `  ▸ No charges will be made while suspended`,
    '',
    `<b>To restore access:</b>`,
    `  1. Update your payment method in PayPal`,
    `  2. Open the mini app and tap <b>Resume Subscription</b>`,
    '',
    `Need help? Use <code>/support</code>.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ResumedData {
  planName: string;
  nextBillingDate?: Date | string | null;
}

export function tplSubscriptionResumed(d: ResumedData): string {
  const plan = planLabel(d.planName);
  const billing = d.nextBillingDate
    ? `\n🗓️  <b>Next billing:</b> ${fmtDate(d.nextBillingDate)}`
    : '';

  return [
    `▶️ <b>Subscription resumed</b>`,
    '',
    `Your <b>${plan}</b> subscription is <b>active</b> again.`,
    '',
    `All premium features have been restored — welcome back!`,
    billing,
    '',
    `Open the mini app to continue where you left off.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ExpiredData {
  planName: string;
}

export function tplSubscriptionExpired(d: ExpiredData): string {
  const plan = planLabel(d.planName);

  return [
    `⏰ <b>Subscription expired</b>`,
    '',
    `Your <b>${plan}</b> subscription has expired and your account has been moved to the Free plan.`,
    '',
    `<b>What you've lost access to:</b>`,
    `  ▸ Premium AI models`,
    `  ▸ Expanded download limits`,
    `  ▸ Custom commands`,
    `  ▸ Priority queue`,
    '',
    `<b>Ready to re-subscribe?</b>`,
    `Open the mini app and tap <b>Upgrade to Pro</b> to restore full access instantly.`,
    '',
    `Questions? Use <code>/support</code>.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentFailedData {
  planName: string;
  amount?: number | null;
  currency?: string;
}

export function tplPaymentFailed(d: PaymentFailedData): string {
  const plan = planLabel(d.planName);
  const amountStr = d.amount ? ` of ${fmtAmount(d.amount, d.currency)}` : '';

  return [
    `⚠️ <b>Payment failed</b>`,
    '',
    `We couldn't process your ${plan} subscription payment${amountStr}.`,
    '',
    `<b>What happens next:</b>`,
    `  ▸ PayPal will retry the payment automatically`,
    `  ▸ If retries fail, your subscription may be suspended`,
    `  ▸ You'll be notified before any access is affected`,
    '',
    `<b>Recommended action:</b>`,
    `  1. Check your PayPal payment method`,
    `  2. Ensure sufficient funds are available`,
    `  3. Update your billing details at paypal.com if needed`,
    '',
    `Need help? Use <code>/support</code> — we'll sort it out.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface UpgradeData {
  fromPlan: string;
  toPlan: string;
  amount?: number | null;
  currency?: string;
  nextBillingDate?: Date | string | null;
}

export function tplPlanUpgraded(d: UpgradeData): string {
  const from = planLabel(d.fromPlan);
  const to = planLabel(d.toPlan);
  const features = PLAN_FEATURES[d.toPlan.toLowerCase()] ?? [];
  const featureLines = features.map((f) => `  ▸ ${f}`).join('\n');
  const billing = d.nextBillingDate
    ? `\n🗓️  <b>Next billing:</b> ${fmtDate(d.nextBillingDate)} — ${fmtAmount(d.amount ?? 0, d.currency)}`
    : '';

  return [
    `⬆️ <b>Plan upgraded to ${to}</b>`,
    '',
    `You've been upgraded from <b>${from}</b> to <b>${to}</b>. New features unlocked:`,
    '',
    featureLines,
    billing,
    '',
    `Changes are effective immediately. Enjoy the extra power! 🚀`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

export interface DowngradeData {
  fromPlan: string;
  toPlan: string;
  effectiveDate?: Date | string | null;
}

export function tplPlanDowngraded(d: DowngradeData): string {
  const from = planLabel(d.fromPlan);
  const to = planLabel(d.toPlan);
  const effective = d.effectiveDate
    ? `\n📅 <b>Effective on:</b> ${fmtDate(d.effectiveDate)}\n\nYou keep all <b>${from}</b> features until then.`
    : '';

  return [
    `⬇️ <b>Plan change scheduled</b>`,
    '',
    `Your plan will change from <b>${from}</b> to <b>${to}</b>.`,
    effective,
    '',
    `<b>Changed your mind?</b> You can upgrade again anytime from the mini app.`,
  ].join('\n');
}
