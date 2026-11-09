import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AppState } from './storage';
import { DayOfWeek, PeriodTiming, SchoolClass, Subject, Teacher, TimetableEntry } from '../types';

function renderPdfHeader(
  doc: jsPDF,
  schoolName: string,
  academicYear: string,
  title: string,
  subtitle?: string
) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // School Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 58, 138); // Navy blue
  doc.text(schoolName.toUpperCase(), pageWidth / 2, 14, { align: 'center' });

  // Academic Year
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105); // Slate
  doc.text(`Academic Year: ${academicYear}`, pageWidth / 2, 20, { align: 'center' });

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42); // Dark slate
  const fullTitle = subtitle ? `${title} — ${subtitle}` : title;
  doc.text(fullTitle, pageWidth / 2, 26, { align: 'center' });

  // Divider line
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(14, 29, pageWidth - 14, 29);
}

function addPdfFooter(doc: jsPDF) {
  const totalPages = (doc as any).internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
    doc.text('Smart School Routine Management System • Generated Timetable', 14, pageHeight - 8);
  }
}

// 1. Export Complete School Routine PDF
export function exportCompleteSchoolPdf(state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  // Landscape A4 for wide timetable columns
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const activePeriods = settings.periodTimings.filter(p => !p.isBreak);

  let isFirstPage = true;

  classes.forEach(cls => {
    cls.sections.forEach(sec => {
      if (!isFirstPage) {
        doc.addPage();
      }
      isFirstPage = false;

      renderPdfHeader(
        doc,
        settings.schoolName,
        settings.academicYear,
        'MASTER CLASS TIMETABLE',
        `${cls.name} - ${sec.name} ${sec.roomNumber ? `(${sec.roomNumber})` : ''}`
      );

      const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);

      // Build table headers
      const head = [
        ['Day / Period', ...activePeriods.map(p => `${p.label}\n${p.startTime}-${p.endTime}`)],
      ];

      // Build data rows
      const body = settings.workingDays.map(day => {
        const row: string[] = [day];
        activePeriods.forEach(p => {
          const match = secEntries.find(e => e.day === day && e.periodIndex === p.periodIndex);
          if (match) {
            const sub = subjectMap.get(match.subjectId);
            const tch = teacherMap.get(match.teacherId);
            row.push(`${sub?.name || 'Class'}\n(${tch?.initials || tch?.name || 'TBA'})`);
          } else {
            row.push('—');
          }
        });
        return row;
      });

      autoTable(doc, {
        startY: 33,
        head: head,
        body: body,
        theme: 'grid',
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: 255,
          fontStyle: 'bold',
          halign: 'center',
          fontSize: 9,
        },
        bodyStyles: {
          halign: 'center',
          valign: 'middle',
          fontSize: 8,
          cellPadding: 4,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 26 },
        },
      });
    });
  });

  addPdfFooter(doc);
  doc.save(`${settings.schoolName.replace(/\s+/g, '_')}_Complete_School_Routine.pdf`);
}

// 2. Export Individual Class Routine PDF
export function exportClassPdf(classId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const cls = classes.find(c => c.id === classId);
  if (!cls) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const activePeriods = settings.periodTimings.filter(p => !p.isBreak);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  let isFirst = true;

  cls.sections.forEach(sec => {
    if (!isFirst) doc.addPage();
    isFirst = false;

    renderPdfHeader(
      doc,
      settings.schoolName,
      settings.academicYear,
      `WEEKLY ROUTINE - ${cls.name.toUpperCase()}`,
      `${sec.name} ${sec.roomNumber ? `(${sec.roomNumber})` : ''}`
    );

    const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);

    const head = [
      ['Day / Period', ...activePeriods.map(p => `${p.label}\n${p.startTime}-${p.endTime}`)],
    ];

    const body = settings.workingDays.map(day => {
      const row: string[] = [day];
      activePeriods.forEach(p => {
        const match = secEntries.find(e => e.day === day && e.periodIndex === p.periodIndex);
        if (match) {
          const sub = subjectMap.get(match.subjectId);
          const tch = teacherMap.get(match.teacherId);
          row.push(`${sub?.name || 'Class'}\n(${tch?.name || tch?.initials || 'TBA'})`);
        } else {
          row.push('—');
        }
      });
      return row;
    });

    autoTable(doc, {
      startY: 33,
      head: head,
      body: body,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 58, 138],
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center',
        fontSize: 9,
      },
      bodyStyles: {
        halign: 'center',
        valign: 'middle',
        fontSize: 8,
        cellPadding: 4,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 26 },
      },
    });
  });

  addPdfFooter(doc);
  doc.save(`${cls.name.replace(/\s+/g, '_')}_Weekly_Routine.pdf`);
}

