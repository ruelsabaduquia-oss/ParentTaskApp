# MissionNest Android

This debug APK packages a local HTML/CSS/JS app in an Android WebView. It does not need a hosted Django server.

The app talks directly to Supabase using the public anon key in `app/src/main/assets/www/app.js`.

For a new database, run `supabase/missionnest_mobile.sql`, then
`supabase/family_invitations.sql`, `supabase/direct_invitations_and_tutors.sql`, then
`supabase/tutor_work_ownership.sql`, then `supabase/subscriptions.sql` in the Supabase SQL Editor before installing.
For an existing database with tutor ownership already installed, run only `subscriptions.sql`.
Reapply migrations in that order if an earlier schema script is rerun.

## Manual Subscription Setup

1. Register `ruelsabaduquia@gmail.com` in the parent app if it does not already exist.
2. Run `supabase/subscriptions.sql`, then `supabase/subscription_admin_setup.sql`
   in the trusted Supabase SQL Editor. The second script grants administrator
   access only to that existing account. It is never granted by client email checks.
3. Install the separate Admin APK from `admin/build/outputs/apk/debug/admin-debug.apk`,
   or open `http://127.0.0.1:8088/admin.html` during local preview. Sign in with that account.
4. Open Payment Settings. GCash number is `09995063999`. Supply the actual GCash
   account name, monthly/quarterly/annual prices, and payment instructions.
   A zero price displays "Contact administrator", not a free subscription.

New family requests are created atomically and stay pending. The admin sees the
request and can open the family to send payment instructions. The owner submits
the GCash reference and amount. Only after checking the actual GCash transaction
should the admin choose Verify & Approve. No automatic GCash verification is implied.
Approving activates a calendar month, three months, or one year. Renewals extend
an unexpired subscription from its current expiry; expired subscriptions restart
from approval time. Rejected payments retain the admin note and allow a new submission.
Duplicate references and multiple simultaneous pending payments are rejected.

Access Override supports explicit expiry dates, no-expiry grants, and suspension;
these changes and payment decisions are recorded in an audit event table. The
owner receives a reminder within five days of expiry, once per day per expiry.
Expired subscriptions are effectively suspended using database time, even when
the stored status is active; no scheduled job is necessary. The owner retains
access to payment/history while children's data is blocked for every family role.
Approval or a valid access grant restores access without deleting any data.
Existing families are grandfathered as active/no-expiry and can be changed in Admin.

Subscription notifications are in-app while signed in and online (roughly 9-10
seconds), not SMS, email, or push delivery while the app is closed. The admin
app can see billing metadata, not children's missions or answers. Never place a
service-role key in either app. These are debug/test APKs, not Play Store releases.

Build both APKs from this directory with `gradlew.bat :app:assembleDebug :admin:assembleDebug`.
The separate application IDs allow both apps to be installed together.

The family owner opens Family and enters the registered recipient's email or
username, selecting Parent, Guardian, or Tutor. The recipient gets an in-app
Accept/Decline dialog while signed in. Acceptance grants membership immediately;
the owner's addressed invitation is their authorization. Invitations expire in
seven days. Family owners can disconnect members without deleting their accounts
or family data. Existing shared-code invitations still follow owner approval.

Users can claim a unique username in Family (or the initial family setup screen).
Notifications are checked while the app is open, including while editing a quiz.
These are in-app notifications, not email or closed-app push notifications.

Tutors can create quizzes and missions in categories named Lesson or Lessons
(case insensitive), and can read only their own work and its results. Parents
and guardians retain visibility across all tutors. Creator IDs are assigned
server-side and cannot be changed or spoofed. Existing work with no recorded
creator remains parent-visible; ownership is never guessed during migration.
Tutors cannot edit/delete/approve existing work, manage categories or children,
read child PINs, or manage family members. The same restrictions apply to
authenticated database access. Approved members can switch between their
families using Active family on the Family page.

The current child name/PIN mode still uses the prototype's anonymous Supabase
policies. Parent membership enforcement does not replace child authentication;
that legacy access model needs a separate migration before a public release.
