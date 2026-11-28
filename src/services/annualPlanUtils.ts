import {
  AnnualSubjectPlan,
  AnnualTopicItem,
  DayOfWeek,
  SchoolClass,
  TimetableEntry,
} from '../types';
import { isPlayOrNursery } from './parallelSubjects';

export const DEFAULT_ACADEMIC_WEEKS = 40;
export const MAX_ANNUAL_CLASSES = 500;
export const MAX_TOPICS_PER_PLAN = 350;
export const MAX_FILES_PER_PLAN = 15;
export const MAX_LESSON_PLAN_RAW_BYTES = 580 * 1024; // ~580 KB raw -> <= 795 KB base64 (< 820,000 char rule cap)
export const MAX_LESSON_PLAN_BASE64_LEN = 820000;

export const ALLOWED_LESSON_PLAN_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export type AllowedLessonPlanMime = (typeof ALLOWED_LESSON_PLAN_MIMES)[number];

const EXTENSION_TO_MIME: Record<string, AllowedLessonPlanMime> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const JS_DAY_TO_ENUM: Record<number, DayOfWeek> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

export function sanitizeRuleIdSegment(value: string, fallback = 'item'): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function buildAnnualPlanId(academicYear: string, classId: string, subjectId: string): string {
  const y = sanitizeRuleIdSegment(academicYear, 'year');
  const c = sanitizeRuleIdSegment(classId, 'class');
  const s = sanitizeRuleIdSegment(subjectId, 'sub');
  return `plan_${y}_${c}_${s}`.slice(0, 160);
}

export function resolveLessonPlanMimeType(
  fileName: string,
  browserMime?: string
): AllowedLessonPlanMime | null {
  const normalizedMime = (browserMime || '').trim().toLowerCase();
  if ((ALLOWED_LESSON_PLAN_MIMES as readonly string[]).includes(normalizedMime)) {
    return normalizedMime as AllowedLessonPlanMime;
  }
  const ext = fileName.trim().split('.').pop()?.toLowerCase() || '';
  return EXTENSION_TO_MIME[ext] || null;
}

export function validateLessonPlanCandidate(params: {
  fileName: string;
  mimeType?: string;
  fileSize: number;
  existingFileCount?: number;
}): { ok: true; resolvedMime: AllowedLessonPlanMime } | { ok: false; error: string } {
  const { fileName, mimeType, fileSize, existingFileCount = 0 } = params;

  if (existingFileCount >= MAX_FILES_PER_PLAN) {
    return {
      ok: false,
      error: `প্রতিটি বিষয়ে সর্বোচ্চ ${MAX_FILES_PER_PLAN}টি লেসন প্ল্যান ফাইল যুক্ত করা যাবে।`,
    };
  }

  const resolvedMime = resolveLessonPlanMimeType(fileName, mimeType);
  if (!resolvedMime) {
    return {
      ok: false,
      error: 'শুধুমাত্র Word (.doc, .docx), PDF (.pdf), অথবা Excel (.xls, .xlsx) ফাইল আপলোড করা যাবে।',
    };
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return {
      ok: false,
      error: 'ফাইলটি খালি বা অকার্যকর। অনুগ্রহ করে সঠিক ফাইল নির্বাচন করুন।',
    };
  }

  if (fileSize > MAX_LESSON_PLAN_RAW_BYTES) {
    const kbLimit = Math.round(MAX_LESSON_PLAN_RAW_BYTES / 1024);
    const actualKb = Math.round(fileSize / 1024);
    return {
      ok: false,
      error: `ফাইলের সাইজ ${actualKb} KB — ক্লাউড ডাটাবেসে সর্বোচ্চ ${kbLimit} KB পর্যন্ত Word/PDF/Excel ফাইল আপলোড করা যায়। অনুগ্রহ করে ফাইলটি কমপ্রেস করে চেষ্টা করুন।`,
    };
  }

  return { ok: true, resolvedMime };
}

