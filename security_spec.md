# Security Specification — 3-Tier School Routine RBAC

## 1. Data Invariants
1. Only the verified Super Admin (`ratan.mizan@gmail.com`) may create, pause, block, activate, or remove records in `/admins/{adminId}`.
2. A user has Admin edit access if and only if they are authenticated with `email_verified == true` AND either they are the Super Admin OR `/admins/{emailKey}` exists with `role == 'admin'` AND `status == 'active'`.
3. Paused (`status == 'paused'`) or Blocked (`status == 'blocked'`) admins, unverified emails, and General Viewers are strictly denied all writes to `/routine_public/*`, `/routine_private/*`, `/admins/*`, and `/audit_logs/*`.
4. General Viewers may read ONLY `/routine_public/metadata` and `/routine_public/schedule`, which contain zero PII (no emails/phones).
5. `/routine_private/staff_contacts` (teacher PII) is readable and writable ONLY by active Admins and the Super Admin.
6. `/audit_logs/{logId}` is append-only (`create` by active Admin/Super Admin with `actorEmail == request.auth.token.email.lower()` and `timestamp == request.time`; `update` and `delete` permanently denied; `read/list` allowed ONLY for Super Admin).
7. Admins may `get` only their own `/admins/{currentEmailKey()}` document so real-time status changes (`paused`/`blocked`/deleted) take immediate effect in the UI; Admins cannot `list` other admins.
8. `/proxy_logs/{logId}` and `/daily_absences/{dateId}` are readable (`get`/`list`) and writable (`create`/`update`/`delete`) ONLY by the Super Admin or an active Admin (`role == 'admin' && status == 'active'`). General Viewers, Paused/Blocked Admins, and unauthenticated users are strictly denied all access.

## 2. Adversarial "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Write**: Anonymous user attempts `setDoc` on `/routine_public/schedule`.
2. **Viewer Escalation**: Signed-in verified Viewer (not in `/admins`) attempts `setDoc` on `/routine_public/metadata` or reads `/proxy_logs`.
3. **Paused Admin Write**: Admin with `/admins/{key}.status == 'paused'` attempts `updateDoc` on `/routine_public/schedule` or `/proxy_logs/{logId}`.
4. **Blocked Admin Write**: Admin with `/admins/{key}.status == 'blocked'` attempts `setDoc` on `/routine_private/staff_contacts` or `/daily_absences/{date}`.
5. **Admin Privilege Escalation**: Active Admin attempts `setDoc` or `updateDoc` on `/admins/{otherAdmin}` to add/remove/block an admin or escalate `role: 'super_admin'`.
6. **Email Spoofing**: Signed-in user with `email: 'ratan.mizan@gmail.com'` and `email_verified: false` attempts `setDoc` on `/admins/foo`.
7. **Shadow Field Injection**: Super Admin attempts `setDoc` on `/admins/foo` including undeclared key `isSuperAdmin: true`.
8. **Invalid ID Poisoning**: Super Admin attempts write to `/admins/invalid.id.with$chars` or >160 chars.
9. **Audit Log Tampering**: Active Admin attempts `deleteDoc` or `updateDoc` on `/audit_logs/{logId}` to erase edit history.
10. **Audit Log Spoofing**: Active Admin creates `/audit_logs/{logId}` or `/proxy_logs/{logId}` claiming `actorEmail: 'ratan.mizan@gmail.com'` or `assignedByRole: 'super_admin'`.
11. **PII & Proxy Leak Attempt**: Unauthenticated or Viewer user attempts `getDoc` on `/routine_private/staff_contacts`, `getDocs` on `/proxy_logs`, or `getDocs` on `/admins`.
12. **Client Timestamp Forgery**: Active Admin creates `/audit_logs/{logId}` or `/proxy_logs/{logId}` with backdated `timestamp`/`createdAt` != `request.time`.
