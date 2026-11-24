import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
import { AppState } from './storage';
import { DayOfWeek, PeriodTiming, SchoolClass, Subject, Teacher, TimetableEntry } from '../types';
import { loadSchoolLogoBytes } from './logoAsset';

const BRAND_FOREST = '145343';
const BORDER_HEX = 'CBD5E1';

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
};

const LANDSCAPE_PAGE_PROPS = {
  page: {
    size: {
      orientation: PageOrientation.LANDSCAPE,
    },
    margin: {
      top: 560,
      bottom: 560,
      left: 600,
      right: 600,
    },
  },
};

const DOC_FONT_CONFIG = {
  ascii: 'Calibri',
  hAnsi: 'Calibri',
  cs: 'SutonnyMJ',
  eastAsia: 'Noto Serif Bengali',
};

function createHeaderParagraphs(
  schoolName: string,
  academicYear: string,
  title: string,
  subtitle?: string,
  logoBytes?: Uint8Array | null
): Paragraph[] {
  const logoParagraph = logoBytes
    ? [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [
            new ImageRun({
              type: 'jpg',
              data: logoBytes,
              transformation: { width: 54, height: 54 },
              altText: {
                name: 'SchoolLogo',
                description: 'Icon Dreams School & College Logo',
                title: 'Icon Dreams School & College Logo',
              },
            }),
          ],
        }),
      ]
    : [];

  return [
    ...logoParagraph,
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: schoolName.toUpperCase(),
          bold: true,
          size: 32,
          color: BRAND_FOREST,
          font: DOC_FONT_CONFIG,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: `Academic Session: ${academicYear}`,
          bold: false,
          size: 19,
          color: '475569',
          font: DOC_FONT_CONFIG,
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
          size: 24,
          color: '0F172A',
          font: DOC_FONT_CONFIG,
        }),
        ...(subtitle
          ? [
              new TextRun({
                text: `  —  ${subtitle}`,
                bold: false,
                size: 22,
                color: '334155',
                font: DOC_FONT_CONFIG,
              }),
            ]
          : []),
      ],
    }),
  ];
}

function createSignatureFooter(principalName?: string): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 140, after: 40 } }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 20 },
      children: [
        new TextRun({
          text: '______________________________',
          color: '64748B',
          size: 18,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: principalName ? `${principalName} · Head of Institution` : 'Head of Institution / Principal',
          bold: true,
          size: 18,
          color: '334155',
          font: DOC_FONT_CONFIG,
        }),
      ],
    }),
  ];
}

