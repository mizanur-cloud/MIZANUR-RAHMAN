import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
import { AppState } from './storage';
import { DayOfWeek, PeriodTiming, SchoolClass, Subject, Teacher, TimetableEntry } from '../types';

const BORDER_STYLE = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: 'CCCCCC',
};

const CELL_BORDERS = {
  top: BORDER_STYLE,
  bottom: BORDER_STYLE,
  left: BORDER_STYLE,
  right: BORDER_STYLE,
};

function createHeaderParagraphs(schoolName: string, academicYear: string, title: string, subtitle?: string): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: schoolName.toUpperCase(),
          bold: true,
          size: 32, // 16pt
          color: '1E3A8A',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `ACADEMIC YEAR: ${academicYear}`,
          bold: true,
          size: 20, // 10pt
          color: '475569',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 26, // 13pt
          color: '0F172A',
        }),
        ...(subtitle
          ? [
              new TextRun({
                text: ` - ${subtitle}`,
                bold: false,
                size: 22,
                color: '334155',
              }),
            ]
          : []),
      ],
    }),
  ];
  return paragraphs;
}

function buildClassSectionTable(
  cls: SchoolClass,
  secName: string,
  entries: TimetableEntry[],
  workingDays: DayOfWeek[],
  periodTimings: PeriodTiming[],
  subjectMap: Map<string, Subject>,
  teacherMap: Map<string, Teacher>
): Table {
  // Filter only teaching periods
  const activePeriods = periodTimings.filter(p => !p.isBreak);

  // Table columns: Day + each period
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 1400, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1E3A8A' },
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'DAY / PERIOD', bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
      ...activePeriods.map(
        p =>
          new TableCell({
            width: { size: Math.floor(8200 / activePeriods.length), type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: '1E3A8A' },
            borders: CELL_BORDERS,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: p.label, bold: true, color: 'FFFFFF', size: 18 })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `${p.startTime}-${p.endTime}`, color: 'E2E8F0', size: 14 })],
              }),
            ],
          })
      ),
    ],
  });

  const dataRows = workingDays.map((day, dayIdx) => {
    const isAlt = dayIdx % 2 === 1;
    const rowBg = isAlt ? 'F8FAFC' : 'FFFFFF';

    const cells: TableCell[] = [
      new TableCell({
        width: { size: 1400, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: day, bold: true, size: 18, color: '0F172A' })],
          }),
        ],
      }),
    ];

    activePeriods.forEach(p => {
      const match = entries.find(e => e.day === day && e.periodIndex === p.periodIndex);
      const sub = match ? subjectMap.get(match.subjectId) : null;
      const tch = match ? teacherMap.get(match.teacherId) : null;

      cells.push(
        new TableCell({
          width: { size: Math.floor(8200 / activePeriods.length), type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: rowBg },
          borders: CELL_BORDERS,
          children: match
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 40, after: 20 },
                  children: [new TextRun({ text: sub?.name || 'Class', bold: true, size: 18, color: '0F172A' })],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 40 },
                  children: [
                    new TextRun({
                      text: `${tch?.name || tch?.initials || ''}${match.room ? ` (${match.room})` : ''}`,
                      color: '475569',
                      size: 15,
                    }),
                  ],
                }),
              ]
            : [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: '—', color: 'CBD5E1', size: 16 })],
                }),
              ],
        })
      );
    });

    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });
}

function buildTeacherTable(
  teacher: Teacher,
  entries: TimetableEntry[],
  workingDays: DayOfWeek[],
  periodTimings: PeriodTiming[],
  classes: SchoolClass[],
  subjectMap: Map<string, Subject>
): Table {
  const classMap = new Map<string, SchoolClass>();
  classes.forEach(c => classMap.set(c.id, c));

  const teacherEntries = entries.filter(e => e.teacherId === teacher.id);
  // Sort chronologically by Day then Period
  const dayOrder: Record<string, number> = {};
  workingDays.forEach((d, idx) => (dayOrder[d] = idx));

  const sorted = [...teacherEntries].sort((a, b) => {
    const dDiff = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
    if (dDiff !== 0) return dDiff;
    return a.periodIndex - b.periodIndex;
  });

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1E3A8A' },
        borders: CELL_BORDERS,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DAY', bold: true, color: 'FFFFFF', size: 18 })] })],
      }),
      new TableCell({
        width: { size: 1400, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1E3A8A' },
        borders: CELL_BORDERS,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'PERIOD', bold: true, color: 'FFFFFF', size: 18 })] })],
      }),
      new TableCell({
        width: { size: 1800, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1E3A8A' },
        borders: CELL_BORDERS,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'TIME', bold: true, color: 'FFFFFF', size: 18 })] })],
      }),
      new TableCell({
        width: { size: 1800, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1E3A8A' },
        borders: CELL_BORDERS,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'CLASS & SEC', bold: true, color: 'FFFFFF', size: 18 })] })],
      }),
      new TableCell({
        width: { size: 3000, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1E3A8A' },
        borders: CELL_BORDERS,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'SUBJECT', bold: true, color: 'FFFFFF', size: 18 })] })],
      }),
    ],
  });

  const rows = sorted.map((entry, idx) => {
    const isAlt = idx % 2 === 1;
    const rowBg = isAlt ? 'F8FAFC' : 'FFFFFF';
    const period = periodTimings.find(p => p.periodIndex === entry.periodIndex);
    const cls = classMap.get(entry.classId);
    const sec = cls?.sections.find(s => s.id === entry.sectionId);
    const sub = subjectMap.get(entry.subjectId);

    return new TableRow({
      children: [
        new TableCell({
          width: { size: 1600, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: rowBg },
          borders: CELL_BORDERS,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: entry.day, bold: true, size: 17 })] })],
        }),
        new TableCell({
          width: { size: 1400, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: rowBg },
          borders: CELL_BORDERS,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: period?.label || `P${entry.periodIndex}`, size: 17 })] })],
        }),
        new TableCell({
          width: { size: 1800, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: rowBg },
          borders: CELL_BORDERS,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${period?.startTime || ''} - ${period?.endTime || ''}`, size: 16 })] })],
        }),
        new TableCell({
          width: { size: 1800, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: rowBg },
          borders: CELL_BORDERS,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${cls?.name || 'Class'} (${sec?.name || 'Sec'})`, bold: true, size: 17 })] })],
        }),
        new TableCell({
          width: { size: 3000, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: rowBg },
          borders: CELL_BORDERS,
          children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: `${sub?.name || 'Subject'}${entry.room ? ` [${entry.room}]` : ''}`, size: 17 })] })],
        }),
      ],
    });
  });

  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    rows: [headerRow, ...rows],
  });
}

