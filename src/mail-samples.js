// Sample data and a short description for every email template, used by the console's email
// previews (Emails → Templates). Nothing here is sent; the samples only fill a template so the
// layout can be checked. A test fails when a template has no sample here (docs/ADMIN-PHASE-5.md §5).

const day = (n) => new Date(Date.UTC(2026, 10, 19 + n, 4, 30)).toISOString();

export const SAMPLES = {
  welcome: { name: 'Asha Verma' },
  verify_email: { name: 'Asha Verma', link: '/verify-email#token=sample', code: '482913' },
  otp_login: { name: 'Asha Verma', code: '275301' },
  admin_otp: { name: 'Rahul', code: '640118', device: 'Chrome on Windows' },
  login_alert: { name: 'Asha Verma', device: 'Chrome on Windows', time: day(0), location: 'IN' },
  password_reset: { name: 'Asha Verma', link: '/reset-password#token=sample' },
  password_changed: { name: 'Asha Verma', time: day(0) },
  security_alert: { name: 'Asha Verma', title: 'Several wrong passwords', message: 'Someone typed a wrong password for your account 5 times in a few minutes. If it was not you, change your password.' },
  email_changed: { name: 'Asha Verma', oldEmail: 'asha.old@example.com', newEmail: 'asha@example.com' },
  payment_success: { name: 'Asha Verma', packageName: 'Pro', amountPaise: 19900, orderId: 'order_SAMPLE123', invoiceNumber: 'TC-2026-000123', startsAt: day(0), expiresAt: day(90) },
  payment_failed: { name: 'Asha Verma', packageName: 'Pro', amountPaise: 19900, reason: 'The bank declined the payment.' },
  invoice: { name: 'Asha Verma', invoiceNumber: 'TC-2026-000123', amountPaise: 19900, issuedAt: day(0), lines: [{ description: 'TypeCraft Pro, 90 days', amountPaise: 19900 }] },
  subscription_renewal_reminder: { name: 'Asha Verma', packageName: 'Pro', expiresAt: day(3) },
  subscription_expired: { name: 'Asha Verma', packageName: 'Pro', expiredAt: day(0) },
  refund_processed: { name: 'Asha Verma', amountPaise: 19900, orderId: 'order_SAMPLE123', reason: 'Paid twice by mistake.' },
  announcement: { name: 'Asha Verma', subject: 'New practice packs for SSC', body: 'We added 40 new passages for SSC CGL and CHSL practice.\n\nOpen Practice to try them: https://typecrafttyping.in/practice' },
  account_update: { name: 'Asha Verma', title: 'Your plan was extended', message: 'We added 7 days to your Pro plan because of the outage last week.', ctaLabel: 'Open your account', ctaUrl: '/account' },
  test_completed: { name: 'Asha Verma', wpm: 42.6, accuracy: 96.8, duration: 300, errors: 7, best: true },
  contact_received: { name: 'Asha Verma', topic: 'billing', message: 'I paid for Pro but my account still says Free.' },
  support_reply: { name: 'Asha Verma', body: 'Your Pro plan is active now. Sorry for the wait.\n\nThe payment had reached us, but the bank confirmed it late.', staffName: 'Rahul', original: 'I paid for Pro but my account still says Free.', subject: 'Re: your message to TypeCraft (payments and plans)' },
  contact_forward: { name: 'Asha Verma', email: 'asha@example.com', topic: 'billing', message: 'I paid for Pro but my account still says Free.', priority: true },
  system_alert: { title: 'A background job failed', failures: [{ part: 'payments', error: 'Razorpay did not answer in time' }], link: '/admin/system-health' },
  institute_invite: { name: 'Sunil Sharma', instituteName: 'Sharma Typing Centre', role: 'admin', invitedBy: 'TypeCraft', email: 'sunil@example.com', link: '/institute' },
  student_invite: { name: 'Ravi', instituteName: 'Sharma Typing Centre', batchName: 'Morning batch', batchCode: 'KQ7M-PX3D', joinPath: '/join/KQ7M-PX3D' },
  institute_reminder: { name: 'Sunil Sharma', instituteName: 'Sharma Typing Centre', kind: 'ends', lastDay: '26 Nov 2026', days: 7, link: '/institute', online: true },
  institute_payment: { name: 'Sunil Sharma', instituteName: 'Sharma Typing Centre', kind: 'new', what: 'TypeCraft Pro plan for 20 students', amountPaise: 1998000, invoiceNumber: 'TC-2026-000124',
    invoiceUrl: '/institute', link: '/institute', seats: 20, lastDay: '2027-11-19' },
  institute_weekly: { name: 'Sunil Sharma', from: '9 November', to: '15 November', settingsUrl: '/institute', institutes: [{ name: 'Sharma Typing Centre', link: '/institute',
    batches: [{ name: 'Morning batch', students: 18, practised: 14, time: '21 h 40 min', top: ['Asha (3 h 10 min)', 'Ravi (2 h 45 min)', 'Neha (2 h 5 min)'], quiet: ['Karan', 'Pooja'], quietMore: 2, link: '/institute' }] }] },
};

