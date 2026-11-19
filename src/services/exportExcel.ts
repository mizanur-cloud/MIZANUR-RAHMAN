import * as XLSX from 'xlsx';
import { AppState } from './storage';
import { getEffectiveSectionRequirements } from './parallelSubjects';

export function exportTimetableExcel(state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const periodMap = new Map(settings.periodTimings.map(p => [p.periodIndex, p]));

  const wb = XLSX.utils.book_new();

  // Sheet 1: Master Schedule Records
  const recordsData = entries.map(e => {
    const cls = classMap.get(e.classId);
    const sec = cls?.sections.find(s => s.id === e.sectionId);
    const sub = subjectMap.get(e.subjectId);
    const tch = teacherMap.get(e.teacherId);
    const period = periodMap.get(e.periodIndex);

    return {
      'Day': e.day,
      'Period': period?.label || `Period ${e.periodIndex}`,
      'Start Time': period?.startTime || '',
      'End Time': period?.endTime || '',
      'Class': cls?.name || 'Class',
      'Section': sec?.name || 'Section',
      'Subject': sub?.name || 'Subject',
      'Subject Code': sub?.code || '',
      'Teacher': tch?.name || 'Teacher',
      'Teacher Designation': tch?.designation || '',
      'Room': e.room || sec?.roomNumber || '',
    };
  });

  const wsRecords = XLSX.utils.json_to_sheet(recordsData);
  XLSX.utils.book_append_sheet(wb, wsRecords, 'Schedule Records');

  // Sheet 2: Teacher Load Summary
  const teacherLoadData = teachers.map(tch => {
    const assigned = entries.filter(e => e.teacherId === tch.id);
    const daysActive = new Set(assigned.map(e => e.day)).size;

    return {
      'Teacher Name': tch.name,
      'Designation': tch.designation,
      'Initials': tch.initials,
      'Total Weekly Periods': assigned.length,
      'Active Teaching Days': daysActive,
      'Max Consecutive Allowed': tch.maxConsecutivePeriods || 2,
      'Email': tch.email || '—',
      'Phone': tch.phone || '—',
    };
  });

  const wsTeachers = XLSX.utils.json_to_sheet(teacherLoadData);
  XLSX.utils.book_append_sheet(wb, wsTeachers, 'Teacher Summary');

  // Sheet 3: Class Subject Quotas
  const classQuotaData: Record<string, string | number>[] = [];
  classes.forEach(c => {
    c.sections.forEach(s => {
      getEffectiveSectionRequirements(c, s.id).forEach(req => {
        const sub = subjectMap.get(req.subjectId);
        const assignedPeriods = entries.filter(
          e => e.classId === c.id && e.sectionId === s.id && e.subjectId === req.subjectId
        ).length;

        classQuotaData.push({
          'Class': c.name,
          'Section': s.name,
          'Subject': sub?.name || req.subjectId,
          'Required Periods/Week': req.periodsPerWeek,
          'Scheduled Periods': assignedPeriods,
          'Fulfillment': assignedPeriods >= req.periodsPerWeek ? 'Complete' : `Short (${req.periodsPerWeek - assignedPeriods})`,
        });
      });
    });
  });

  const wsQuotas = XLSX.utils.json_to_sheet(classQuotaData);
  XLSX.utils.book_append_sheet(wb, wsQuotas, 'Class Subject Quotas');

  XLSX.writeFile(wb, `${settings.schoolName.replace(/\s+/g, '_')}_Master_Timetable.xlsx`);
}
