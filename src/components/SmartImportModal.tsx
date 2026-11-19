import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  DayOfWeek,
  SchoolClass,
  SchoolSettings,
  Subject,
  Teacher,
  TimetableEntry,
} from '../types';
import {
  UploadCloud,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  FileCheck,
  X,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Download,
  Check,
  RefreshCw,
  Eye,
  Layers,
} from 'lucide-react';

interface ExtractedData {
  schoolName?: string;
  academicYear?: string;
  classes?: { name: string; sections: string[] }[];
  teachers?: { name: string; initials?: string; designation?: string; subjects?: string[] }[];
  subjects?: { name: string; code?: string }[];
  entries?: {
    className: string;
    sectionName?: string;
    day: DayOfWeek;
    periodIndex: number;
    subjectName: string;
    teacherName: string;
    room?: string;
  }[];
}

interface SmartImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: SchoolClass[];
  teachers: Teacher[];
  subjects: Subject[];
  settings: SchoolSettings;
  onApplyImport: (
    importedClasses: SchoolClass[],
    importedTeachers: Teacher[],
    importedSubjects: Subject[],
    importedEntries: TimetableEntry[],
    mode: 'merge' | 'replace',
    newSchoolName?: string
  ) => void;
}

export const SmartImportModal: React.FC<SmartImportModalProps> = ({
  isOpen,
  onClose,
  classes,
  teachers,
  subjects,
  settings,
  onApplyImport,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'preview'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(true);
  const [isAutoSaved, setIsAutoSaved] = useState<boolean>(false);

  if (!isOpen) return null;

  // Helper to map and apply extracted data into system storage
  const executeApply = (data: ExtractedData, mode: 'merge' | 'replace') => {
    const subjectMap = new Map(subjects.map(s => [s.name.toLowerCase(), s]));
    const teacherMap = new Map(teachers.map(t => [t.name.toLowerCase(), t]));
    const classMap = new Map(classes.map(c => [c.name.toLowerCase(), c]));

    const newSubjects: Subject[] = [...subjects];
    const newTeachers: Teacher[] = [...teachers];
    const newClasses: SchoolClass[] = [...classes];

    // Ensure extracted subjects exist
    data.subjects?.forEach(s => {
      if (!subjectMap.has(s.name.toLowerCase())) {
        const newSub: Subject = {
          id: `sub-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
          name: s.name,
          code: s.code || s.name.substring(0, 3).toUpperCase(),
          color: '#3B82F6',
        };
        newSubjects.push(newSub);
        subjectMap.set(s.name.toLowerCase(), newSub);
      }
    });

    // Ensure extracted teachers exist
    data.teachers?.forEach(t => {
      if (!teacherMap.has(t.name.toLowerCase())) {
        const initials = t.initials || t.name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();
        const newTch: Teacher = {
          id: `tch-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
          name: t.name,
          initials,
          designation: t.designation || 'Teacher',
          subjectIds: [],
          maxConsecutivePeriods: 2,
          maxDailyPeriods: 4,
        };
        newTeachers.push(newTch);
        teacherMap.set(t.name.toLowerCase(), newTch);
      }
    });

    // Ensure extracted classes exist
    data.classes?.forEach(c => {
      if (!classMap.has(c.name.toLowerCase())) {
        const newCls: SchoolClass = {
          id: `cls-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`,
          name: c.name,
          numericGrade: 1,
          sections: (c.sections || ['Section A']).map((secName, idx) => ({
            id: `sec-${idx}-${Date.now().toString(36)}`,
            name: secName,
          })),
          subjectRequirements: [],
        };
        newClasses.push(newCls);
        classMap.set(c.name.toLowerCase(), newCls);
      }
    });

    // Map extracted entries to timetable entries
    const mappedEntries: TimetableEntry[] = [];
    data.entries?.forEach((e, idx) => {
      const cls = classMap.get(e.className.toLowerCase()) || newClasses[0];
      const sec = cls.sections.find(s => s.name.toLowerCase() === (e.sectionName || '').toLowerCase()) || cls.sections[0];
      const sub = subjectMap.get(e.subjectName.toLowerCase()) || newSubjects[0];
      const tch = teacherMap.get(e.teacherName.toLowerCase()) || newTeachers[0];

      if (cls && sec && sub && tch) {
        mappedEntries.push({
          id: `imp-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
          classId: cls.id,
          sectionId: sec.id,
          day: e.day || 'Sunday',
          periodIndex: e.periodIndex || 1,
          subjectId: sub.id,
          teacherId: tch.id,
          room: e.room,
        });
      }
    });

    onApplyImport(
      newClasses,
      newTeachers,
      newSubjects,
      mappedEntries,
      mode,
      data.schoolName
    );
  };

  // 1. Download Sample Excel Template
  const handleDownloadSampleExcel = () => {
    const sampleData = [
      {
        Class: 'Play',
        Section: 'Section A',
        Day: 'Sunday',
        Period: 1,
        Subject: 'Rhymes & Storytelling',
        Teacher: 'Ms. Zinat Ara',
        Room: 'Room P-1',
      },
      {
        Class: 'Nursery',
        Section: 'Section A',
        Day: 'Sunday',
        Period: 1,
        Subject: 'Bengali',
        Teacher: 'Mrs. Nasrin Sultana',
        Room: 'Room N-1',
      },
      {
        Class: 'KG',
        Section: 'Section A',
        Day: 'Sunday',
        Period: 2,
        Subject: 'Mathematics',
        Teacher: 'Mr. Moniruzzaman',
        Room: 'Room K-1',
      },
      {
        Class: 'Class 8',
        Section: 'Section A',
        Day: 'Sunday',
        Period: 1,
        Subject: 'Mathematics',
        Teacher: 'Mr. A. Rahman',
        Room: 'Room 404',
      },
      {
        Class: 'Class 9',
        Section: 'Section B',
        Day: 'Sunday',
        Period: 3,
        Subject: 'Higher Mathematics',
        Teacher: 'Mr. A. Rahman',
        Room: 'Room 502',
      },
      {
        Class: 'Class 10',
        Section: 'Section A',
        Day: 'Monday',
        Period: 2,
        Subject: 'Mathematics',
        Teacher: 'Mr. A. Rahman',
        Room: 'Room 505',
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleData);
    XLSX.utils.book_append_sheet(wb, ws, 'Routines');
    XLSX.writeFile(wb, 'Icon_Dreams_Routine_Import_Template.xlsx');
  };

  // 2. Parse Excel/CSV Client-Side directly with xlsx
  const parseExcelFile = (file: File) => {
    setIsProcessing(true);
    setErrorMessage(null);
    setSourceFileName(file.name);

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (!jsonRows || jsonRows.length === 0) {
          throw new Error('No data rows found in spreadsheet.');
        }

        // Map spreadsheet columns to our schema
        const entries: ExtractedData['entries'] = [];
        const detectedClasses = new Set<string>();
        const detectedTeachers = new Set<string>();
        const detectedSubjects = new Set<string>();

        jsonRows.forEach(row => {
          const className = String(row.Class || row.class || row['Class Name'] || '').trim();
          const sectionName = String(row.Section || row.section || row['Section Name'] || 'Section A').trim();
          const day = String(row.Day || row.day || row['Day of Week'] || 'Sunday').trim() as DayOfWeek;
          const periodIndex = Number(row.Period || row.period || row['Period Number'] || 1);
          const subjectName = String(row.Subject || row.subject || row['Subject Name'] || '').trim();
          const teacherName = String(row.Teacher || row.teacher || row['Teacher Name'] || '').trim();
          const room = String(row.Room || row.room || row['Room Number'] || '').trim();

          if (className && subjectName) {
            detectedClasses.add(className);
            detectedSubjects.add(subjectName);
            if (teacherName) detectedTeachers.add(teacherName);

            entries.push({
              className,
              sectionName,
              day,
              periodIndex,
              subjectName,
              teacherName: teacherName || 'Assigned Teacher',
              room: room || undefined,
            });
          }
        });

        const extracted: ExtractedData = {
          schoolName: 'Icon Dreams School and College',
          classes: Array.from(detectedClasses).map(c => ({
            name: c,
            sections: ['Section A', 'Section B'],
          })),
          teachers: Array.from(detectedTeachers).map(t => ({
            name: t,
            designation: 'Teacher',
          })),
          subjects: Array.from(detectedSubjects).map(s => ({
            name: s,
          })),
          entries,
        };

        setExtractedData(extracted);
        if (autoSaveEnabled) {
          executeApply(extracted, importMode);
          setIsAutoSaved(true);
        }
        setActiveTab('preview');
      } catch (err: any) {
        setErrorMessage(err?.message || 'Failed to parse Excel file.');
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 3. Parse Image / PDF / Word via server Gemini API
  const parseWithGeminiAPI = async (file: File) => {
    setIsProcessing(true);
    setErrorMessage(null);
    setSourceFileName(file.name);

    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const base64Data = (e.target?.result as string).split(',')[1];
        const res = await fetch('/api/parse-schedule-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64Data,
            mimeType: file.type || 'application/octet-stream',
            fileName: file.name,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Server responded with ${res.status}`);
        }

        const json = await res.json();
        if (json.success && json.data) {
          setExtractedData(json.data);
          if (autoSaveEnabled) {
            executeApply(json.data, importMode);
            setIsAutoSaved(true);
          }
          setActiveTab('preview');
        } else {
          throw new Error('AI was unable to extract structured routine data from this file.');
        }
      } catch (err: any) {
        setErrorMessage(err?.message || 'Failed to process file with AI.');
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAutoSaved(false);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      parseExcelFile(file);
    } else {
      parseWithGeminiAPI(file);
    }
  };

  // 4. Confirm and Apply Extracted Data into System
  const handleConfirmImport = () => {
    if (!extractedData) return;
    executeApply(extractedData, importMode);
    setIsAutoSaved(true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Multi-Format Routine Importer (ফাইল থেকে রুটিন ইনপুট)
              </h2>
              <p className="text-xs text-slate-500">
                Import routines directly from Excel (.xlsx, .csv), PDF, Word (.docx), or Photos/Images (.png, .jpg).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Tabs */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === 'upload' ? (
            <div className="space-y-4">
              {/* Formats banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-center">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Excel / CSV</div>
                  <div className="text-[10px] text-slate-400">.xlsx, .xls, .csv</div>
                </div>

                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-center">
                  <ImageIcon className="w-5 h-5 text-purple-600 mx-auto mb-1" />
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Picture / Photo</div>
                  <div className="text-[10px] text-slate-400">.jpg, .png, .webp</div>
                </div>

                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-center">
                  <FileCheck className="w-5 h-5 text-rose-600 mx-auto mb-1" />
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">PDF Document</div>
                  <div className="text-[10px] text-slate-400">.pdf routines</div>
                </div>

                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-center">
                  <FileText className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">Word Document</div>
                  <div className="text-[10px] text-slate-400">.docx, .txt</div>
                </div>
              </div>

              {/* Auto-Save directly on upload banner */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-blue-900 dark:text-blue-200">
                      আপলোডের সাথে সাথে স্বয়ংক্রিয় সেভ (Auto-Save on Upload)
                    </div>
                    <div className="text-[11px] text-blue-700/80 dark:text-blue-300/80">
                      ফাইল আপলোড হওয়া মাত্রই তথ্যগুলো সরাসরি সেভ হয়ে সিস্টেমে কার্যকর হয়ে যাবে।
                    </div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={autoSaveEnabled}
                    onChange={e => setAutoSaveEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Upload Drag & Drop Box */}
              <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-800/30">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={isProcessing}
                />
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-300 rounded-full flex items-center justify-center mb-3 shadow-xs">
                  {isProcessing ? (
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  ) : (
                    <UploadCloud className="w-6 h-6" />
                  )}
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  {isProcessing
                    ? `Analyzing & Extracting from ${sourceFileName}...`
                    : 'Click or Drag & Drop file here to Import'}
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Upload an Excel spreadsheet, a photo of your schedule board, or a PDF/Word timetable. AI automatically extracts all periods, teachers, and subjects!
                </p>
              </label>

              {/* Template & Helper Bar */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  Want to prepare your routine in Excel first? Download our pre-formatted template:
                </div>
                <button
                  type="button"
                  onClick={handleDownloadSampleExcel}
                  className="px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 rounded-lg border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Excel Template</span>
                </button>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          ) : (
            /* Preview of Extracted Data */
            <div className="space-y-4">
              {isAutoSaved && (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-bold text-sm">সফলভাবে সরাসরি সেভ ও কার্যকর করা হয়েছে!</div>
                      <div className="text-[11px] opacity-90 mt-0.5">
                        ফাইল থেকে সংগৃহীত ক্লাস, শিক্ষক ও রুটিনের সকল তথ্য সরাসরি সিস্টেমে সেভ হয়েছে।
                      </div>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-emerald-600 text-white font-bold text-[10px] tracking-wide shrink-0">
                    SAVED ✓
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Import Summary from {sourceFileName}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Verify the extracted classes, teachers, and timetable period assignments below.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="text-xs text-blue-600 hover:underline font-semibold"
                >
                  Upload different file
                </button>
              </div>

              {/* Counts metrics */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">Classes Detected</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {extractedData?.classes?.length || 0}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">Teachers Detected</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {extractedData?.teachers?.length || 0}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">Routine Slots</div>
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                    {extractedData?.entries?.length || 0}
                  </div>
                </div>
              </div>

              {/* Sample extracted periods preview table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Day</th>
                      <th className="py-2 px-3 font-semibold">Period</th>
                      <th className="py-2 px-3 font-semibold">Class & Sec</th>
                      <th className="py-2 px-3 font-semibold">Subject</th>
                      <th className="py-2 px-3 font-semibold">Teacher</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {extractedData?.entries?.slice(0, 15).map((e, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-1.5 px-3 font-semibold">{e.day}</td>
                        <td className="py-1.5 px-3">Period {e.periodIndex}</td>
                        <td className="py-1.5 px-3 text-blue-700 font-medium">
                          {e.className} {e.sectionName ? `(${e.sectionName})` : ''}
                        </td>
                        <td className="py-1.5 px-3 font-semibold">{e.subjectName}</td>
                        <td className="py-1.5 px-3 text-slate-600">{e.teacherName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Import Mode selection */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Select Import Mode
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setImportMode('merge')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      importMode === 'merge'
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">Merge & Update</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Add new classes and overwrite slots that exist in the imported file while preserving other classes.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('replace')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      importMode === 'replace'
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">Replace Everything</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Clear current timetable entries and replace with only the imported schedule records.
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>

          {activeTab === 'preview' && (
            <button
              type="button"
              onClick={handleConfirmImport}
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1.5 shadow-xs"
            >
              <Check className="w-4 h-4" />
              <span>Apply to Schedule</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