// 1. Export Complete School Routine (All classes & sections)
export async function exportCompleteSchoolDocx(state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  const children: (Paragraph | Table)[] = [];

  classes.forEach((cls, cIdx) => {
    cls.sections.forEach((sec, sIdx) => {
      if (cIdx > 0 || sIdx > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      children.push(
        ...createHeaderParagraphs(
          settings.schoolName,
          settings.academicYear,
          'MASTER CLASS TIMETABLE',
          `${cls.name} - ${sec.name} ${sec.roomNumber ? `(${sec.roomNumber})` : ''}`
        )
      );

      const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
      children.push(
        buildClassSectionTable(
          cls,
          sec.name,
          secEntries,
          settings.workingDays,
          settings.periodTimings,
          subjectMap,
          teacherMap
        )
      );

      children.push(new Paragraph({ spacing: { after: 120 } }));
    });
  });

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${settings.schoolName.replace(/\s+/g, '_')}_Complete_School_Routine.docx`);
}

// 2. Export Individual Class Routine (All sections of the class)
export async function exportClassDocx(classId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const cls = classes.find(c => c.id === classId);
  if (!cls) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  const children: (Paragraph | Table)[] = [];

  cls.sections.forEach((sec, sIdx) => {
    if (sIdx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    children.push(
      ...createHeaderParagraphs(
        settings.schoolName,
        settings.academicYear,
        `WEEKLY ROUTINE - ${cls.name.toUpperCase()}`,
        `${sec.name} ${sec.roomNumber ? `(${sec.roomNumber})` : ''}`
      )
    );

    const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
    children.push(
      buildClassSectionTable(
        cls,
        sec.name,
        secEntries,
        settings.workingDays,
        settings.periodTimings,
        subjectMap,
        teacherMap
      )
    );
  });

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${cls.name.replace(/\s+/g, '_')}_Weekly_Routine.docx`);
}

// 3. Export Individual Section Routine
export async function exportSectionDocx(classId: string, sectionId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const cls = classes.find(c => c.id === classId);
  const sec = cls?.sections.find(s => s.id === sectionId);
  if (!cls || !sec) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));

  const children: (Paragraph | Table)[] = [];
  children.push(
    ...createHeaderParagraphs(
      settings.schoolName,
      settings.academicYear,
      `WEEKLY CLASS TIMETABLE`,
      `${cls.name} - ${sec.name} ${sec.roomNumber ? `(${sec.roomNumber})` : ''}`
    )
  );

  const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
  children.push(
    buildClassSectionTable(
      cls,
      sec.name,
      secEntries,
      settings.workingDays,
      settings.periodTimings,
      subjectMap,
      teacherMap
    )
  );

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${cls.name.replace(/\s+/g, '_')}_${sec.name.replace(/\s+/g, '_')}_Routine.docx`);
}

// 4. Export Individual Teacher Routine (Matches example format in prompt)
export async function exportTeacherDocx(teacherId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const teacher = teachers.find(t => t.id === teacherId);
  if (!teacher) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));

  const children: (Paragraph | Table)[] = [];
  children.push(
    ...createHeaderParagraphs(
      settings.schoolName,
      settings.academicYear,
      'TEACHER INDIVIDUAL WEEKLY ROUTINE',
      `Teacher Name: ${teacher.name} (${teacher.designation})`
    )
  );

  children.push(
    buildTeacherTable(teacher, entries, settings.workingDays, settings.periodTimings, classes, subjectMap)
  );

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${teacher.name.replace(/\s+/g, '_')}_Routine.docx`);
}

// 5. Export All Teachers' Combined Routine (with page break for each teacher)
export async function exportAllTeachersDocx(state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const subjectMap = new Map(subjects.map(s => [s.id, s]));

  const children: (Paragraph | Table)[] = [];

  teachers.forEach((teacher, idx) => {
    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    children.push(
      ...createHeaderParagraphs(
        settings.schoolName,
        settings.academicYear,
        'FACULTY WEEKLY TEACHING SCHEDULE',
        `Teacher Name: ${teacher.name} (${teacher.designation})`
      )
    );

    children.push(
      buildTeacherTable(teacher, entries, settings.workingDays, settings.periodTimings, classes, subjectMap)
    );
  });

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${settings.schoolName.replace(/\s+/g, '_')}_All_Teachers_Routine.docx`);
}