// 3. Export Individual Section Routine PDF
export function exportSectionPdf(classId: string, sectionId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const cls = classes.find(c => c.id === classId);
  const sec = cls?.sections.find(s => s.id === sectionId);
  if (!cls || !sec) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const activePeriods = settings.periodTimings.filter(p => !p.isBreak);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  renderPdfHeader(
    doc,
    settings.schoolName,
    settings.academicYear,
    'WEEKLY CLASS TIMETABLE',
    `${cls.name} - ${sec.name} ${sec.roomNumber ? `(${sec.roomNumber})` : ''}`
  );

  const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);

  const head = [
    ['Day / Period', ...activePeriods.map(p => `${p.label}\n${p.startTime}-${p.endTime}`)],
  ];

  const body = settings.workingDays.map(day => {
    const row: string[] = [day];
    activePeriods.forEach(p => {
      const match = secEntries.find(e => e.day === day && e.periodIndex === p.periodIndex);
      if (match) {
        const sub = subjectMap.get(match.subjectId);
        const tch = teacherMap.get(match.teacherId);
        row.push(`${sub?.name || 'Class'}\n(${tch?.name || tch?.initials || 'TBA'})`);
      } else {
        row.push('—');
      }
    });
    return row;
  });

  autoTable(doc, {
    startY: 33,
    head: head,
    body: body,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 9,
    },
    bodyStyles: {
      halign: 'center',
      valign: 'middle',
      fontSize: 8.5,
      cellPadding: 5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 28 },
    },
  });

  addPdfFooter(doc);
  doc.save(`${cls.name.replace(/\s+/g, '_')}_${sec.name.replace(/\s+/g, '_')}_Routine.pdf`);
}

// 4. Export Individual Teacher Routine PDF (Shows prompt table format)
export function exportTeacherPdf(teacherId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const teacher = teachers.find(t => t.id === teacherId);
  if (!teacher) return;

  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  renderPdfHeader(
    doc,
    settings.schoolName,
    settings.academicYear,
    'TEACHER INDIVIDUAL WEEKLY ROUTINE',
    `Teacher Name: ${teacher.name} (${teacher.designation})`
  );

  const teacherEntries = entries.filter(e => e.teacherId === teacher.id);
  const dayOrder: Record<string, number> = {};
  settings.workingDays.forEach((d, idx) => (dayOrder[d] = idx));

  const sorted = [...teacherEntries].sort((a, b) => {
    const dDiff = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
    if (dDiff !== 0) return dDiff;
    return a.periodIndex - b.periodIndex;
  });

  const head = [['Day', 'Period', 'Period Time', 'Class', 'Section', 'Subject']];

  const body = sorted.map(entry => {
    const period = settings.periodTimings.find(p => p.periodIndex === entry.periodIndex);
    const cls = classMap.get(entry.classId);
    const sec = cls?.sections.find(s => s.id === entry.sectionId);
    const sub = subjectMap.get(entry.subjectId);

    return [
      entry.day,
      period?.label || `Period ${entry.periodIndex}`,
      `${period?.startTime || ''} - ${period?.endTime || ''}`,
      cls?.name || 'Class',
      sec?.name || 'Section',
      sub?.name || 'Subject',
    ];
  });

  autoTable(doc, {
    startY: 33,
    head: head,
    body: body,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8.5,
      cellPadding: 4,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  addPdfFooter(doc);
  doc.save(`${teacher.name.replace(/\s+/g, '_')}_Weekly_Routine.pdf`);
}

// 5. Export All Teachers' Combined Routine PDF (Separate page for each teacher)
export function exportAllTeachersPdf(state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjectMap = new Map(subjects.map(s => [s.id, s]));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const dayOrder: Record<string, number> = {};
  settings.workingDays.forEach((d, idx) => (dayOrder[d] = idx));

  let isFirst = true;

  teachers.forEach(teacher => {
    if (!isFirst) doc.addPage();
    isFirst = false;

    renderPdfHeader(
      doc,
      settings.schoolName,
      settings.academicYear,
      'TEACHER INDIVIDUAL WEEKLY ROUTINE',
      `Teacher Name: ${teacher.name} (${teacher.designation})`
    );

    const teacherEntries = entries.filter(e => e.teacherId === teacher.id);
    const sorted = [...teacherEntries].sort((a, b) => {
      const dDiff = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
      if (dDiff !== 0) return dDiff;
      return a.periodIndex - b.periodIndex;
    });

    const head = [['Day', 'Period', 'Period Time', 'Class', 'Section', 'Subject']];

    const body = sorted.map(entry => {
      const period = settings.periodTimings.find(p => p.periodIndex === entry.periodIndex);
      const cls = classMap.get(entry.classId);
      const sec = cls?.sections.find(s => s.id === entry.sectionId);
      const sub = subjectMap.get(entry.subjectId);

      return [
        entry.day,
        period?.label || `Period ${entry.periodIndex}`,
        `${period?.startTime || ''} - ${period?.endTime || ''}`,
        cls?.name || 'Class',
        sec?.name || 'Section',
        sub?.name || 'Subject',
      ];
    });

    autoTable(doc, {
      startY: 33,
      head: head,
      body: body,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 58, 138],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: {
        fontSize: 8.5,
        cellPadding: 3.5,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
    });
  });

  addPdfFooter(doc);
  doc.save(`${settings.schoolName.replace(/\s+/g, '_')}_All_Teachers_Routine.pdf`);
}