function buildClassSectionGridTable(
  _cls: SchoolClass,
  entries: TimetableEntry[],
  workingDays: DayOfWeek[],
  periodTimings: PeriodTiming[],
  subjectMap: Map<string, Subject>,
  teacherMap: Map<string, Teacher>
): Table {
  const activePeriods = periodTimings.filter(p => !p.isBreak);
  const dayColWidth = 1700;
  const periodColWidth = Math.floor(12700 / Math.max(1, activePeriods.length));

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: dayColWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: BRAND_FOREST },
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'DAY / PERIOD', bold: true, color: 'FFFFFF', size: 18, font: DOC_FONT_CONFIG }),
            ],
          }),
        ],
      }),
      ...activePeriods.map(
        p =>
          new TableCell({
            width: { size: periodColWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            shading: { type: ShadingType.CLEAR, fill: BRAND_FOREST },
            borders: CELL_BORDERS,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: p.label, bold: true, color: 'FFFFFF', size: 18, font: DOC_FONT_CONFIG }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${p.startTime}–${p.endTime}`,
                    color: 'D1FAE5',
                    size: 14,
                    font: DOC_FONT_CONFIG,
                  }),
                ],
              }),
            ],
          })
      ),
    ],
  });

  const dataRows = workingDays.map((day, dayIdx) => {
    const rowBg = dayIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';

    const cells: TableCell[] = [
      new TableCell({
        width: { size: dayColWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: day, bold: true, size: 18, color: '0F172A', font: DOC_FONT_CONFIG })],
          }),
        ],
      }),
    ];

    activePeriods.forEach(p => {
      const matches = entries.filter(e => e.day === day && e.periodIndex === p.periodIndex);

      const cellParagraphs: Paragraph[] =
        matches.length > 0
          ? matches.flatMap((match, idx) => {
              const sub = subjectMap.get(match.subjectId);
              const tch = teacherMap.get(match.teacherId);
              return [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: idx === 0 ? 40 : 25, after: 10 },
                  children: [
                    new TextRun({
                      text: sub?.name || 'Class',
                      bold: true,
                      size: 17,
                      color: '0F172A',
                      font: DOC_FONT_CONFIG,
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: idx === matches.length - 1 ? 40 : 15 },
                  children: [
                    new TextRun({
                      text: `${tch?.name || tch?.initials || 'TBA'}${match.room ? ` [${match.room}]` : ''}`,
                      color: '475569',
                      size: 14,
                      font: DOC_FONT_CONFIG,
                    }),
                  ],
                }),
              ];
            })
          : [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '—', color: '94A3B8', size: 16, font: DOC_FONT_CONFIG })],
              }),
            ];

      cells.push(
        new TableCell({
          width: { size: periodColWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          shading: { type: ShadingType.CLEAR, fill: rowBg },
          borders: CELL_BORDERS,
          children: cellParagraphs,
        })
      );
    });

    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: dayColWidth + periodColWidth * activePeriods.length, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });
}

/**
 * Grid View Weekly Matrix for Individual & Combined Faculty Schedules
 * Rows: Working Days | Columns: Teaching Periods
 */
function buildTeacherGridTable(
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
  const activePeriods = periodTimings.filter(p => !p.isBreak);
  const dayColWidth = 1700;
  const periodColWidth = Math.floor(12700 / Math.max(1, activePeriods.length));

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: dayColWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: BRAND_FOREST },
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'DAY / PERIOD', bold: true, color: 'FFFFFF', size: 18, font: DOC_FONT_CONFIG }),
            ],
          }),
        ],
      }),
      ...activePeriods.map(
        p =>
          new TableCell({
            width: { size: periodColWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            shading: { type: ShadingType.CLEAR, fill: BRAND_FOREST },
            borders: CELL_BORDERS,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: p.label, bold: true, color: 'FFFFFF', size: 18, font: DOC_FONT_CONFIG }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${p.startTime}–${p.endTime}`,
                    color: 'D1FAE5',
                    size: 14,
                    font: DOC_FONT_CONFIG,
                  }),
                ],
              }),
            ],
          })
      ),
    ],
  });

  const dataRows = workingDays.map((day, dayIdx) => {
    const rowBg = dayIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';

    const cells: TableCell[] = [
      new TableCell({
        width: { size: dayColWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: day, bold: true, size: 18, color: '0F172A', font: DOC_FONT_CONFIG })],
          }),
        ],
      }),
    ];

    activePeriods.forEach(p => {
      const matches = teacherEntries.filter(e => e.day === day && e.periodIndex === p.periodIndex);

      const cellParagraphs: Paragraph[] =
        matches.length > 0
          ? matches.flatMap((match, idx) => {
              const cls = classMap.get(match.classId);
              const sec = cls?.sections.find(s => s.id === match.sectionId);
              const sub = subjectMap.get(match.subjectId);
              const roomText = match.room || sec?.roomNumber;

              return [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: idx === 0 ? 40 : 25, after: 8 },
                  children: [
                    new TextRun({
                      text: sub?.name || 'Subject',
                      bold: true,
                      size: 17,
                      color: '0F172A',
                      font: DOC_FONT_CONFIG,
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: roomText ? 6 : idx === matches.length - 1 ? 40 : 15 },
                  children: [
                    new TextRun({
                      text: `${cls?.name || 'Class'} (${sec?.name || 'Sec'})`,
                      bold: true,
                      color: BRAND_FOREST,
                      size: 15,
                      font: DOC_FONT_CONFIG,
                    }),
                  ],
                }),
                ...(roomText
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { after: idx === matches.length - 1 ? 40 : 15 },
                        children: [
                          new TextRun({
                            text: roomText,
                            color: '64748B',
                            size: 13,
                            font: DOC_FONT_CONFIG,
                          }),
                        ],
                      }),
                    ]
                  : []),
              ];
            })
          : [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '— Free —', color: '94A3B8', size: 15, font: DOC_FONT_CONFIG })],
              }),
            ];

      cells.push(
        new TableCell({
          width: { size: periodColWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          shading: { type: ShadingType.CLEAR, fill: matches.length > 0 ? rowBg : 'FAFAF9' },
          borders: CELL_BORDERS,
          children: cellParagraphs,
        })
      );
    });

    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: dayColWidth + periodColWidth * activePeriods.length, type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });
}

