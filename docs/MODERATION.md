# Safety, reporting and moderation

## Roles

| Role | Can do | How to grant |
|---|---|---|
| Member | Report anything they can see; block; see the outcome of their own reports (Settings › My reports). | Everyone |
| Moderator | Work the report queue; dismiss; remove posts, comments, messages, notices; cancel events; warn; suspend for 1, 7 or 30 days; lift those suspensions; look members up. | An admin, from Moderation › Find a member › Roles |
| Admin | Everything a moderator can, plus indefinite suspensions, removing whole groups, granting/removing roles and reading the audit log. | The first admin is created in the SQL editor (see SETUP.md). Admins can't remove their own admin role, so there is always one left. |

Moderators and admins see a **Moderation** entry in Settings. Every check is enforced by the database; hiding the entry is only a convenience.

## What a report captures

When someone reports an item, the database stores a copy (a "snapshot") so evidence survives if the author deletes it:

* **Profile:** username, display name, avatar path and bio as the reporter could see it.
* **Post / comment / notice / event / group:** its text, and for posts the photo paths.
* **Message:** only the single reported message, never the rest of the conversation.

Reporters can only report what they can already see (a post they have access to, a message in their own chat), so reporting can't be used to expose private content. Moderators can open photos attached to reported items through 10-minute signed links; they can't open any other private photo. Photos attached to open reports are kept by the cleanup job until the report is closed.

The reported person is never told who reported them. When content is removed or a member is warned, the member receives a notification with the moderator's reason.

## Queue order

Reports about self-harm, under-18 users and violence appear first and are outlined in red; then oldest first. The queue shows how many times the same item, and the same person, have been reported.

## Suspensions

* A suspended member's profile, posts, comments, events and notices disappear for everyone; they can't post, message, react, join or report location; their stored location and push tokens are deleted; their background location stops the next time the app opens.
* They see the reason and the end date on sign-in, and can sign out or check again.
* Timed suspensions end automatically (job every 15 minutes, `lift_expired_suspensions`).

## Audit trail

Every moderation action is written to `moderation_actions` (shown per member) and to `audit_log` (admins: Moderation › Audit log), including report dismissals, removals, warnings, suspensions, lifts and role changes. Group admins removing members or posts from their group are logged too.

## Retention

* Reports and snapshots are kept until deleted by an admin in the database; decide a retention period with your lawyer (12 months is common) and add it to the privacy policy.
* When an account is deleted, its messages and comments are blanked for everyone, its posts, reactions, memberships and RSVPs are deleted, and its photos are removed (per-user folders immediately; chat photos by the nightly cleanup). Reports it made remain, with the reporter shown as "deleted account".

## Not built (needs a decision or a service)

* Automatic content scanning (e.g. image nudity detection, known-CSAM hash matching). Required by some app stores' policies for apps with user-generated photos and recommended before launch; this needs a third-party service (e.g. Microsoft PhotoDNA, Google Cloud Vision SafeSearch, Hive) and a legal review. Until then, moderation is reactive (report-driven).
* An in-app appeal flow. Suspended members are told to contact support; set up a support email and put it in the legal texts.
* Moderator notifications for urgent reports. Moderators check the queue; consider routing urgent reports to an email or Slack via a database webhook.
