# Security Summary

This document summarizes the security audit findings, implemented hardening measures, and verification checks performed on the **Icon Dreams School and College** Routine Management System.

1. **Spreadsheet Formula Injection Sanitization**:
   - All Excel export pipelines in `/src/services/exportExcel.ts` and `/src/services/exportProxyDoc.ts` pass string cells through `sanitizeSpreadsheetCell`, prefixing values matching leading control/whitespace followed by `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`).
2. **Dependency Migration & Upload Validation**:
   - Replaced the vulnerable `xlsx` dependency with `exceljs` + `file-saver` across exports (`exportExcel.ts`, `exportProxyDoc.ts`) and template generation (`SmartImportModal.tsx`).
   - Enforced strict MIME/extension allowlists (`ALLOWED_PARSE_MIME_TYPES`) and a 15 MB decoded payload cap (`MAX_PARSE_FILE_BYTES`) in `/server.ts` (`/api/parse-schedule-file`), alongside filename sanitization.
3. **Removal of Unverified Static Binary Asset**:
   - Removed the static `/public/IDSC_Routine.apk` binary and replaced Android access guidance with PWA installation instructions in `/src/components/HelpAndInstallModal.tsx`.
4. **Client PII Stripping & Offline Cache Clearing**:
   - Implemented `stripTeacherPii` in `/src/services/storage.ts` and applied it across `loadStoredData`, `saveStoredData`, `resetToDefaults`, and `saveRoutineSnapshot` so teacher `email` and `phone` fields are never persisted in browser `localStorage` or routine snapshots.
   - Implemented `clearSensitiveOfflineCaches()` in `/src/services/storage.ts` and invoked it automatically in `/src/App.tsx` whenever `authReady && !canEdit`, clearing `PROXY_LOGS` and `DAILY_ABSENCES` caches and purging any legacy PII from stored records.
5. **Server-Side API Key Isolation & RBAC Enforcement**:
   - Kept `GEMINI_API_KEY` exclusively server-side inside `/server.ts` (`/api/parse-schedule-file`), protected by Firebase ID token signature/audience/issuer/expiry verification (`verifyFirebaseIdToken`) and Firestore role/status verification (`requireActiveAdmin`).
   - Enforced strict schema, role, and ownership validation in `/firestore.rules` (verified via `npx eslint firestore.rules`).
6. **Manual Routine Override Confirmation**:
   - Enforced explicit `overrideConfirmed` acknowledgment in `/src/components/EditEntryModal.tsx` whenever manual slot edits trigger workload overload, limit warnings, fixed-period violations, teacher unavailability, or clash warnings.

## PoC Verification

- **Firestore Security Rules Validation**:
  - Executed `npx eslint firestore.rules` and verified exit code `0` with zero rule lint warnings or errors.
- **Routine Engine, 13-Point Health & Storage PII Verification**:
  - Executed Node/TSX verification against `generateSmartTimetable`, `autoFixRoutine`, `verifyRoutine`, `stripTeacherPii`, `saveStoredData`, `saveRoutineSnapshot`, and `clearSensitiveOfflineCaches` confirming:
    - `0` unassigned periods and `0` 4+ consecutive-period streaks across generated and auto-fixed timetables.
    - All 13 `systemHealthReport` items (`sys-1` through `sys-13`) produce live programmatic metrics.
    - `email` and `phone` PII fields are stripped from persisted teachers and snapshots, and offline proxy/absence caches are removed on `clearSensitiveOfflineCaches()`.
- **Build & Type Verification**:
  - Verified TypeScript compilation (`compile_applet` / `vite build`) and static type checking (`lint_applet` / `tsc --noEmit`) with zero errors.
