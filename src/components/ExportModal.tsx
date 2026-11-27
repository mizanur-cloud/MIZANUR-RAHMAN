import React, { useState, useMemo } from 'react';
import { DayOfWeek, PeriodTiming, SchoolClass, Subject, Teacher, TimetableEntry } from '../types';
import { AppState } from '../services/storage';
import {
  X,
  FileText,
  FileCheck,
  FileSpreadsheet,
  Download,
  School,
  BookOpen,
  Users,
  Layers,
  CheckCircle,
  Eye,
  Calendar,
  Clock,
  Printer,
  ChevronRight,
  Info,
} from 'lucide-react';
import { SchoolCrestLogo } from './SchoolCrestLogo';
import {
  exportAllTeachersDocx,
  exportClassDocx,
  exportCompleteSchoolDocx,
  exportSectionDocx,
  exportTeacherDocx,
} from '../services/exportDocx';
import {
  exportAllTeachersPdf,
  exportClassPdf,
  exportCompleteSchoolPdf,
  exportSectionPdf,
  exportTeacherPdf,
} from '../services/exportPdf';
import { exportTimetableExcel } from '../services/exportExcel';

type ExportCategory = 'complete_school' | 'class' | 'section' | 'teacher' | 'all_teachers' | 'excel';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  fullAppState: AppState;
  classes: SchoolClass[];
  teachers: Teacher[];
  initialClassId?: string;
  initialSectionId?: string;
  initialTeacherId?: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  fullAppState,
  classes,
  teachers,
  initialClassId,
  initialSectionId,
  initialTeacherId,
}) => {
  const [activeCategory, setActiveCategory] = useState<ExportCategory>('section');

  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialClassId || classes[0]?.id || ''
  );
  const selectedClass = classes.find(c => c.id === selectedClassId) || classes[0];

  const [selectedSectionId, setSelectedSectionId] = useState<string>(
    initialSectionId || selectedClass?.sections[0]?.id || ''
  );
  const selectedSection =
    selectedClass?.sections.find(s => s.id === selectedSectionId) || selectedClass?.sections[0];

  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    initialTeacherId || teachers[0]?.id || ''
  );
  const selectedTeacher = teachers.find(t => t.id === selectedTeacherId) || teachers[0];

  // In complete school or all teachers preview, let user flip through preview pages
  const [completePreviewClassId, setCompletePreviewClassId] = useState<string>(
    classes[0]?.id || ''
  );
  const [completePreviewSectionId, setCompletePreviewSectionId] = useState<string>(
    classes[0]?.sections[0]?.id || ''
  );
  const [allTeachersPreviewTeacherId, setAllTeachersPreviewTeacherId] = useState<string>(
    teachers[0]?.id || ''
  );

  const [downloadSuccessMsg, setDownloadSuccessMsg] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const triggerNotify = (msg: string) => {
    setDownloadSuccessMsg(msg);
    setTimeout(() => setDownloadSuccessMsg(null), 4000);
  };

  // Subject and teacher lookup maps
  const subjectMap = useMemo(
    () => new Map<string, Subject>(fullAppState.subjects.map(s => [s.id, s])),
    [fullAppState.subjects]
  );
  const teacherMap = useMemo(
    () => new Map<string, Teacher>(teachers.map(t => [t.id, t])),
    [teachers]
  );
  const classMap = useMemo(
    () => new Map<string, SchoolClass>(classes.map(c => [c.id, c])),
    [classes]
  );

  const workingDays = fullAppState.settings.workingDays;
  const activeTeachingPeriods = useMemo(
    () => fullAppState.settings.periodTimings.filter(p => !p.isBreak),
    [fullAppState.settings.periodTimings]
  );

  // Compute preview entries based on current category
  const previewData = useMemo(() => {
    if (activeCategory === 'section') {
      const entries = fullAppState.entries.filter(
        e => e.classId === selectedClassId && e.sectionId === selectedSectionId
      );
      return {
        title: `${selectedClass?.name || 'Class'} — ${selectedSection?.name || 'Section'} Routine`,
        subTitle: `Room: ${selectedSection?.roomNumber || 'Standard Classroom'} • Total Periods: ${entries.length} / week`,
        entries,
        mode: 'class' as const,
      };
    }

    if (activeCategory === 'class') {
      const entries = fullAppState.entries.filter(
        e => e.classId === selectedClassId && e.sectionId === selectedSectionId
      );
      return {
        title: `${selectedClass?.name || 'Class'} Routine (${selectedSection?.name || 'Section'})`,
        subTitle: `${selectedClass?.sections.length || 0} Sections total in this class • Showing preview of ${selectedSection?.name}`,
        entries,
        mode: 'class' as const,
      };
    }

    if (activeCategory === 'teacher') {
      const entries = fullAppState.entries.filter(e => e.teacherId === selectedTeacherId);
      return {
        title: `Teacher Routine: ${selectedTeacher?.name || 'Teacher'} (${selectedTeacher?.initials || ''})`,
        subTitle: `Designation: ${selectedTeacher?.designation || 'Faculty'} • Total Teaching Load: ${entries.length} periods / week`,
        entries,
        mode: 'teacher' as const,
      };
    }

    if (activeCategory === 'complete_school') {
      const targetClass = classes.find(c => c.id === completePreviewClassId) || classes[0];
      const targetSec =
        targetClass?.sections.find(s => s.id === completePreviewSectionId) || targetClass?.sections[0];
      const entries = fullAppState.entries.filter(
        e => e.classId === targetClass?.id && e.sectionId === targetSec?.id
      );
      return {
        title: `Complete School Timetable • ${targetClass?.name} - ${targetSec?.name}`,
        subTitle: `Sample Page (Class ${targetClass?.name}) from master unified routine of all ${classes.length} classes`,
        entries,
        mode: 'class' as const,
      };
    }

    if (activeCategory === 'all_teachers') {
      const targetTeacher =
        teachers.find(t => t.id === allTeachersPreviewTeacherId) || teachers[0];
      const entries = fullAppState.entries.filter(e => e.teacherId === targetTeacher?.id);
      return {
        title: `Faculty Timetable Book • ${targetTeacher?.name} (${targetTeacher?.initials})`,
        subTitle: `Sample Page (${targetTeacher?.name}) from master document of all ${teachers.length} teachers`,
        entries,
        mode: 'teacher' as const,
      };
    }

    // Excel
    return {
      title: `Master Database Export (${fullAppState.settings.schoolName})`,
      subTitle: `Includes ${fullAppState.entries.length} periods, ${teachers.length} faculty, ${classes.length} classes across 3 worksheets`,
      entries: fullAppState.entries,
      mode: 'excel' as const,
    };
  }, [
    activeCategory,
    selectedClassId,
    selectedSectionId,
    selectedTeacherId,
    completePreviewClassId,
    completePreviewSectionId,
    allTeachersPreviewTeacherId,
    fullAppState.entries,
    classes,
    teachers,
    selectedClass,
    selectedSection,
    selectedTeacher,
  ]);

  if (!isOpen) return null;

  // Handle DOCX download based on active category
  const handleDownloadDocx = async () => {
    setIsExporting(true);
    try {
      if (activeCategory === 'complete_school') {
        await exportCompleteSchoolDocx(fullAppState);
        triggerNotify('Complete School Routine Word document (.docx) downloaded successfully!');
      } else if (activeCategory === 'class') {
        await exportClassDocx(selectedClassId, fullAppState);
        triggerNotify(`${selectedClass?.name} Routine Word document (.docx) downloaded!`);
      } else if (activeCategory === 'section') {
        await exportSectionDocx(selectedClassId, selectedSectionId, fullAppState);
        triggerNotify(
          `${selectedClass?.name} - ${selectedSection?.name} Word document (.docx) downloaded!`
        );
      } else if (activeCategory === 'teacher') {
        await exportTeacherDocx(selectedTeacherId, fullAppState);
        triggerNotify(`${selectedTeacher?.name} Routine Word document (.docx) downloaded!`);
      } else if (activeCategory === 'all_teachers') {
        await exportAllTeachersDocx(fullAppState);
        triggerNotify('All Teachers combined Word document (.docx) downloaded successfully!');
      }
    } catch (err) {
      console.error(err);
      triggerNotify('Word ফাইল এক্সপোর্ট করতে সমস্যা হয়েছে।');
    } finally {
      setIsExporting(false);
    }
  };

  // Handle PDF download based on active category
  const handleDownloadPdf = async () => {
    setIsExporting(true);
    try {
      if (activeCategory === 'complete_school') {
        await exportCompleteSchoolPdf(fullAppState);
        triggerNotify('Complete School Routine Grid PDF (.pdf) downloaded successfully!');
      } else if (activeCategory === 'class') {
        await exportClassPdf(selectedClassId, fullAppState);
        triggerNotify(`${selectedClass?.name} Grid Routine PDF (.pdf) downloaded!`);
      } else if (activeCategory === 'section') {
        await exportSectionPdf(selectedClassId, selectedSectionId, fullAppState);
        triggerNotify(
          `${selectedClass?.name} - ${selectedSection?.name} Grid Routine PDF (.pdf) downloaded!`
        );
      } else if (activeCategory === 'teacher') {
        await exportTeacherPdf(selectedTeacherId, fullAppState);
        triggerNotify(`${selectedTeacher?.name} Grid Routine PDF (.pdf) downloaded!`);
      } else if (activeCategory === 'all_teachers') {
        await exportAllTeachersPdf(fullAppState);
        triggerNotify('All Teachers combined Grid PDF (.pdf) downloaded successfully!');
      }
    } catch (err) {
      console.error(err);
      triggerNotify('PDF ফাইল এক্সপোর্ট করতে সমস্যা হয়েছে।');
    } finally {
      setIsExporting(false);
    }
  };

  // Handle Excel export
  const handleDownloadExcel = async () => {
    setIsExporting(true);
    try {
      await exportTimetableExcel(fullAppState);
      triggerNotify('Master Timetable Excel workbook (.xlsx) downloaded successfully!');
    } catch (err) {
      console.error(err);
      triggerNotify('Excel ফাইল এক্সপোর্ট করতে সমস্যা হয়েছে।');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Routine Export & Print Center (গ্রিড ভিউ ডাউনলোড ও প্রিন্ট)
                </h2>
                <span className="text-slate-400">·</span>
                <span className="text-[11px] text-emerald-800 dark:text-emerald-400 font-semibold">
                  Landscape Grid View
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Preview exact document layout, period timings, and school letterhead before generating Microsoft Word (.docx), PDF, or Excel.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Alert if downloaded */}
        {downloadSuccessMsg && (
          <div className="px-6 py-2.5 bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200 dark:border-emerald-800/80 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200 animate-in fade-in slide-in-from-top-1">
            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{downloadSuccessMsg}</span>
          </div>
        )}

        {/* Main 2-Column Body: Left Selector & Options, Right Live Document Preview */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left Column: Scope & Categories Selector (Width ~340px) */}
          <div className="w-full md:w-84 border-r border-slate-200 dark:border-slate-800 p-4 overflow-y-auto bg-slate-50/70 dark:bg-slate-900/60 shrink-0 space-y-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-1">
                Select Routine Type (রুটিনের ধরন)
              </div>
              <div className="space-y-1.5">
                {/* 1. Section Routine */}
                <button
                  type="button"
                  onClick={() => setActiveCategory('section')}
                  className={`w-full p-2.5 rounded-xl text-left transition-all border flex items-start gap-2.5 ${
                    activeCategory === 'section'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Layers
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      activeCategory === 'section' ? 'text-white' : 'text-blue-600 dark:text-blue-400'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold leading-tight">Individual Section Routine</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        activeCategory === 'section' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      Single class & section timetable with room number
                    </div>
                  </div>
                </button>

                {/* 2. Class Routine */}
                <button
                  type="button"
                  onClick={() => setActiveCategory('class')}
                  className={`w-full p-2.5 rounded-xl text-left transition-all border flex items-start gap-2.5 ${
                    activeCategory === 'class'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <BookOpen
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      activeCategory === 'class' ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold leading-tight">Individual Class Routine</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        activeCategory === 'class' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      All sections of a selected class (e.g. Class 9 A, B, C)
                    </div>
                  </div>
                </button>

                {/* 3. Teacher Routine */}
                <button
                  type="button"
                  onClick={() => setActiveCategory('teacher')}
                  className={`w-full p-2.5 rounded-xl text-left transition-all border flex items-start gap-2.5 ${
                    activeCategory === 'teacher'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Users
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      activeCategory === 'teacher' ? 'text-white' : 'text-purple-600 dark:text-purple-400'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold leading-tight">Individual Teacher Routine</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        activeCategory === 'teacher' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      Personal schedule & assigned classes for any teacher
                    </div>
                  </div>
                </button>

                {/* 4. Complete School Routine */}
                <button
                  type="button"
                  onClick={() => setActiveCategory('complete_school')}
                  className={`w-full p-2.5 rounded-xl text-left transition-all border flex items-start gap-2.5 ${
                    activeCategory === 'complete_school'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <School
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      activeCategory === 'complete_school' ? 'text-white' : 'text-blue-600'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold leading-tight">Complete School Routine</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        activeCategory === 'complete_school' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      Master document containing all classes (Play - 10)
                    </div>
                  </div>
                </button>

                {/* 5. All Teachers' Routines */}
                <button
                  type="button"
                  onClick={() => setActiveCategory('all_teachers')}
                  className={`w-full p-2.5 rounded-xl text-left transition-all border flex items-start gap-2.5 ${
                    activeCategory === 'all_teachers'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Users
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      activeCategory === 'all_teachers' ? 'text-white' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold leading-tight">All Teachers' Combined Book</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        activeCategory === 'all_teachers' ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      Full faculty schedule with dedicated page per teacher
                    </div>
                  </div>
                </button>

                {/* 6. Excel Workbook */}
                <button
                  type="button"
                  onClick={() => setActiveCategory('excel')}
                  className={`w-full p-2.5 rounded-xl text-left transition-all border flex items-start gap-2.5 ${
                    activeCategory === 'excel'
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                      : 'bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <FileSpreadsheet
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      activeCategory === 'excel' ? 'text-white' : 'text-emerald-600'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold leading-tight">Excel Spreadsheet (.xlsx)</div>
                    <div
                      className={`text-[10px] mt-0.5 ${
                        activeCategory === 'excel' ? 'text-emerald-100' : 'text-slate-500'
                      }`}
                    >
                      Multi-sheet audit of entries, teacher loads & quotas
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Target Selectors based on chosen category */}
            {(activeCategory === 'section' || activeCategory === 'class') && (
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                  <span>Choose Class & Section</span>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Class</label>
                  <select
                    value={selectedClassId}
                    onChange={e => {
                      const newId = e.target.value;
                      setSelectedClassId(newId);
                      const cls = classes.find(c => c.id === newId);
                      if (cls?.sections[0]) setSelectedSectionId(cls.sections[0].id);
                    }}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 font-semibold"
                  >
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.sections.length} sections)
                      </option>
                    ))}
                  </select>
                </div>

                {activeCategory === 'section' && (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Section</label>
                    <select
                      value={selectedSectionId}
                      onChange={e => setSelectedSectionId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 font-semibold"
                    >
                      {selectedClass?.sections.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.roomNumber ? `[${s.roomNumber}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {activeCategory === 'teacher' && (
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-purple-600" />
                  <span>Choose Teacher</span>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Teacher</label>
                  <select
                    value={selectedTeacherId}
                    onChange={e => setSelectedTeacherId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200 font-semibold"
                  >
                    {teachers.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.initials}) - {t.designation}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {activeCategory === 'complete_school' && (
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  <span>Preview Page Inside Book</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Switch preview to any class to inspect before downloading all {classes.length} classes:
                </p>
                <select
                  value={completePreviewClassId}
                  onChange={e => {
                    setCompletePreviewClassId(e.target.value);
                    const cls = classes.find(c => c.id === e.target.value);
                    if (cls?.sections[0]) setCompletePreviewSectionId(cls.sections[0].id);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg font-semibold"
                >
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>
                      Page: {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeCategory === 'all_teachers' && (
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-amber-600" />
                  <span>Preview Page Inside Faculty Book</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Switch preview to see individual page formatting across all {teachers.length} teachers:
                </p>
                <select
                  value={allTeachersPreviewTeacherId}
                  onChange={e => setAllTeachersPreviewTeacherId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg font-semibold"
                >
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>
                      Page: {t.name} ({t.initials})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Document specs callout */}
            <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/40 text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
              <div className="font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                <span>Export Standard Specifications</span>
              </div>
              <div>• Standard A4 Print Format</div>
              <div>• Working Days: Sunday to Thursday</div>
              <div>• Header: {fullAppState.settings.schoolName}</div>
              <div>• Ready for Word (.docx) & Vector PDF (.pdf)</div>
            </div>
          </div>

          {/* Right Column: Live Interactive Document Sheet Preview & Actions */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-slate-100/70 dark:bg-slate-950 flex flex-col justify-between space-y-4">
            {/* Top Toolbar: Format Download Buttons */}
            <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Live Document Print Preview
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Showing real timetable data exactly as it will render in exported files
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {activeCategory !== 'excel' ? (
                  <>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={handleDownloadDocx}
                      className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 hover:border-blue-500 flex items-center gap-1.5 shadow-2xs transition-all active:scale-95 disabled:opacity-50"
                      title="Download as Microsoft Word document (.docx)"
                    >
                      <FileText className="w-4 h-4 text-blue-600" />
                      <span>Download Word (.docx)</span>
                    </button>

                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={handleDownloadPdf}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5 shadow-2xs transition-all active:scale-95 disabled:opacity-50"
                      title="Download as print-ready PDF (.pdf)"
                    >
                      <FileCheck className="w-4 h-4 text-white" />
                      <span>Download PDF (.pdf)</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={handleDownloadExcel}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#145343] hover:bg-[#0f3f33] rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>{isExporting ? 'Exporting...' : 'Download Excel Workbook (.xlsx)'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Document Preview Sheet (Styled like physical A4 printed paper) */}
            <div className="flex-1 bg-white text-slate-900 shadow-md border border-slate-300 rounded-xl p-6 sm:p-8 flex flex-col justify-between overflow-x-auto min-h-[480px]">
              <div>
                {/* School Letterhead */}
                <div className="text-center pb-4 mb-4 border-b-2 border-slate-800">
                  <SchoolCrestLogo bare className="w-14 h-14 mx-auto mb-1.5" />
                  <div className="text-lg sm:text-xl font-extrabold tracking-tight uppercase text-slate-900">
                    {fullAppState.settings.schoolName}
                  </div>
                  <div className="text-xs text-slate-600 font-medium mt-0.5">
                    Academic Session: {fullAppState.settings.academicYear} • Class Routine
                  </div>
                  <div className="text-sm font-bold text-blue-900 mt-1 uppercase tracking-wide">
                    {previewData.title}
                  </div>
                  <div className="text-[11px] text-slate-500 italic mt-0.5">
                    {previewData.subTitle}
                  </div>
                </div>

                {/* Timetable Table Preview */}
                {activeCategory !== 'excel' ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-center border-collapse border border-slate-300 text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-300">
                          <th className="py-2 px-3 border-r border-slate-300 font-bold w-24 text-left">
                            Day
                          </th>
                          {activeTeachingPeriods.map(p => (
                            <th key={p.periodIndex} className="py-2 px-2 border-r border-slate-300 font-bold min-w-[95px]">
                              <div>{p.label}</div>
                              <div className="text-[10px] font-normal text-slate-500 font-mono">
                                {p.startTime}-{p.endTime}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {workingDays.map(day => (
                          <tr key={day} className="border-b border-slate-200 hover:bg-slate-50/50">
                            <td className="py-2.5 px-3 border-r border-slate-300 font-bold text-slate-800 text-left bg-slate-50/80">
                              {day}
                            </td>
                            {activeTeachingPeriods.map(period => {
                              const slotEntries = previewData.entries.filter(
                                e => e.day === day && e.periodIndex === period.periodIndex
                              );

                              if (slotEntries.length === 0) {
                                return (
                                  <td
                                    key={period.periodIndex}
                                    className="py-2 px-1 border-r border-slate-200 text-slate-300 text-[11px] italic bg-slate-50/30"
                                  >
                                    — Free —
                                  </td>
                                );
                              }

                              return (
                                <td
                                  key={period.periodIndex}
                                  className="py-2 px-1.5 border-r border-slate-200 bg-white align-middle"
                                >
                                  <div className="space-y-1.5">
                                    {slotEntries.map((entry, idx) => {
                                      const subject = subjectMap.get(entry.subjectId);
                                      const teacher = entry.teacherId ? teacherMap.get(entry.teacherId) : null;
                                      const cls = classMap.get(entry.classId);
                                      const sec = cls?.sections.find(s => s.id === entry.sectionId);
                                      const roomText = entry.room || sec?.roomNumber;

                                      return (
                                        <div
                                          key={entry.id || idx}
                                          className={idx > 0 ? 'pt-1.5 border-t border-slate-200 border-dashed' : ''}
                                        >
                                          <div className="font-bold text-slate-900 leading-tight">
                                            {subject?.name || 'Subject'}
                                          </div>
                                          {previewData.mode === 'class' ? (
                                            <div className="text-[10px] text-slate-600 mt-0.5 font-medium truncate">
                                              {teacher?.name || 'Assigned'}
                                            </div>
                                          ) : (
                                            <div className="text-[10px] text-emerald-800 font-semibold mt-0.5 truncate">
                                              {cls?.name || 'Class'} {sec?.name ? `(${sec.name})` : ''}
                                            </div>
                                          )}
                                          {roomText && (
                                            <div className="text-[9px] text-slate-400 font-mono">
                                              {roomText}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* Excel Workbook Preview Tabular Summary */
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 text-emerald-950 text-xs">
                      <div className="font-bold flex items-center gap-1.5 text-emerald-900 mb-1">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                        <span>Workbook Structure Overview</span>
                      </div>
                      <p>
                        This Excel file contains 3 comprehensive, pre-formatted worksheets ready for administrative auditing and reporting:
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                        <div className="font-bold text-xs text-slate-800">Sheet 1: Master Routine</div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {fullAppState.entries.length} raw period rows with Class, Section, Day, Timing, Subject and Teacher.
                        </div>
                      </div>

                      <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                        <div className="font-bold text-xs text-slate-800">Sheet 2: Faculty Load</div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {teachers.length} teachers with assigned weekly periods, target quota, and surplus/deficit metrics.
                        </div>
                      </div>

                      <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                        <div className="font-bold text-xs text-slate-800">Sheet 3: Class Subject Quotas</div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          Audited breakdown of weekly required vs scheduled periods across all {classes.length} classes.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Document Signatures & Print Footer */}
              <div className="mt-8 pt-6 border-t border-slate-300 flex items-end justify-between text-xs text-slate-600">
                <div>
                  <div className="font-medium">System Generated Routine</div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Date: {new Date().toLocaleDateString('en-GB')} • Official Timetable Management
                  </div>
                </div>

                <div className="text-center">
                  <div className="w-40 border-b border-slate-400 pb-1 font-semibold text-slate-800">
                    {fullAppState.settings.principalName || 'Principal'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Head of Institution / Principal</div>
                </div>
              </div>
            </div>

            {/* Bottom notification indicator */}
            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <div className="flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5 text-slate-400" />
                <span>Documents are pre-formatted for 1-click printing on standard A4 paper.</span>
              </div>
              <div className="font-medium text-slate-600 dark:text-slate-400">
                Word files remain fully editable in Microsoft Word & LibreOffice
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            Selected format: <strong className="text-slate-800 dark:text-slate-200 capitalize">{activeCategory.replace('_', ' ')}</strong>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
