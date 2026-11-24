import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AppState } from './storage';
import { PeriodTiming, SchoolClass, Subject, Teacher, TimetableEntry } from '../types';
import { loadSchoolLogoDataUrl, loadSchoolLogoImage } from './logoAsset';

const BRAND_RGB: [number, number, number] = [20, 83, 67]; // Heritage Forest Emerald #145343
const BENGALI_REGEX = /[\u0980-\u09FF]/;
const CANVAS_FONT_STACK = `'Plus Jakarta Sans', 'SutonnyMJ-Universal', 'Noto Serif Bengali', 'Noto Sans Bengali', sans-serif`;

interface GridSheetData {
  schoolName: string;
  academicYear: string;
  principalName?: string;
  title: string;
  subtitle: string;
  activePeriods: PeriodTiming[];
  rows: {
    day: string;
    cells: {
      primary: string;
      secondary?: string;
      tertiary?: string;
    }[][];
  }[];
}

function sheetContainsBengali(sheet: GridSheetData): boolean {
  const texts = [
    sheet.schoolName,
    sheet.academicYear,
    sheet.principalName || '',
    sheet.title,
    sheet.subtitle,
    ...sheet.activePeriods.map(p => p.label),
    ...sheet.rows.flatMap(r => [
      r.day,
      ...r.cells.flatMap(cellItems =>
        cellItems.flatMap(item => [item.primary, item.secondary || '', item.tertiary || ''])
      ),
    ]),
  ];
  return texts.some(t => BENGALI_REGEX.test(t));
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        // Hard break very long tokens
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Renders a high-DPI A4 Landscape Grid page via browser's HarfBuzz text shaper so SutonnyMJ / Bengali conjuncts
 * render identically to on-screen typography inside downloaded PDFs.
 */
function renderCanvasGridSheetToPdf(
  doc: jsPDF,
  sheet: GridSheetData,
  pageIndex: number,
  totalPages: number,
  logoImg: HTMLImageElement | null
) {
  const W = 2400;
  const H = 1697; // Exact A4 Landscape ratio (297:210)
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // White paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Subtle top institutional accent band
  ctx.fillStyle = '#145343';
  ctx.fillRect(88, 64, W - 176, 8);

  // Official school crest on letterhead left
  if (logoImg) {
    ctx.drawImage(logoImg, 108, 86, 144, 144);
  }

  // Letterhead
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#145343';
  ctx.font = `700 44px ${CANVAS_FONT_STACK}`;
  ctx.fillText(sheet.schoolName.toUpperCase(), W / 2, 118);

  ctx.fillStyle = '#475569';
  ctx.font = `500 24px ${CANVAS_FONT_STACK}`;
  ctx.fillText(`Academic Session: ${sheet.academicYear}`, W / 2, 162);

  ctx.fillStyle = '#0F172A';
  ctx.font = `700 32px ${CANVAS_FONT_STACK}`;
  ctx.fillText(
    sheet.subtitle ? `${sheet.title}  —  ${sheet.subtitle}` : sheet.title,
    W / 2,
    210
  );

  // Hairline divider
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(88, 246);
  ctx.lineTo(W - 88, 246);
  ctx.stroke();

  // Grid Geometry
  const tableX = 88;
  const tableY = 274;
  const tableW = W - 176;
  const tableH = H - 410;
  const dayColW = 240;
  const pCount = Math.max(1, sheet.activePeriods.length);
  const colW = (tableW - dayColW) / pCount;
  const headerH = 92;
  const rowCount = Math.max(1, sheet.rows.length);
  const rowH = (tableH - headerH) / rowCount;

  // Table Header
  ctx.fillStyle = '#145343';
  ctx.fillRect(tableX, tableY, tableW, headerH);

  ctx.strokeStyle = '#0F3F33';
  ctx.lineWidth = 2;
  ctx.strokeRect(tableX, tableY, tableW, headerH);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 23px ${CANVAS_FONT_STACK}`;
  ctx.fillText('DAY / PERIOD', tableX + dayColW / 2, tableY + headerH / 2);

  sheet.activePeriods.forEach((p, idx) => {
    const cx = tableX + dayColW + idx * colW;
    ctx.beginPath();
    ctx.moveTo(cx, tableY);
    ctx.lineTo(cx, tableY + headerH);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 22px ${CANVAS_FONT_STACK}`;
    ctx.fillText(p.label, cx + colW / 2, tableY + 34);

    ctx.fillStyle = '#D1FAE5';
    ctx.font = `500 18px ${CANVAS_FONT_STACK}`;
    ctx.fillText(`${p.startTime}–${p.endTime}`, cx + colW / 2, tableY + 66);
  });

  // Grid Body Rows
  sheet.rows.forEach((row, rIdx) => {
    const ry = tableY + headerH + rIdx * rowH;
    const isAlt = rIdx % 2 === 1;

    // Day Column
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(tableX, ry, dayColW, rowH);
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tableX, ry, dayColW, rowH);

    ctx.fillStyle = '#0F172A';
    ctx.font = `700 23px ${CANVAS_FONT_STACK}`;
    ctx.fillText(row.day, tableX + dayColW / 2, ry + rowH / 2);

    // Period Cells
    row.cells.forEach((cellItems, cIdx) => {
      const cx = tableX + dayColW + cIdx * colW;
      ctx.fillStyle = cellItems.length === 0 ? '#FAFAF9' : isAlt ? '#F8FAFC' : '#FFFFFF';
      ctx.fillRect(cx, ry, colW, rowH);
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx, ry, colW, rowH);

      if (cellItems.length === 0) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = `500 22px ${CANVAS_FONT_STACK}`;
        ctx.fillText('—', cx + colW / 2, ry + rowH / 2);
        return;
      }

      // Render stacked lines (supports parallel subjects / combined sections)
      const renderedBlocks: { text: string; font: string; color: string; h: number }[] = [];
      const padWidth = colW - 22;

      cellItems.forEach((item, itemIdx) => {
        if (itemIdx > 0) {
          renderedBlocks.push({
            text: '────────',
            font: `400 14px ${CANVAS_FONT_STACK}`,
            color: '#CBD5E1',
            h: 18,
          });
        }
        ctx.font = `700 20px ${CANVAS_FONT_STACK}`;
        for (const line of wrapLines(ctx, item.primary, padWidth).slice(0, 2)) {
          renderedBlocks.push({
            text: line,
            font: `700 20px ${CANVAS_FONT_STACK}`,
            color: '#0F172A',
            h: 25,
          });
        }
        if (item.secondary) {
          ctx.font = `600 17px ${CANVAS_FONT_STACK}`;
          for (const line of wrapLines(ctx, item.secondary, padWidth).slice(0, 2)) {
            renderedBlocks.push({
              text: line,
              font: `600 17px ${CANVAS_FONT_STACK}`,
              color: '#145343',
              h: 22,
            });
          }
        }
        if (item.tertiary) {
          ctx.font = `500 15px ${CANVAS_FONT_STACK}`;
          renderedBlocks.push({
            text: item.tertiary,
            font: `500 15px ${CANVAS_FONT_STACK}`,
            color: '#64748B',
            h: 19,
          });
        }
      });

      const totalBlockH = renderedBlocks.reduce((acc, b) => acc + b.h, 0);
      let cursorY = ry + Math.max(18, (rowH - totalBlockH) / 2);

      for (const block of renderedBlocks) {
        if (cursorY + block.h > ry + rowH - 6) break;
        ctx.font = block.font;
        ctx.fillStyle = block.color;
        ctx.fillText(block.text, cx + colW / 2, cursorY + block.h / 2);
        cursorY += block.h;
      }
    });
  });

  // Footer & Signature Line
  const footerY = H - 72;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = `500 20px ${CANVAS_FONT_STACK}`;
  ctx.fillText(
    `${sheet.schoolName} · Official Weekly Grid Timetable · Page ${pageIndex + 1} of ${totalPages}`,
    88,
    footerY
  );

  ctx.textAlign = 'right';
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W - 440, footerY - 26);
  ctx.lineTo(W - 88, footerY - 26);
  ctx.stroke();

  ctx.fillStyle = '#1E293B';
  ctx.font = `600 20px ${CANVAS_FONT_STACK}`;
  ctx.fillText(
    sheet.principalName ? `${sheet.principalName} · Principal` : 'Head of Institution / Principal',
    W - 88,
    footerY
  );

  const imgData = canvas.toDataURL('image/png');
  doc.addImage(imgData, 'PNG', 0, 0, 297, 210);
}