// 1. Export Complete School Routine (All classes & sections - Grid View)
export async function exportCompleteSchoolDocx(state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const logoBytes = await loadSchoolLogoBytes();

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
          'MASTER CLASS TIMETABLE (GRID VIEW)',
          `${cls.name} — ${sec.name}${sec.roomNumber ? ` (${sec.roomNumber})` : ''}`,
          logoBytes
        )
      );

      const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
      children.push(
        buildClassSectionGridTable(
          cls,
          secEntries,
          settings.workingDays,
          settings.periodTimings,
          subjectMap,
          teacherMap
        )
      );
      children.push(...createSignatureFooter(settings.principalName));
    });
  });

  const doc = new Document({
    sections: [{ properties: LANDSCAPE_PAGE_PROPS, children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${settings.schoolName.replace(/\s+/g, '_')}_Complete_School_Routine.docx`);
}

// 2. Export Individual Class Routine (All sections of the class - Grid View)
export async function exportClassDocx(classId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const cls = classes.find(c => c.id === classId);
  if (!cls) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const logoBytes = await loadSchoolLogoBytes();

  const children: (Paragraph | Table)[] = [];

  cls.sections.forEach((sec, sIdx) => {
    if (sIdx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    children.push(
      ...createHeaderParagraphs(
        settings.schoolName,
        settings.academicYear,
        `WEEKLY ROUTINE — ${cls.name.toUpperCase()}`,
        `${sec.name}${sec.roomNumber ? ` (${sec.roomNumber})` : ''}`,
        logoBytes
      )
    );

    const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
    children.push(
      buildClassSectionGridTable(
        cls,
        secEntries,
        settings.workingDays,
        settings.periodTimings,
        subjectMap,
        teacherMap
      )
    );
    children.push(...createSignatureFooter(settings.principalName));
  });

  const doc = new Document({
    sections: [{ properties: LANDSCAPE_PAGE_PROPS, children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${cls.name.replace(/\s+/g, '_')}_Weekly_Routine.docx`);
}

// 3. Export Individual Section Routine (Grid View)
export async function exportSectionDocx(classId: string, sectionId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const cls = classes.find(c => c.id === classId);
  const sec = cls?.sections.find(s => s.id === sectionId);
  if (!cls || !sec) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const teacherMap = new Map(teachers.map(t => [t.id, t]));
  const logoBytes = await loadSchoolLogoBytes();

  const children: (Paragraph | Table)[] = [
    ...createHeaderParagraphs(
      settings.schoolName,
      settings.academicYear,
      'WEEKLY CLASS TIMETABLE',
      `${cls.name} — ${sec.name}${sec.roomNumber ? ` (${sec.roomNumber})` : ''}`,
      logoBytes
    ),
  ];

  const secEntries = entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
  children.push(
    buildClassSectionGridTable(
      cls,
      secEntries,
      settings.workingDays,
      settings.periodTimings,
      subjectMap,
      teacherMap
    )
  );
  children.push(...createSignatureFooter(settings.principalName));

  const doc = new Document({
    sections: [{ properties: LANDSCAPE_PAGE_PROPS, children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${cls.name.replace(/\s+/g, '_')}_${sec.name.replace(/\s+/g, '_')}_Routine.docx`);
}

// 4. Export Individual Teacher Routine (Landscape Grid View)
export async function exportTeacherDocx(teacherId: string, state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const teacher = teachers.find(t => t.id === teacherId);
  if (!teacher) return;

  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const logoBytes = await loadSchoolLogoBytes();

  const children: (Paragraph | Table)[] = [
    ...createHeaderParagraphs(
      settings.schoolName,
      settings.academicYear,
      'TEACHER WEEKLY TIMETABLE (GRID VIEW)',
      `${teacher.name} (${teacher.initials}) · ${teacher.designation}`,
      logoBytes
    ),
    buildTeacherGridTable(
      teacher,
      entries,
      settings.workingDays,
      settings.periodTimings,
      classes,
      subjectMap
    ),
    ...createSignatureFooter(settings.principalName),
  ];

  const doc = new Document({
    sections: [{ properties: LANDSCAPE_PAGE_PROPS, children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${teacher.name.replace(/\s+/g, '_')}_Grid_Routine.docx`);
}

// 5. Export All Teachers' Combined Routine (Landscape Grid View per teacher)
export async function exportAllTeachersDocx(state: AppState) {
  const { classes, subjects, teachers, settings, entries } = state;
  const subjectMap = new Map(subjects.map(s => [s.id, s]));
  const logoBytes = await loadSchoolLogoBytes();

  const children: (Paragraph | Table)[] = [];

  teachers.forEach((teacher, idx) => {
    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    children.push(
      ...createHeaderParagraphs(
        settings.schoolName,
        settings.academicYear,
        'FACULTY WEEKLY TEACHING GRID',
        `${teacher.name} (${teacher.initials}) · ${teacher.designation}`,
        logoBytes
      )
    );

    children.push(
      buildTeacherGridTable(
        teacher,
        entries,
        settings.workingDays,
        settings.periodTimings,
        classes,
        subjectMap
      )
    );
    children.push(...createSignatureFooter(settings.principalName));
  });

  const doc = new Document({
    sections: [{ properties: LANDSCAPE_PAGE_PROPS, children }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${settings.schoolName.replace(/\s+/g, '_')}_All_Teachers_Grid_Routine.docx`);
}
