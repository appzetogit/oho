/**
 * Fixed login OTPs for app-store review accounts, from Backend/.env:
 *
 *   REVIEW_LOGIN_OTPS=<10-digit phone>:<4-digit code>[,<phone>:<code>...]
 *
 * Only the listed numbers are affected, and no SMS is sent to them. Anyone who
 * knows the number and code can sign in to that account, so list only accounts
 * made for review and remove the setting once the review is over.
 */
export const getReviewOtp = (phone, config = process.env.REVIEW_LOGIN_OTPS) => {
  const digits = String(phone || '').replace(/\D/g, '');
  const normalizedPhone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^\d{10}$/.test(normalizedPhone)) return null;

  for (const entry of String(config || '').split(',')) {
    const match = /^(\d{10}):(\d{4})$/.exec(entry.trim());
    if (match && match[1] === normalizedPhone) return match[2];
  }
  return null;
};