function renderVectorGridSheetToPdf(
  doc: jsPDF,
  sheet: GridSheetData,
  pageIndex: number,
  totalPages: number,
  logoDataUrl: string | null
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Official school crest on letterhead left
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'JPEG', 14, 7, 19, 19);
  }

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...BRAND_RGB);
  doc.text(sheet.schoolName.toUpperCase(), pageWidth / 2, 13, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`Academic Session: ${sheet.academicYear}`, pageWidth / 2, 19, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  const fullTitle = sheet.subtitle ? `${sheet.title} — ${sheet.subtitle}` : sheet.title;
  doc.text(fullTitle, pageWidth / 2, 25, { align: 'center' });

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(14, 28, pageWidth - 14, 28);

  const head = [
    [
      'Day / Period',
      ...sheet.activePeriods.map(p => `${p.label}\n${p.startTime}-${p.endTime}`),
    ],
  ];

  const body = sheet.rows.map(r => [
    r.day,
    ...r.cells.map(cellItems => {
      if (cellItems.length === 0) return '—';
      return cellItems
        .map(item =>
          [item.primary, item.secondary, item.tertiary].filter(Boolean).join('\n')
        )
        .join('\n—\n');
    }),
  ]);

  autoTable(doc, {
    startY: 32,
    head,
    body,
    theme: 'grid',
    headStyles: {
      fillColor: BRAND_RGB,
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 8.5,
    },
    bodyStyles: {
      halign: 'center',
      valign: 'middle',
      fontSize: 8,
      cellPadding: 3.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 26 },
    },
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${sheet.schoolName} · Official Weekly Grid Timetable · Page ${pageIndex + 1} of ${totalPages}`,
    14,
    pageHeight - 8
  );
  doc.text(
    sheet.principalName ? `${sheet.principalName} · Principal` : 'Head of Institution / Principal',
    pageWidth - 14,
    pageHeight - 8,
    { align: 'right' }
  );
}

async function emitGridPdfDocument(sheets: GridSheetData[], fileName: string) {
  if (sheets.length === 0) return;

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed cleanly
    }
  }

  const [logoImg, logoDataUrl] = await Promise.all([
    loadSchoolLogoImage(),
    loadSchoolLogoDataUrl(),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  sheets.forEach((sheet, idx) => {
    if (idx > 0) doc.addPage();
    if (sheetContainsBengali(sheet)) {
      renderCanvasGridSheetToPdf(doc, sheet, idx, sheets.length, logoImg);
    } else {
      renderVectorGridSheetToPdf(doc, sheet, idx, sheets.length, logoDataUrl);
    }
  });

  doc.save(fileName);
}

function buildClassSectionSheet(
  cls: SchoolClass,
  secName: string,
  roomNumber: string | undefined,
  secEntries: TimetableEntry[],
  state: AppState,
  title: string,
  subjectMap: Map<string, Subject>,
  teacherMap: Map<string, Teacher>
): GridSheetData {
  const activePeriods = state.settings.periodTimings.filter(p => !p.isBreak);
  return {
    schoolName: state.settings.schoolName,
    academicYear: state.settings.academicYear,
    principalName: state.settings.principalName,
    title,
    subtitle: `${cls.name} — ${secName}${roomNumber ? ` (${roomNumber})` : ''}`,
    activePeriods,
    rows: state.settings.workingDays.map(day => ({
      day,
      cells: activePeriods.map(p => {
        const matches = secEntries.filter(e => e.day === day && e.periodIndex === p.periodIndex);
        return matches.map(m => {
          const sub = subjectMap.get(m.subjectId);
          const tch = teacherMap.get(m.teacherId);
          return {
            primary: sub?.name || 'Class',
            secondary: tch?.name || tch?.initials || 'TBA',
            tertiary: m.room ? m.room : undefined,
          };
        });
      }),
    })),
  };
}

function buildTeacherGridSheet(
  teacher: Teacher,
  state: AppState,
  title: string,
  classMap: Map<string, SchoolClass>,
  subjectMap: Map<string, Subject>
): GridSheetData {
  const activePeriods = state.settings.periodTimings.filter(p => !p.isBreak);
  const teacherEntries = state.entries.filter(e => e.teacherId === teacher.id);

  return {
    schoolName: state.settings.schoolName,
    academicYear: state.settings.academicYear,
    principalName: state.settings.principalName,
    title,
    subtitle: `${teacher.name} (${teacher.initials}) · ${teacher.designation}`,
    activePeriods,
    rows: state.settings.workingDays.map(day => ({
      day,
      cells: activePeriods.map(p => {
        const matches = teacherEntries.filter(e => e.day === day && e.periodIndex === p.periodIndex);
        return matches.map(m => {
          const cls = classMap.get(m.classId);
          const sec = cls?.sections.find(s => s.id === m.sectionId);
          const sub = subjectMap.get(m.subjectId);
          const room = m.room || sec?.roomNumber;
          return {
            primary: sub?.name || 'Subject',
            secondary: `${cls?.name || 'Class'} (${sec?.name || 'Sec'})`,
            tertiary: room ? room : undefined,
          };
        });
      }),
    })),
  };
}

// 1. Export Complete School Routine PDF (Grid View)
export async function exportCompleteSchoolPdf(state: AppState) {
  const subjectMap = new Map(state.subjects.map(s => [s.id, s]));
  const teacherMap = new Map(state.teachers.map(t => [t.id, t]));
  const sheets: GridSheetData[] = [];

  state.classes.forEach(cls => {
    cls.sections.forEach(sec => {
      const secEntries = state.entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
      sheets.push(
        buildClassSectionSheet(
          cls,
          sec.name,
          sec.roomNumber,
          secEntries,
          state,
          'MASTER CLASS TIMETABLE (GRID VIEW)',
          subjectMap,
          teacherMap
        )
      );
    });
  });

  await emitGridPdfDocument(
    sheets,
    `${state.settings.schoolName.replace(/\s+/g, '_')}_Complete_School_Routine.pdf`
  );
}

// 2. Export Individual Class Routine PDF (Grid View)
export async function exportClassPdf(classId: string, state: AppState) {
  const cls = state.classes.find(c => c.id === classId);
  if (!cls) return;

  const subjectMap = new Map(state.subjects.map(s => [s.id, s]));
  const teacherMap = new Map(state.teachers.map(t => [t.id, t]));

  const sheets: GridSheetData[] = cls.sections.map(sec => {
    const secEntries = state.entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);
    return buildClassSectionSheet(
      cls,
      sec.name,
      sec.roomNumber,
      secEntries,
      state,
      `WEEKLY ROUTINE — ${cls.name.toUpperCase()}`,
      subjectMap,
      teacherMap
    );
  });

  await emitGridPdfDocument(sheets, `${cls.name.replace(/\s+/g, '_')}_Weekly_Routine.pdf`);
}

// 3. Export Individual Section Routine PDF (Grid View)
export async function exportSectionPdf(classId: string, sectionId: string, state: AppState) {
  const cls = state.classes.find(c => c.id === classId);
  const sec = cls?.sections.find(s => s.id === sectionId);
  if (!cls || !sec) return;

  const subjectMap = new Map(state.subjects.map(s => [s.id, s]));
  const teacherMap = new Map(state.teachers.map(t => [t.id, t]));
  const secEntries = state.entries.filter(e => e.classId === cls.id && e.sectionId === sec.id);

  const sheet = buildClassSectionSheet(
    cls,
    sec.name,
    sec.roomNumber,
    secEntries,
    state,
    'WEEKLY CLASS TIMETABLE',
    subjectMap,
    teacherMap
  );

  await emitGridPdfDocument(
    [sheet],
    `${cls.name.replace(/\s+/g, '_')}_${sec.name.replace(/\s+/g, '_')}_Routine.pdf`
  );
}

// 4. Export Individual Teacher Routine PDF (Landscape Grid View)
export async function exportTeacherPdf(teacherId: string, state: AppState) {
  const teacher = state.teachers.find(t => t.id === teacherId);
  if (!teacher) return;

  const classMap = new Map(state.classes.map(c => [c.id, c]));
  const subjectMap = new Map(state.subjects.map(s => [s.id, s]));

  const sheet = buildTeacherGridSheet(
    teacher,
    state,
    'TEACHER WEEKLY TIMETABLE (GRID VIEW)',
    classMap,
    subjectMap
  );

  await emitGridPdfDocument([sheet], `${teacher.name.replace(/\s+/g, '_')}_Grid_Routine.pdf`);
}

// 5. Export All Teachers' Combined Routine PDF (Landscape Grid View per teacher)
export async function exportAllTeachersPdf(state: AppState) {
  const classMap = new Map(state.classes.map(c => [c.id, c]));
  const subjectMap = new Map(state.subjects.map(s => [s.id, s]));

  const sheets: GridSheetData[] = state.teachers.map(teacher =>
    buildTeacherGridSheet(
      teacher,
      state,
      'FACULTY WEEKLY TEACHING GRID',
      classMap,
      subjectMap
    )
  );

  await emitGridPdfDocument(
    sheets,
    `${state.settings.schoolName.replace(/\s+/g, '_')}_All_Teachers_Grid_Routine.pdf`
  );
}