export function getLessonPlanFileKind(mimeType: string, fileName: string): 'word' | 'pdf' | 'excel' {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    lowerMime.includes('excel') ||
    lowerMime.includes('spreadsheet') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.xlsx')
  ) {
    return 'excel';
  }
  return 'word';
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function getWeeklyPeriodsForClassSubject(
  cls: SchoolClass | undefined,
  subjectId: string,
  entries: TimetableEntry[]
): number {
  if (!cls) return 4;

  if (isPlayOrNursery(cls) && subjectId === 'sub-block-play-nur') {
    const scheduledFirstSec = cls.sections[0]
      ? entries.filter(e => e.classId === cls.id && e.sectionId === cls.sections[0].id).length
      : 0;
    return scheduledFirstSec > 0 ? scheduledFirstSec : (cls.maxPeriods || 4) * 5;
  }

  const baseReq = cls.subjectRequirements.find(r => r.subjectId === subjectId);
  if (baseReq && baseReq.periodsPerWeek > 0) {
    return baseReq.periodsPerWeek;
  }

  // Fallback to section-level config if subject is configured per-section
  for (const sec of cls.sections) {
    const cfg = sec.subjectConfigs?.[subjectId];
    if (cfg && typeof cfg.periodsPerWeek === 'number' && cfg.periodsPerWeek > 0) {
      return cfg.periodsPerWeek;
    }
  }

  // Fallback to actual scheduled entries in primary section
  if (cls.sections[0]) {
    const secCount = entries.filter(
      e => e.classId === cls.id && e.sectionId === cls.sections[0].id && e.subjectId === subjectId
    ).length;
    if (secCount > 0) return secCount;
  }

  return 4;
}

export function suggestAnnualClassTotal(
  cls: SchoolClass | undefined,
  subjectId: string,
  entries: TimetableEntry[],
  academicWeeks: number = DEFAULT_ACADEMIC_WEEKS
): number {
  const weekly = getWeeklyPeriodsForClassSubject(cls, subjectId, entries);
  const safeWeeks = Math.max(1, Math.min(52, Math.round(academicWeeks)));
  return Math.max(1, Math.min(MAX_ANNUAL_CLASSES, Math.round(weekly * safeWeeks)));
}

export function computeAnnualProgress(
  plan: Pick<AnnualSubjectPlan, 'totalClassesPlanned' | 'completedClasses' | 'topics'> | undefined,
  suggestedTotal: number
): {
  total: number;
  completed: number;
  remaining: number;
  percent: number;
  topicCount: number;
  completedTopicCount: number;
} {
  const total = Math.max(
    1,
    Math.min(MAX_ANNUAL_CLASSES, Math.round(plan?.totalClassesPlanned ?? suggestedTotal))
  );
  const topics = plan?.topics || [];
  const completedTopicCount = topics.filter(t => t.isCompleted).length;
  const rawCompleted = plan ? plan.completedClasses : 0;
  const completed = Math.max(0, Math.min(total, Math.round(rawCompleted)));
  const remaining = Math.max(0, total - completed);
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return {
    total,
    completed,
    remaining,
    percent,
    topicCount: topics.length,
    completedTopicCount,
  };
}

export function generateScheduleTopicSlots(params: {
  startDate: string; // YYYY-MM-DD
  workingDays: DayOfWeek[];
  entries: TimetableEntry[];
  classId: string;
  subjectId: string;
  count: number;
  existingTopics: AnnualTopicItem[];
}): AnnualTopicItem[] {
  const { startDate, workingDays, entries, classId, subjectId, count, existingTopics } = params;
  const maxAllowedNew = Math.max(0, MAX_TOPICS_PER_PLAN - existingTopics.length);
  const targetCount = Math.min(maxAllowedNew, Math.max(1, Math.round(count)));
  if (targetCount === 0) return [];

  const scheduledDaysSet = new Set<DayOfWeek>();
  entries.forEach(e => {
    if (e.classId === classId && e.subjectId === subjectId) {
      scheduledDaysSet.add(e.day);
    }
  });

  const activeDays =
    scheduledDaysSet.size > 0
      ? workingDays.filter(d => scheduledDaysSet.has(d))
      : workingDays;
  const fallbackDays = activeDays.length > 0 ? activeDays : workingDays;
  if (fallbackDays.length === 0) return [];

  const [yStr, mStr, dStr] = startDate.split('-');
  const startUtc = new Date(
    Date.UTC(Number(yStr) || new Date().getFullYear(), (Number(mStr) || 1) - 1, Number(dStr) || 1)
  );

  const highestClassNo = existingTopics.reduce(
    (max, t) => Math.max(max, Number(t.classNumber) || 0),
    0
  );

  const generated: AnnualTopicItem[] = [];
  let cursor = new Date(startUtc.getTime());
  let guard = 0;

  while (generated.length < targetCount && guard < 400) {
    guard++;
    const dayEnum = JS_DAY_TO_ENUM[cursor.getUTCDay()];
    if (fallbackDays.includes(dayEnum)) {
      const isoDate = cursor.toISOString().slice(0, 10);
      const classNum = highestClassNo + generated.length + 1;
      generated.push({
        id: `top-${Date.now().toString(36)}-${generated.length}-${Math.random().toString(36).slice(2, 6)}`,
        classNumber: classNum,
        date: isoDate,
        topic: '',
        isCompleted: false,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return generated;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