// What each email is, the group it is listed under, and who gets it when; shown with the preview.
export const GROUPS = ['Sign-in and security', 'Payments and plans', 'Learning and news', 'Support', 'Institutes', 'For the team'];
export const ABOUT = {
  welcome: { title: 'Welcome', group: 'Sign-in and security', about: 'To a learner right after they create an account.' },
  verify_email: { title: 'Confirm your email', group: 'Sign-in and security', about: 'To a learner to confirm their email address (code and link).' },
  otp_login: { title: 'Sign-in code', group: 'Sign-in and security', about: 'To a learner who signs in with an emailed code.' },
  login_alert: { title: 'New sign-in', group: 'Sign-in and security', about: 'To a learner when their account is signed in on a new device.' },
  password_reset: { title: 'Reset your password', group: 'Sign-in and security', about: 'To a learner who asked to reset their password.' },
  password_changed: { title: 'Password changed', group: 'Sign-in and security', about: 'To a learner after their password changes.' },
  security_alert: { title: 'Security notice', group: 'Sign-in and security', about: 'To a learner when something unusual happens on their account.' },
  email_changed: { title: 'Email changed', group: 'Sign-in and security', about: 'To the old address when a learner changes their email.' },
  payment_success: { title: 'Payment received', group: 'Payments and plans', about: 'To a learner after a payment goes through.' },
  payment_failed: { title: 'Payment didn\'t go through', group: 'Payments and plans', about: 'To a learner when a payment fails.' },
  invoice: { title: 'Invoice', group: 'Payments and plans', about: 'To a learner with the invoice for a payment.' },
  subscription_renewal_reminder: { title: 'Plan ends soon', group: 'Payments and plans', about: 'To a learner 3 days before their plan ends.' },
  subscription_expired: { title: 'Plan has ended', group: 'Payments and plans', about: 'To a learner on the day their plan ends.' },
  refund_processed: { title: 'Refund sent', group: 'Payments and plans', about: 'To a learner when a refund is made.' },
  account_update: { title: 'Account update', group: 'Payments and plans', about: 'To a learner when the team changes their plan or account from the console.' },
  announcement: { title: 'Announcement', group: 'Learning and news', about: 'To learners who allow product news (Email campaigns).' },
  test_completed: { title: 'Typing test result', group: 'Learning and news', about: 'To a learner after a typing test, if they turned these on.' },
  contact_received: { title: 'We got your message', group: 'Support', about: 'To the sender of a contact-form message, confirming it arrived.' },
  support_reply: { title: 'Reply from support', group: 'Support', about: 'To a learner when the team replies from the Support inbox.' },
  institute_invite: { title: 'Invitation to run an institute', group: 'Institutes', about: 'To someone invited to help run an institute.' },
  student_invite: { title: 'Invitation to a batch', group: 'Institutes', about: 'To a student invited to join an institute batch.' },
  institute_reminder: { title: 'Institute reminder', group: 'Institutes', about: 'To an institute owner before their plan ends or a payment is due.' },
  institute_payment: { title: 'Institute payment received', group: 'Institutes', about: 'To an institute owner after a payment goes through.' },
  institute_weekly: { title: 'Monday summary', group: 'Institutes', about: 'To institute owners and teachers each Monday, with last week\'s practice.' },
  admin_otp: { title: 'Admin sign-in code', group: 'For the team', about: 'To a Super Admin, Admin or Support member signing in to the admin console.' },
  contact_forward: { title: 'New contact message', group: 'For the team', about: 'To the support inbox when a contact-form message arrives.' },
  system_alert: { title: 'Background job failed', group: 'For the team', about: 'To the Super Admins when a background job fails (at most one every 6 hours per job).' },
};
