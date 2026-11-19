// Every database update (migrations/*.sql) and what it creates, so System health can say which ones have been applied
// to this database (docs/ADMIN-PHASE-5.md §4). An update counts as applied when all its tables and indexes exist.
// tests/console-system.test.mjs reads the migrations folder and fails when this list is out of date: a new
// migration is added here with its title.
//
// [file name without .sql, what it is for, tables, indexes]
export const MIGRATIONS = [
  ['0001_accounts', 'Accounts and sign-in', ['users', 'sessions', 'password_reset_tokens', 'email_tokens', 'user_learning_progress', 'user_activity', 'user_state', 'rate_limits'], ['users_email_unique', 'sessions_user', 'sessions_expires', 'password_reset_tokens_user', 'email_tokens_user', 'user_learning_progress_recent', 'user_activity_recent']],
  ['0002_next', 'Learning events, totals and rewards', ['events', 'lesson_scores', 'user_position', 'stats_batches', 'key_stats', 'bigram_stats', 'error_classes', 'daily_totals', 'user_totals', 'pipeline_guard', 'xp_ledger', 'daily_quests', 'badges', 'certificates', 'placement', 'user_settings', 'workshop_unlocks', 'game_bests', 'ghost_replays', 'daily_results', 'feedback', 'guest_imports', 'event_rejects', 'rebuild_runs', 'rebuild_diffs'], ['events_user_order', 'events_user_lesson', 'events_server_at', 'feedback_at', 'event_rejects_day', 'rebuild_diffs_user', 'rebuild_diffs_run']],
  ['0003_saas', 'Plans, payments, invoices and email', ['packages', 'package_features', 'user_subscriptions', 'orders', 'payments', 'refunds', 'invoices', 'webhook_events', 'email_logs', 'otp_verifications', 'known_devices', 'admin_users', 'audit_logs', 'platform_settings', 'typing_tests', 'contact_messages', 'email_preferences'], ['user_subscriptions_user', 'user_subscriptions_expires', 'user_subscriptions_order', 'orders_user', 'orders_status', 'payments_order', 'payments_status', 'refunds_payment', 'invoices_user', 'webhook_events_received', 'email_logs_status', 'email_logs_user', 'email_logs_created', 'otp_verifications_email', 'audit_logs_created', 'typing_tests_user', 'contact_messages_created']],
  ['0004_billing_archive', 'Billing records kept after an account is deleted', ['billing_archive'], ['billing_archive_email']],
  ['0005_admin_console', 'Admin console: sign-in and permissions', ['admin_sessions', 'role_permissions'], ['admin_sessions_user', 'admin_sessions_expires']],
  ['0006_admin_core', 'Admin console: notes, exceptions and refunds', ['customer_notes', 'access_overrides', 'refund_choices'], ['customer_notes_user', 'access_overrides_user', 'access_overrides_created', 'users_created', 'refunds_created', 'audit_logs_target']],
  ['0007_course', 'Admin console: course edits', ['course_drafts', 'course_releases'], []],
  ['0008_exams', 'Exam practice and certificates', ['exam_results', 'certificate_codes'], ['exam_results_user', 'certificate_codes_one']],
  ['0009_institutes', 'Institutes', ['institutes', 'institute_staff', 'batches', 'batch_teachers', 'institute_students', 'institute_payments'], ['institutes_status', 'institute_staff_one', 'institute_staff_user', 'institute_staff_email', 'batches_institute', 'batch_teachers_staff', 'institute_students_one', 'institute_students_seats', 'institute_students_user', 'institute_students_batch', 'institute_payments_institute']],
  ['0010_institutes_teaching', 'Institutes: teaching tools', ['batch_leaderboards', 'batch_targets', 'assignments', 'student_invites', 'institute_reminders', 'institute_invoices'], ['assignments_batch', 'student_invites_one', 'institute_invoices_institute']],
  ['0011_institute_orders', 'Institutes: buying seats online', ['institute_orders'], ['institute_orders_status']],
  ['0012_batch_tests', 'Institutes: batch tests', ['batch_tests', 'batch_test_attempts'], ['batch_tests_batch', 'batch_test_attempts_user']],
  ['0013_institute_weekly', 'Institutes: the Monday email', ['institute_weekly_emails', 'institute_email_settings'], []],
  ['0014_support', 'Admin console: support inbox', ['support_replies', 'support_assignments'], ['support_replies_message', 'support_assignments_to']],
  ['0015_campaigns', 'Admin console: campaigns and notifications', ['email_campaigns', 'campaign_sends', 'site_notices'], ['email_campaigns_due', 'campaign_sends_waiting', 'campaign_sends_sent', 'site_notices_live']],
  ['0016_coupons', 'Admin console: coupons and sales', ['coupons', 'promotions', 'order_discounts'], ['coupons_code', 'promotions_live', 'order_discounts_coupon', 'order_discounts_promotion']],
  ['0017_job_runs', 'Admin console: job record', ['job_runs'], ['job_runs_recent']],
];
