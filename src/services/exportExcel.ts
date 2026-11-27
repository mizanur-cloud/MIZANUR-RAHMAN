import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { AppState } from './storage';
import { getEffectiveSectionRequirements } from './parallelSubjects';
import { getTeacherDailyMax, getTeacherMaxWorkingDays } from './workloadService';

/**
 * Neutralizes spreadsheet formula injection (CSV/Excel cells starting with =, +, -, @, tab, or CR)
 * while preserving numeric values cleanly.
 */
export function sanitizeSpreadsheetCell(value: string | number | undefined | null): string | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const str = String(value ?? '');
  if (!str) return '';
  if (/^[\s\u0000-\u001f]*[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function addWorksheetFromRecords(
  wb: ExcelJS.Workbook,
  sheetName: string,
  records: Record<string, string | number>[]
) {
  const ws = wb.addWorksheet(sheetName);
  if (records.length === 0) return ws;

  const headers = Object.keys(records[0]);
  ws.columns = headers.map(header => {
    const maxCellLen = records.reduce(
      (max, row) => Math.max(max, String(row[header] ?? '').length),
      header.length
    );
    return {
      header,
      key: header,
      width: Math.min(42, Math.max(12, maxCellLen + 3)),
    };
  });

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };

  records.forEach(record => {
    const sanitizedRow: Record<string, string | number> = {};
    headers.forEach(h => {
      sanitizedRow[h] = sanitizeSpreadsheetCell(record[h]);
    });
    ws.addRow(sanitizedRow);
  });

  return ws;
}

export async function exportTimetableExcel(state: AppState): Promise<void> {
  const { classes, subjects, teachers, settings, entries } = state;
  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const periodMap = new Map(settings.periodTimings.map(p => [p.periodIndex, p]));

  const wb = new ExcelJS.Workbook();
  wb.creator = settings.schoolName || 'Smart Routine Management System';
  wb.created = new Date();

  // Sheet 1: Master Schedule Records
  const recordsData: Record<string, string | number>[] = entries.map(e => {
    const cls = classMap.get(e.classId);
    const sec = cls?.sections.find(s => s.id === e.sectionId);
    const sub = subjectMap.get(e.subjectId);
    const tch = teacherMap.get(e.teacherId);
    const period = periodMap.get(e.periodIndex);

    return {
      Day: sanitizeSpreadsheetCell(e.day),
      Period: sanitizeSpreadsheetCell(period?.label || `Period ${e.periodIndex}`),
      'Start Time': sanitizeSpreadsheetCell(period?.startTime || ''),
      'End Time': sanitizeSpreadsheetCell(period?.endTime || ''),
      Class: sanitizeSpreadsheetCell(cls?.name || 'Class'),
      Section: sanitizeSpreadsheetCell(sec?.name || 'Section'),
      Subject: sanitizeSpreadsheetCell(sub?.name || 'Subject'),
      'Subject Code': sanitizeSpreadsheetCell(sub?.code || ''),
      Teacher: sanitizeSpreadsheetCell(tch?.name || 'Teacher'),
      'Teacher Designation': sanitizeSpreadsheetCell(tch?.designation || ''),
      Room: sanitizeSpreadsheetCell(e.room || sec?.roomNumber || ''),
    };
  });

  addWorksheetFromRecords(
    wb,
    'Schedule Records',
    recordsData.length > 0 ? recordsData : [{ Status: 'No scheduled periods found' }]
  );

  // Sheet 2: Teacher Load Summary
  const teacherLoadData: Record<string, string | number>[] = teachers.map(tch => {
    const assigned = entries.filter(e => e.teacherId === tch.id);
    const uniqueSlots = new Set(assigned.map(e => `${e.day}_${e.periodIndex}`)).size;
    const daysActive = new Set(assigned.map(e => e.day)).size;

    return {
      'Teacher Name': sanitizeSpreadsheetCell(tch.name),
      Designation: sanitizeSpreadsheetCell(tch.designation),
      Initials: sanitizeSpreadsheetCell(tch.initials),
      'Total Weekly Periods': uniqueSlots,
      'Active Teaching Days': daysActive,
      'Max Working Days': getTeacherMaxWorkingDays(tch, settings),
      'Max Daily Periods': getTeacherDailyMax(tch, settings),
      'Max Consecutive Allowed': Math.min(3, tch.maxConsecutivePeriods || 2),
    };
  });

  addWorksheetFromRecords(
    wb,
    'Teacher Summary',
    teacherLoadData.length > 0 ? teacherLoadData : [{ Status: 'No teachers configured' }]
  );

  // Sheet 3: Class Subject Quotas
  const classQuotaData: Record<string, string | number>[] = [];
  classes.forEach(c => {
    c.sections.forEach(s => {
      getEffectiveSectionRequirements(c, s.id, teachers).forEach(req => {
        const sub = subjectMap.get(req.subjectId);
        const assignedPeriods = entries.filter(
          e => e.classId === c.id && e.sectionId === s.id && e.subjectId === req.subjectId
        ).length;

        classQuotaData.push({
          Class: sanitizeSpreadsheetCell(c.name),
          Section: sanitizeSpreadsheetCell(s.name),
          Subject: sanitizeSpreadsheetCell(sub?.name || req.subjectId),
          'Required Periods/Week': req.periodsPerWeek,
          'Scheduled Periods': assignedPeriods,
          Fulfillment: sanitizeSpreadsheetCell(
            assignedPeriods >= req.periodsPerWeek
              ? 'Complete'
              : `Short (${req.periodsPerWeek - assignedPeriods})`
          ),
        });
      });
    });
  });

  addWorksheetFromRecords(
    wb,
    'Class Subject Quotas',
    classQuotaData.length > 0 ? classQuotaData : [{ Status: 'No subject quotas configured' }]
  );

  const safeSchoolPrefix = (settings.schoolName || 'School').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const buffer = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${safeSchoolPrefix}_Master_Timetable.xlsx`
  );
}
