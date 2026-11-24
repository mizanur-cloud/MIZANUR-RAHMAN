import { DayOfWeek, RoutineConflict, SchoolClass, SchoolSettings, Subject, Teacher, TimetableEntry } from '../types';
import {
  AGRICULTURE_ROOM,
  areParallelSubjects,
  getCombinedHinduRoom,
  getCombinedHinduTeacherId,
  getEffectiveSectionRequirements,
  getEffectiveSubjectFixedPeriods,
  getExpectedSectionTeacherId,
  getMaxReligionConcurrentSections,
  isAgricultureSubject,
  isClassNineOrTen,
  isHigherMathSubject,
  isHinduReligionRoom,
  isHinduReligionSubject,
  isIslamReligionSubject,
  isPlayOrNursery,
  isReligionSubject,
  isSubjectSelectedForSection,
  isTeacherBlockedAtSlot,
  isTeacherBlockTeacher,
} from './parallelSubjects';

export function detectAllConflicts(
  entries: TimetableEntry[],
  teachers: Teacher[],
  classes: SchoolClass[],
  workingDays: DayOfWeek[],
  periodIndices: number[],
  subjects?: Subject[],
  settings?: SchoolSettings
): RoutineConflict[] {
  const conflicts: RoutineConflict[] = [];

  const hinduRoom = getCombinedHinduRoom(settings);
  const maxRelConcurrent = getMaxReligionConcurrentSections(settings);
  const combinedHinduTeacherId = getCombinedHinduTeacherId(teachers, settings, subjects);

  // Helper maps for quick lookup
  const teacherMap = new Map<string, Teacher>();
  teachers.forEach(t => teacherMap.set(t.id, t));

  const classMap = new Map<string, SchoolClass>();
  classes.forEach(c => classMap.set(c.id, c));

  const getSectionName = (classId: string, sectionId: string) => {
    const cls = classMap.get(classId);
    if (!cls) return sectionId;
    const sec = cls.sections.find(s => s.id === sectionId);
    return `${cls.name} (${sec?.name || sectionId})`;
  };

  const isCombinedHinduGroup = (slotEntries: TimetableEntry[]): boolean => {
    if (slotEntries.length <= 1) return false;
    if (slotEntries.length > maxRelConcurrent) return false;
    const uniqueSections = new Set(slotEntries.map(e => `${e.classId}_${e.sectionId}`));
    if (uniqueSections.size !== slotEntries.length) return false;
    return slotEntries.every(
      e => isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)
    );
  };

  // 1. Check for Teacher Double Booking (same day, same periodIndex, same teacherId)
  //    Valid Combined Hindu Religion classes in Room 307 (<= maxConcurrentSections) are ONE physical group, NOT a double-booking.
  //    All other subjects (including Islam Religion & single-room subjects) strictly allow max 1 section per teacher per slot.
  const teacherSlotMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    if (!entry.teacherId) return;
    const key = `${entry.teacherId}_${entry.day}_${entry.periodIndex}`;
    const list = teacherSlotMap.get(key) || [];
    list.push(entry);
    teacherSlotMap.set(key, list);
  });

  teacherSlotMap.forEach((matchedEntries) => {
    if (matchedEntries.length > 1) {
      if (isCombinedHinduGroup(matchedEntries)) {
        return;
      }
      const first = matchedEntries[0];
      const teacher = teacherMap.get(first.teacherId);
      const teacherName = teacher?.name || 'Assigned Teacher';
      const classNames = matchedEntries.map(e => getSectionName(e.classId, e.sectionId)).join(' and ');

      conflicts.push({
        id: `conf-tch-${first.teacherId}-${first.day}-${first.periodIndex}`,
        type: 'teacher_double_booking',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Teacher Double Booking: ${teacherName}`,
        description: `${teacherName} is scheduled to teach simultaneously in ${classNames} on ${first.day}, Period ${first.periodIndex}.`,
        entryIds: matchedEntries.map(e => e.id),
        teacherId: first.teacherId,
      });
    }
  });

  // 2. Check for Class/Section Double Booking
  // ALLOW valid parallel pairs simultaneously in the same slot:
  //   - Class 9-10: Higher Math + Agriculture
  //   - All Classes: Islam Religion + Hindu Religion
  const sectionSlotMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    const key = `${entry.classId}_${entry.sectionId}_${entry.day}_${entry.periodIndex}`;
    const list = sectionSlotMap.get(key) || [];
    list.push(entry);
    sectionSlotMap.set(key, list);
  });

  sectionSlotMap.forEach((matchedEntries) => {
    if (matchedEntries.length > 1) {
      const first = matchedEntries[0];
      const cls = classMap.get(first.classId);

      // Check if all entries in this slot are a valid parallel pair (exactly 2 distinct parallel subjects)
      const isValidParallelPair =
        matchedEntries.length === 2 &&
        areParallelSubjects(
          matchedEntries[0].subjectId,
          matchedEntries[1].subjectId,
          subjects,
          cls?.numericGrade
        );

      if (isValidParallelPair) return;

      const sectionLabel = getSectionName(first.classId, first.sectionId);
      conflicts.push({
        id: `conf-sec-${first.classId}-${first.sectionId}-${first.day}-${first.periodIndex}`,
        type: 'class_double_booking',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Class Overlap: ${sectionLabel}`,
        description: `${sectionLabel} has multiple non-parallel classes scheduled at the same time on ${first.day}, Period ${first.periodIndex}.`,
        entryIds: matchedEntries.map(e => e.id),
        classId: first.classId,
        sectionId: first.sectionId,
      });
    }
  });

  // 2A-bis. Class 9 & 10 Rule: When a section has BOTH Higher Math and Agriculture selected,
  //         they MUST run simultaneously in the exact same period.
  sectionSlotMap.forEach((matchedEntries) => {
    const first = matchedEntries[0];
    const cls = classMap.get(first.classId);
    if (!cls || !isClassNineOrTen(cls)) return;

    const effectiveReqs = getEffectiveSectionRequirements(cls, first.sectionId, teachers);
    const sectionHasHmt = effectiveReqs.some(r => isHigherMathSubject(r.subjectId, subjects));
    const sectionHasAgr = effectiveReqs.some(r => isAgricultureSubject(r.subjectId, subjects));
    if (!sectionHasHmt || !sectionHasAgr) return;

    const hasHmt = matchedEntries.some(e => isHigherMathSubject(e.subjectId, subjects));
    const hasAgr = matchedEntries.some(e => isAgricultureSubject(e.subjectId, subjects));
    if (hasHmt !== hasAgr) {
      const sectionLabel = getSectionName(first.classId, first.sectionId);
      const presentName = hasHmt ? 'Higher Math' : 'Agriculture';
      const missingName = hasHmt ? 'Agriculture' : 'Higher Math';
      conflicts.push({
        id: `conf-par-hmt-agr-${first.classId}-${first.sectionId}-${first.day}-${first.periodIndex}`,
        type: 'class_double_booking',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Higher Math & Agriculture Parallel Mismatch: ${sectionLabel}`,
        description: `নবম-দশম শ্রেণির নিয়ম অনুযায়ী ${sectionLabel}-এ ${first.day}, Period ${first.periodIndex}-এ ${presentName}-এর সাথে একই পিরিয়ডে ${missingName} ক্লাসও থাকতে হবে।`,
        entryIds: matchedEntries.map(e => e.id),
        classId: first.classId,
        sectionId: first.sectionId,
      });
    }
  });

  // 2B. Room Conflict Detection across ALL entries (explicit room collisions)
  //     Strictly allows sharing ONLY for:
  //       - Combined Hindu Religion in configured Hindu Room (<= maxConcurrentSections & same single teacher), OR
  //       - Same section's valid parallel pair in its own homeroom.
  const roomSlotMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    const rawRoom = entry.room?.trim();
    if (!rawRoom) return;
    const normRoom = isHinduReligionRoom(rawRoom, settings)
      ? `hindu_${hinduRoom.toLowerCase()}`
      : rawRoom.toLowerCase();
    const key = `${entry.day}_${entry.periodIndex}_${normRoom}`;
    const list = roomSlotMap.get(key) || [];
    list.push(entry);
    roomSlotMap.set(key, list);
  });

  roomSlotMap.forEach((matched) => {
    if (matched.length <= 1) return;
    const first = matched[0];
    const uniqueSections = new Set(matched.map(e => `${e.classId}_${e.sectionId}`));

    // Allow same section's valid parallel pair sharing a room
    if (uniqueSections.size === 1 && matched.length === 2) {
      const cls = classMap.get(first.classId);
      if (areParallelSubjects(matched[0].subjectId, matched[1].subjectId, subjects, cls?.numericGrade)) {
        return;
      }
    }

    // Allow combined Hindu Religion strictly inside configured Hindu Room (<= maxConcurrentSections & single teacher)
    const allHinduInRoom = matched.every(
      e => isHinduReligionSubject(e.subjectId, subjects) && isHinduReligionRoom(e.room, settings)
    );
    const distinctHinduTeachers = new Set(matched.map(e => e.teacherId).filter(Boolean));
    if (allHinduInRoom && uniqueSections.size <= maxRelConcurrent && distinctHinduTeachers.size <= 1) {
      return;
    }

    const roomLabel = isHinduReligionRoom(first.room, settings) ? `Room ${hinduRoom}` : (first.room || 'Room');
    const classNames = matched.map(e => getSectionName(e.classId, e.sectionId)).join(', ');
    conflicts.push({
      id: `conf-room-${first.day}-${first.periodIndex}-${roomLabel.replace(/\s+/g, '_')}`,
      type: 'room_conflict',
      severity: 'error',
      day: first.day,
      periodIndex: first.periodIndex,
      title: `Room Conflict (${roomLabel})`,
      description: `${roomLabel} একই সময়ে (${first.day}, Period ${first.periodIndex}) একাধিক ক্লাসে বরাদ্দ রয়েছে: ${classNames}।`,
      entryIds: matched.map(e => e.id),
    });
  });

  // 2C. Dedicated Single Agriculture Room Collision
  const agrSlotMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    if (!isAgricultureSubject(entry.subjectId, subjects) && entry.room !== AGRICULTURE_ROOM) return;
    const key = `${entry.day}_${entry.periodIndex}`;
    const list = agrSlotMap.get(key) || [];
    list.push(entry);
    agrSlotMap.set(key, list);
  });

  agrSlotMap.forEach(matched => {
    if (matched.length > 1) {
      const first = matched[0];
      // Avoid duplicating if roomSlotMap already reported exact same Agriculture Room collision
      const alreadyReported = conflicts.some(
        c =>
          c.type === 'room_conflict' &&
          c.day === first.day &&
          c.periodIndex === first.periodIndex &&
          matched.every(m => c.entryIds.includes(m.id))
      );
      if (alreadyReported) return;

      const classNames = matched.map(e => getSectionName(e.classId, e.sectionId)).join(' and ');
      conflicts.push({
        id: `conf-agr-room-${first.day}-${first.periodIndex}`,
        type: 'room_conflict',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Dedicated Agriculture Room Overlap`,
        description: `কৃষিশিক্ষার (Agriculture) একটি নির্দিষ্ট শ্রেণিকক্ষ থাকায় একই সময়ে (${first.day}, Period ${first.periodIndex}) একাধিক ক্লাসে (${classNames}) কৃষিশিক্ষা ক্লাস চালানো যাবে না।`,
        entryIds: matched.map(e => e.id),
      });
    }
  });

  // 2C-bis. Combined Religious Class Scheduling Verification
  //   - Strictly max `maxRelConcurrent` (3) sections may hold Religion classes in the same (day, periodIndex)
  //   - Hindu Religion must be assigned to configured Hindu Room ('307') and a single combined Hindu teacher across sections
  const religionSlotMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    if (!isReligionSubject(entry.subjectId, subjects)) return;
    const key = `${entry.day}_${entry.periodIndex}`;
    const list = religionSlotMap.get(key) || [];
    list.push(entry);
    religionSlotMap.set(key, list);
  });

  religionSlotMap.forEach(slotRelEntries => {
    const first = slotRelEntries[0];
    const uniqueSections = new Set(slotRelEntries.map(e => `${e.classId}_${e.sectionId}`));

    if (uniqueSections.size > maxRelConcurrent) {
      const secList = Array.from(uniqueSections)
        .map(sk => {
          const [cid, sid] = sk.split('_');
          return getSectionName(cid, sid);
        })
        .join(', ');
      conflicts.push({
        id: `conf-rel-maxsec-${first.day}-${first.periodIndex}`,
        type: 'religion_rule_violation',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Religion Concurrent Limit Exceeded (${uniqueSections.size}/${maxRelConcurrent})`,
        description: `একই সময়ে (${first.day}, Period ${first.periodIndex}) সর্বোচ্চ ${maxRelConcurrent}টি সেকশনে ধর্ম ক্লাস রাখা যাবে, কিন্তু ${uniqueSections.size}টি সেকশন (${secList}) নির্ধারিত হয়েছে।`,
        entryIds: slotRelEntries.map(e => e.id),
      });
    }

    const slotHinduEntries = slotRelEntries.filter(e => isHinduReligionSubject(e.subjectId, subjects));
    if (slotHinduEntries.length > 0) {
      const wrongRoomEntries = slotHinduEntries.filter(e => !isHinduReligionRoom(e.room, settings));
      if (wrongRoomEntries.length > 0) {
        conflicts.push({
          id: `conf-hin-room-${first.day}-${first.periodIndex}`,
          type: 'religion_rule_violation',
          severity: 'error',
          day: first.day,
          periodIndex: first.periodIndex,
          title: `Hindu Religion Room Mismatch (Expected Room ${hinduRoom})`,
          description: `হিন্দু ধর্মের সম্মিলিত ক্লাস অবশ্যই নির্ধারিত Room ${hinduRoom}-এ হতে হবে (${first.day}, Period ${first.periodIndex})।`,
          entryIds: wrongRoomEntries.map(e => e.id),
        });
      }

      const distinctHinduTeachers = new Set(slotHinduEntries.map(e => e.teacherId).filter(Boolean));
      if (slotHinduEntries.length > 1 && distinctHinduTeachers.size > 1) {
        conflicts.push({
          id: `conf-hin-teacher-${first.day}-${first.periodIndex}`,
          type: 'religion_rule_violation',
          severity: 'error',
          day: first.day,
          periodIndex: first.periodIndex,
          title: `Combined Hindu Religion Multiple Teachers`,
          description: `Room ${hinduRoom}-এ সম্মিলিত হিন্দু ধর্মের ক্লাসে (${first.day}, Period ${first.periodIndex}) একাধিক শিক্ষক নির্ধারিত হয়েছেন; একজন নির্দিষ্ট শিক্ষক থাকতে হবে।`,
          entryIds: slotHinduEntries.map(e => e.id),
        });
      }
    }
  });

  // Also check section-level Islam + Hindu simultaneous pairing alignment
  classes.forEach(cls => {
    if (isPlayOrNursery(cls)) return;
    cls.sections.forEach(sec => {
      const effReqs = getEffectiveSectionRequirements(cls, sec.id, teachers);
      const hasIslam = effReqs.some(r => isIslamReligionSubject(r.subjectId, subjects));
      const hasHindu = effReqs.some(r => isHinduReligionSubject(r.subjectId, subjects));
      if (!hasIslam || !hasHindu) return;

      const secRel = entries.filter(
        e => e.classId === cls.id && e.sectionId === sec.id && isReligionSubject(e.subjectId, subjects)
      );
      if (secRel.length === 0) return;

      const islamCount = secRel.filter(e => isIslamReligionSubject(e.subjectId, subjects)).length;
      const hinduCount = secRel.filter(e => isHinduReligionSubject(e.subjectId, subjects)).length;

      // Count paired vs unpaired slots
      const bySlot = new Map<string, { islam?: TimetableEntry; hindu?: TimetableEntry }>();
      secRel.forEach(e => {
        const k = `${e.day}_${e.periodIndex}`;
        const cur = bySlot.get(k) || {};
        if (isIslamReligionSubject(e.subjectId, subjects)) cur.islam = e;
        if (isHinduReligionSubject(e.subjectId, subjects)) cur.hindu = e;
        bySlot.set(k, cur);
      });

      let pairedSlots = 0;
      const unpairedEntries: TimetableEntry[] = [];
      bySlot.forEach(pair => {
        if (pair.islam && pair.hindu) {
          pairedSlots++;
        } else {
          if (pair.islam) unpairedEntries.push(pair.islam);
          if (pair.hindu) unpairedEntries.push(pair.hindu);
        }
      });

      const minCount = Math.min(islamCount, hinduCount);
      if (pairedSlots < minCount && unpairedEntries.length > 0) {
        const sample = unpairedEntries[0];
        conflicts.push({
          id: `conf-rel-unpaired-${cls.id}-${sec.id}`,
          type: 'religion_rule_violation',
          severity: 'error',
          day: sample.day,
          periodIndex: sample.periodIndex,
          title: `Religion Parallel Mismatch: ${cls.name} (${sec.name})`,
          description: `${cls.name} (${sec.name})-এ ইসলাম ও হিন্দু ধর্ম উভয়ই নির্বাচিত থাকায় একই পিরিয়ডে সম্মিলিতভাবে চলতে হবে (বর্তমানে ${unpairedEntries.length}টি অ-সমন্বিত স্লট রয়েছে)।`,
          entryIds: unpairedEntries.map(e => e.id),
          classId: cls.id,
          sectionId: sec.id,
        });
      }
    });
  });

  // 2D. Same-Day Subject Repeat Check (KG - Class 10):
  //     Same subject CANNOT be assigned more than once on the same day in the same section.
  const sectionDaySubjectMap = new Map<string, TimetableEntry[]>();
  entries.forEach(entry => {
    const cls = classMap.get(entry.classId);
    if (cls && isPlayOrNursery(cls)) return;
    const key = `${entry.classId}_${entry.sectionId}_${entry.day}_${entry.subjectId}`;
    const list = sectionDaySubjectMap.get(key) || [];
    list.push(entry);
    sectionDaySubjectMap.set(key, list);
  });

  sectionDaySubjectMap.forEach(matched => {
    if (matched.length > 1) {
      const first = matched[0];
      const sectionLabel = getSectionName(first.classId, first.sectionId);
      const subName = subjects?.find(s => s.id === first.subjectId)?.name || first.subjectId;
      conflicts.push({
        id: `conf-same-day-${first.classId}-${first.sectionId}-${first.day}-${first.subjectId}`,
        type: 'class_double_booking',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Same-Day Subject Repeat (${matched.length}x): ${subName}`,
        description: `একই দিনে একটি বিষয়ের ক্লাস একবারের বেশি দেওয়া যাবে না: ${sectionLabel}-এ ${first.day} দিনে "${subName}" ${matched.length} বার (${matched.map(e => `P${e.periodIndex}`).join(', ')}) নির্ধারণ করা হয়েছে।`,
        entryIds: matched.map(e => e.id),
        classId: first.classId,
        sectionId: first.sectionId,
      });
    }
  });

  // 2E. Weekly Subject Over-Quota Check (respecting section-wise selected subjects & quotas):
  classes.forEach(cls => {
    if (isPlayOrNursery(cls)) return;

    cls.sections.forEach(sec => {
      const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
      if (secEntries.length === 0) return;

      const effectiveReqs = getEffectiveSectionRequirements(cls, sec.id, teachers);
      const hasHmt =
        isClassNineOrTen(cls) &&
        effectiveReqs.some(r => isHigherMathSubject(r.subjectId, subjects));
      const hasRel = effectiveReqs.some(r => isIslamReligionSubject(r.subjectId, subjects));

      effectiveReqs.forEach(req => {
        let effectiveMax = req.periodsPerWeek;
        if (hasHmt && isAgricultureSubject(req.subjectId, subjects)) {
          const hmtReq = effectiveReqs.find(r => isHigherMathSubject(r.subjectId, subjects));
          if (hmtReq) effectiveMax = Math.max(effectiveMax, hmtReq.periodsPerWeek);
        }
        if (hasRel && isHinduReligionSubject(req.subjectId, subjects)) {
          const relReq = effectiveReqs.find(r => isIslamReligionSubject(r.subjectId, subjects));
          if (relReq) effectiveMax = Math.max(effectiveMax, relReq.periodsPerWeek);
        }

        const matched = secEntries.filter(e => e.subjectId === req.subjectId);
        if (matched.length > effectiveMax) {
          const subName = subjects?.find(s => s.id === req.subjectId)?.name || req.subjectId;
          const sectionLabel = `${cls.name} (${sec.name})`;
          conflicts.push({
            id: `conf-over-quota-${cls.id}-${sec.id}-${req.subjectId}`,
            type: 'class_double_booking',
            severity: 'error',
            day: matched[matched.length - 1].day,
            periodIndex: matched[matched.length - 1].periodIndex,
            title: `Weekly Subject Over-Quota (${matched.length}/${effectiveMax}): ${subName}`,
            description: `${sectionLabel}-এ সাপ্তাহিক নির্ধারিত পিরিয়ডের বেশি দেওয়া যাবে না: "${subName}" সপ্তাহে ${effectiveMax}টি নির্ধারিত থাকলেও ${matched.length}টি দেওয়া হয়েছে।`,
            entryIds: matched.map(e => e.id),
            classId: cls.id,
            sectionId: sec.id,
          });
        }
      });
    });
  });

  // 2F. Section-wise Subject Selection Compliance Check:
  entries.forEach(entry => {
    const cls = classMap.get(entry.classId);
    if (!cls || isPlayOrNursery(cls)) return;
    if (!isSubjectSelectedForSection(cls, entry.sectionId, entry.subjectId)) {
      const subName = subjects?.find(s => s.id === entry.subjectId)?.name || entry.subjectId;
      const sectionLabel = getSectionName(entry.classId, entry.sectionId);
      conflicts.push({
        id: `conf-unsel-${entry.id}`,
        type: 'unselected_subject',
        severity: 'error',
        day: entry.day,
        periodIndex: entry.periodIndex,
        title: `Unselected Subject in Routine: ${subName}`,
        description: `${sectionLabel}-এর নির্বাচিত বিষয় তালিকায় "${subName}" অন্তর্ভুক্ত নেই, অথচ ${entry.day} (Period ${entry.periodIndex})-এ এটি যুক্ত রয়েছে।`,
        entryIds: [entry.id],
        classId: entry.classId,
        sectionId: entry.sectionId,
      });
    }
  });

  // 2G. Section-wise Teacher Assignment Verification:
  //     If a section+subject has an explicitly configured expected teacher, entries MUST match that teacher.
  entries.forEach(entry => {
    const cls = classMap.get(entry.classId);
    if (!cls || isPlayOrNursery(cls)) return;

    let expectedTeacherId = getExpectedSectionTeacherId(cls, entry.sectionId, entry.subjectId, teachers);

    // Combined Room 307 Hindu Religion fallback: if combined Hindu class in Room 307 runs simultaneously with other sections,
    // use combinedHinduTeacherId if section didn't explicitly pick a different teacher.
    if (isHinduReligionSubject(entry.subjectId, subjects) && isHinduReligionRoom(entry.room, settings)) {
      const sec = cls.sections.find(s => s.id === entry.sectionId);
      const explicitSecTch = sec?.subjectConfigs?.[entry.subjectId]?.assignedTeacherId;
      if (explicitSecTch === undefined && combinedHinduTeacherId) {
        expectedTeacherId = combinedHinduTeacherId;
      }
    }

    if (expectedTeacherId && entry.teacherId !== expectedTeacherId) {
      const expectedName = teacherMap.get(expectedTeacherId)?.name || expectedTeacherId;
      const actualName = teacherMap.get(entry.teacherId)?.name || entry.teacherId || 'None';
      const subName = subjects?.find(s => s.id === entry.subjectId)?.name || entry.subjectId;
      const sectionLabel = getSectionName(entry.classId, entry.sectionId);
      conflicts.push({
        id: `conf-wrong-tch-${entry.id}`,
        type: 'wrong_teacher_assignment',
        severity: 'error',
        day: entry.day,
        periodIndex: entry.periodIndex,
        title: `Wrong Section Teacher: ${sectionLabel}`,
        description: `${sectionLabel}-এ "${subName}" বিষয়ের জন্য নির্ধারিত শিক্ষক ${expectedName}, কিন্তু ${entry.day} (Period ${entry.periodIndex})-এ ${actualName} নির্ধারিত রয়েছে।`,
        entryIds: [entry.id],
        teacherId: entry.teacherId,
        classId: entry.classId,
        sectionId: entry.sectionId,
      });
    }
  });

  // 2H. Subject Fixed Period Restriction Check (KG - Class 10):
  //     If a subject is restricted to specific allowed periods, flag any entry outside those periods.
  entries.forEach(entry => {
    const cls = classMap.get(entry.classId);
    if (!cls || isPlayOrNursery(cls)) return;
    const allowedPeriods = getEffectiveSubjectFixedPeriods(cls, entry.sectionId, entry.subjectId, subjects);
    if (allowedPeriods && allowedPeriods.length > 0 && !allowedPeriods.includes(entry.periodIndex)) {
      const subName = subjects?.find(s => s.id === entry.subjectId)?.name || entry.subjectId;
      const sectionLabel = getSectionName(entry.classId, entry.sectionId);
      const allowedLabel = allowedPeriods.map(p => `P${p}`).join(', ');
      conflicts.push({
        id: `conf-fixed-period-${entry.id}`,
        type: 'subject_fixed_period',
        severity: 'error',
        day: entry.day,
        periodIndex: entry.periodIndex,
        title: `Subject Period Restriction: ${subName} (${sectionLabel})`,
        description: `${sectionLabel}-এ "${subName}" বিষয়টি শুধুমাত্র নির্ধারিত পিরিয়ডে (${allowedLabel}) রাখার নিয়ম রয়েছে, কিন্তু ${entry.day} (Period ${entry.periodIndex})-এ নির্ধারিত হয়েছে।`,
        entryIds: [entry.id],
        classId: entry.classId,
        sectionId: entry.sectionId,
      });
    }
  });

  // 3. Check Block Teacher Isolation (Play/Nursery block teachers cannot teach KG-10)
  entries.forEach(entry => {
    const teacher = teacherMap.get(entry.teacherId);
    const cls = classMap.get(entry.classId);
    if (!teacher || !cls) return;

    if (isTeacherBlockTeacher(teacher, classes) && !isPlayOrNursery(cls)) {
      conflicts.push({
        id: `conf-blk-${entry.id}`,
        type: 'teacher_unavailable',
        severity: 'error',
        day: entry.day,
        periodIndex: entry.periodIndex,
        title: `Block Teacher Policy Violation: ${teacher.name}`,
        description: `${teacher.name} একজন ব্লক টিচার (শুধুমাত্র Play/Nursery-র জন্য)। প্রাতিষ্ঠানিক নিয়ম অনুযায়ী তাঁকে ${cls.name}-এ ক্লাস দেওয়া যাবে না।`,
        entryIds: [entry.id],
        teacherId: teacher.id,
        classId: entry.classId,
        sectionId: entry.sectionId,
      });
    }
  });

  // Helper: Deduplicate Combined Hindu Room 307 wave entries into physical teaching periods per (day, periodIndex)
  const getPhysicalPeriodSlotsForTeacherDay = (teacherId: string, day: DayOfWeek) => {
    const dayEntries = entries
      .filter(e => e.teacherId === teacherId && e.day === day)
      .sort((a, b) => a.periodIndex - b.periodIndex);

    const byPeriod = new Map<number, TimetableEntry[]>();
    dayEntries.forEach(e => {
      const list = byPeriod.get(e.periodIndex) || [];
      list.push(e);
      byPeriod.set(e.periodIndex, list);
    });

    const physicalSlots: { periodIndex: number; entries: TimetableEntry[] }[] = [];
    Array.from(byPeriod.keys())
      .sort((a, b) => a - b)
      .forEach(pIdx => {
        physicalSlots.push({ periodIndex: pIdx, entries: byPeriod.get(pIdx)! });
      });
    return physicalSlots;
  };

  // 4. Check for Max Consecutive Classes per Teacher (on deduplicated physical teaching slots)
  teachers.forEach(teacher => {
    const maxConsecutive = teacher.maxConsecutivePeriods || 2;
    workingDays.forEach(day => {
      const physicalDaySlots = getPhysicalPeriodSlotsForTeacherDay(teacher.id, day);
      if (physicalDaySlots.length <= maxConsecutive) return;

      let consecutiveRun: { periodIndex: number; entries: TimetableEntry[] }[] = [];
      for (let i = 0; i < physicalDaySlots.length; i++) {
        const cur = physicalDaySlots[i];
        if (consecutiveRun.length === 0) {
          consecutiveRun.push(cur);
        } else {
          const prev = consecutiveRun[consecutiveRun.length - 1];
          if (cur.periodIndex === prev.periodIndex + 1) {
            consecutiveRun.push(cur);
            if (consecutiveRun.length > maxConsecutive) {
              conflicts.push({
                id: `conf-consec-${teacher.id}-${day}-${cur.periodIndex}`,
                type: 'max_consecutive_exceeded',
                severity: 'warning',
                day: day,
                periodIndex: cur.periodIndex,
                title: `Consecutive Limit: ${teacher.name}`,
                description: `${teacher.name} has ${consecutiveRun.length} consecutive periods scheduled without a break on ${day} (Periods ${consecutiveRun.map(s => s.periodIndex).join(', ')}). Policy allows maximum ${maxConsecutive} consecutive classes.`,
                entryIds: consecutiveRun.flatMap(s => s.entries.map(e => e.id)),
                teacherId: teacher.id,
              });
            }
          } else {
            consecutiveRun = [cur];
          }
        }
      }
    });
  });

  // 5. Check for Teacher Availability (Period-wide unavailablePeriods AND specific Day+Period unavailableSlots)
  teacherSlotMap.forEach(matched => {
    const first = matched[0];
    const teacher = teacherMap.get(first.teacherId);
    if (!teacher) return;
    if (isTeacherBlockedAtSlot(teacher, first.day, first.periodIndex)) {
      const isPeriodWide = Boolean(teacher.unavailablePeriods?.includes(first.periodIndex));
      const classNames = matched.map(e => getSectionName(e.classId, e.sectionId)).join(', ');
      conflicts.push({
        id: `conf-unavail-${teacher.id}-${first.day}-${first.periodIndex}`,
        type: 'teacher_unavailable',
        severity: 'error',
        day: first.day,
        periodIndex: first.periodIndex,
        title: `Teacher Blocked Period: ${teacher.name}`,
        description: isPeriodWide
          ? `${teacher.name}-এর জন্য Period ${first.periodIndex} সম্পূর্ণ বন্ধ (সব দিন) নির্ধারিত রয়েছে, অথচ ${first.day} তারিখে ${classNames}-এ ক্লাস দেওয়া হয়েছে।`
          : `${teacher.name}-এর জন্য ${first.day}, Period ${first.periodIndex} বন্ধ (অনুপলব্ধ) নির্ধারিত রয়েছে, অথচ ${classNames}-এ ক্লাস দেওয়া হয়েছে।`,
        entryIds: matched.map(e => e.id),
        teacherId: teacher.id,
      });
    }
  });

  // 6. Check Teacher Daily & Weekly Maximum Period Limits (deduplicated for combined Room 307 sessions)
  const maxWeeklySlots = Math.max(1, workingDays.length * Math.max(1, periodIndices.length));
  teachers.forEach(teacher => {
    let totalPhysicalPeriods = 0;
    const allTeacherEntries = entries.filter(e => e.teacherId === teacher.id);
    const maxDaily = teacher.maxDailyPeriods || 4;

    workingDays.forEach(day => {
      const physicalDaySlots = getPhysicalPeriodSlotsForTeacherDay(teacher.id, day);
      totalPhysicalPeriods += physicalDaySlots.length;
      if (physicalDaySlots.length > maxDaily) {
        const dayEntries = physicalDaySlots.flatMap(s => s.entries);
        conflicts.push({
          id: `conf-tdaily-${teacher.id}-${day}`,
          type: 'teacher_limit_exceeded',
          severity: 'warning',
          day,
          periodIndex: physicalDaySlots[physicalDaySlots.length - 1].periodIndex,
          title: `Daily Period Limit Exceeded: ${teacher.name}`,
          description: `${teacher.name} has ${physicalDaySlots.length} physical classes on ${day}, exceeding configured daily maximum of ${maxDaily} periods.`,
          entryIds: dayEntries.map(e => e.id),
          teacherId: teacher.id,
        });
      }
    });

    if (totalPhysicalPeriods > maxWeeklySlots) {
      conflicts.push({
        id: `conf-tweek-${teacher.id}`,
        type: 'teacher_limit_exceeded',
        severity: 'error',
        day: workingDays[0] || 'Sunday',
        periodIndex: periodIndices[0] || 1,
        title: `Teacher Weekly Capacity Exceeded: ${teacher.name}`,
        description: `${teacher.name} has ${totalPhysicalPeriods} physical periods scheduled this week, exceeding total available teaching slots (${maxWeeklySlots}).`,
        entryIds: allTeacherEntries.map(e => e.id),
        teacherId: teacher.id,
      });
    }
  });

  return conflicts;
}
