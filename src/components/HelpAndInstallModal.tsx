import React, { useState } from 'react';
import {
  X,
  Smartphone,
  Download,
  BookOpen,
  CheckCircle2,
  Calendar,
  Users,
  Grid3X3,
  UserMinus,
  Sparkles,
  AlertTriangle,
  UploadCloud,
  FileSpreadsheet,
  Settings as SettingsIcon,
  ExternalLink,
  HelpCircle,
  Copy,
  Check,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface HelpAndInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAutoGenerate: () => void;
  onOpenExport: () => void;
  onOpenSmartImport: () => void;
  onOpenSettings: () => void;
  canEdit?: boolean;
}

export const HelpAndInstallModal: React.FC<HelpAndInstallModalProps> = ({
  isOpen,
  onClose,
  onOpenAutoGenerate,
  onOpenExport,
  onOpenSmartImport,
  onOpenSettings,
  canEdit = true,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'apk' | 'usage'>('apk');
  const [copiedLink, setCopiedLink] = useState(false);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  if (!isOpen) return null;

  const PUBLIC_DOMAIN_URL = 'https://ais-pre-24ugampdbbfry7osz7xs3e-734890175875.asia-southeast1.run.app';
  const publicDomainUrl = (typeof window !== 'undefined' && window.location.origin.includes('.run.app'))
    ? window.location.origin
    : PUBLIC_DOMAIN_URL;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicDomainUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4.5 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                সহায়িকা ও মোবাইল অ্যাপ (APK/PWA) ইনস্টল গাইড
              </h2>
              <p className="text-xs text-blue-100 font-medium mt-0.5">
                User Guide & Mobile App (APK / Android Install) Instructions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="বন্ধ করুন"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-6 gap-3 shrink-0">
          <button
            onClick={() => setActiveSubTab('apk')}
            className={`flex items-center gap-2 py-3 px-3 text-sm font-semibold border-b-2 transition-all ${
              activeSubTab === 'apk'
                ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-white dark:bg-slate-900 rounded-t-lg -mb-px shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>মোবাইল অ্যাপ (APK / PWA) ইনস্টল</span>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold">
              Android & iOS
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('usage')}
            className={`flex items-center gap-2 py-3 px-3 text-sm font-semibold border-b-2 transition-all ${
              activeSubTab === 'usage'
                ? 'border-blue-600 text-blue-700 dark:text-blue-400 bg-white dark:bg-slate-900 rounded-t-lg -mb-px shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>ওয়েবসাইট ব্যবহারের নিয়মাবলী (User Guide)</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
          
          {/* TAB 1: APK & Mobile App Installation */}
          {activeSubTab === 'apk' && (
            <div className="space-y-6">
              {/* Shareable Public Domain Link Card */}
              <div className="p-4.5 rounded-2xl bg-indigo-50/90 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 space-y-3 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
                      <ExternalLink className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                        <span>ওয়েবসাইটের পাবলিক ডোমেন লিংক (Public Live Domain)</span>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 text-[10px] font-bold">
                          শেয়ারেবল
                        </span>
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        যেকোনো শিক্ষক, শিক্ষার্থী বা অন্য কাউকে এই লিংকটি দিলে যেকোনো ফোন বা কম্পিউটারের ব্রাউজারে এটি ওপেন করে সরাসরি ব্যবহার করতে পারবেন।
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleCopyLink}
                      className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-xs ${
                        copiedLink
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'লিংক কপি হয়েছে!' : 'লিংক কপি করুন'}</span>
                    </button>
                    <a
                      href={publicDomainUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-slate-700 flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>ওপেন</span>
                    </a>
                  </div>
                </div>

                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-indigo-200/70 dark:border-indigo-900 font-mono text-xs text-indigo-900 dark:text-indigo-200 select-all break-all flex items-center justify-between gap-2 shadow-2xs">
                  <span>{publicDomainUrl}</span>
                </div>
              </div>

              {/* Highlight Banner: 1-Click APK Download & Android Install */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-white shrink-0"></span>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      আইডিএসসি রুটিন (Android APK) ডাউনলোড
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider">
                      APK Ready
                    </span>
                  </div>
                  <p className="text-xs text-emerald-100 max-w-xl">
                    অ্যাপের নাম: <strong>আইডিএসসি রুটিন</strong> · লোগো: <strong>আইকন ড্রিমস</strong>। নিচের বাটনে ক্লিক করে সরাসরি <strong>IDSC_Routine.apk</strong> ফাইলটি ডাউনলোড করে আপনার অ্যান্ড্রয়েড ফোনে ইনস্টল করুন।
                  </p>
                  <div className="flex items-center gap-3 pt-1 text-[11px] text-emerald-200">
                    <span>ফাইলের নাম: <strong>IDSC_Routine.apk</strong></span>
                    <span>•</span>
                    <span>সাইজ: <strong>৩.৯ KB</strong></span>
                    <span>•</span>
                    <span>প্যাকেজ: <strong>com.icondreams.idscroutine</strong></span>
                  </div>
                </div>

                <div className="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
                  {/* Direct APK Download Link */}
                  <a
                    href="/IDSC_Routine.apk"
                    download="IDSC_Routine.apk"
                    className="px-5 py-2.5 bg-white text-emerald-800 hover:bg-emerald-50 text-xs font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4 text-emerald-700" />
                    <span>ডাউনলোড APK ফাইল</span>
                  </a>

                  {/* 1-Click PWA Install */}
                  {isInstallable && (
                    <button
                      onClick={install}
                      className="px-4 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                    >
                      <Smartphone className="w-4 h-4" />
                      <span>১-ক্লিকে ইনস্টল</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Step by Step Android Installation */}
              <div className="space-y-3">
                <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-emerald-600" />
                  <span>অ্যান্ড্রয়েড ফোনে অ্যাপটি ব্যবহারের সহজ উপায়:</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                    <div>
                      <div className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs mb-2.5">
                        ১
                      </div>
                      <h5 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                        Chrome-এ ওপেন করুন
                      </h5>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        আপনার অ্যান্ড্রয়েড ফোনের <strong>Google Chrome</strong> ব্রাউজারে এই ওয়েবসাইটের লিংকটি ভিজিট করুন।
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                    <div>
                      <div className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs mb-2.5">
                        ২
                      </div>
                      <h5 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                        ৩-ডট (⋮) মেনুতে চাপুন
                      </h5>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        ব্রাউজারের উপরের ডান কোনায় থাকা <strong>তিনটি ডট (⋮)</strong> মেনু চাপুন।
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                    <div>
                      <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-bold flex items-center justify-center text-xs mb-2.5">
                        ৩
                      </div>
                      <h5 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                        "Install app" বা "Add to Home screen"
                      </h5>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        মেনু থেকে <strong>"Install app"</strong> বা <strong>"Add to Home screen"</strong> বাটনে ক্লিক করুন। সাথে সাথে আপনার ফোনের অ্যাপ লিস্ট ও হোমস্ক্রিনে অ্যাপ আইকন তৈরি হয়ে যাবে!
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* iPhone / iOS Guide */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  আইফোন / আইপ্যাডে (iOS) ইনস্টল করার নিয়ম:
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Safari ব্রাউজারে লিংকটি খুলে নিচে থাকা <strong>Share (শেয়ার আইকন ⎋)</strong> বাটনে ট্যাপ করুন এবং একটু নিচে স্ক্রল করে <strong>"Add to Home Screen"</strong> চাপুন।
                </p>
              </div>

              {/* Standalone APK File Generation Info */}
              <div className="p-4.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/30 space-y-3">
                <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200 font-bold text-sm">
                  <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  <span>সরাসরি অফলাইন .APK প্যাকেজ ফাইল প্রয়োজন?</span>
                </div>
                <p className="text-xs text-indigo-800 dark:text-indigo-300">
                  যদি আপনি স্কুলের শিক্ষকদের মাঝে ব্লুটুথ বা পেনড্রাইভে সরাসরি ইনস্টলেবল <strong>.apk</strong> ফাইল শেয়ার করতে চান বা Google Play Store-এ তুলতে চান:
                </p>
                <div className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5"></span>
                    <span>
                      ১. মাইক্রোসফটের অফিসিয়াল ফ্রি টুল <strong>PWABuilder</strong> (<a href="https://www.pwabuilder.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline font-semibold inline-flex items-center gap-0.5">pwabuilder.com <ExternalLink className="w-3 h-3" /></a>) ভিজিট করুন।
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5"></span>
                    <span>
                      ২. এই ওয়েবসাইটের লিংকটি পেস্ট করে "Start" চাপুন। আমাদের সিস্টেমে ইতিমধ্যেই 100% ভ্যালিড PWA Manifest এবং সব সাইজের আইকন অন্তর্ভুক্ত রয়েছে।
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5"></span>
                    <span>
                      ৩. "Package for Android" অপশনে ক্লিক করলেই ১ ক্লিকে আপনার স্কুলের জন্য অফিশিয়াল সাইন্ড <strong>.apk</strong> ও <strong>.aab</strong> ফাইল জেনারেট হয়ে ডাউনলোড হয়ে যাবে!
                    </span>
                  </div>
                </div>
              </div>

              {/* Advantages of PWA Web App */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs mb-1">
                    <Zap className="w-3.5 h-3.5" />
                    <span>ফুলস্ক্রিন অভিজ্ঞতা</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    কোনো ব্রাউজার ইউআরএল বার বা বাটনের ঝামেলা নেই, পুরোদস্তুর নেটিভ অ্যাপের মতো চলে।
                  </p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-xs mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>অটোমেটিক আপডেট</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    রুটিনে কোনো পরিবর্তন আনলে অ্যাপটি স্বয়ংক্রিয়ভাবে ক্লাউড থেকে আপডেট সিঙ্ক করে নেয়।
                  </p>
                </div>
                <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-semibold text-xs mb-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>কোনো মেমরি নষ্ট হয় না</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ফোনের স্টোরেজ খরচ হয় মাত্র কয়েক মেগাবাইট এবং খুব দ্রুত ওপেন হয়।
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Full Website Usage Guide */}
          {activeSubTab === 'usage' && (
            <div className="space-y-6">
              
              <div className="p-4 bg-blue-50/80 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800/50">
                <h4 className="font-bold text-blue-900 dark:text-blue-100 text-sm">
                  আইকন ড্রিমস স্কুল অ্যান্ড কলেজ - স্মার্ট রুটিন ম্যানেজমেন্ট ব্যবহারের পূর্ণাঙ্গ নির্দেশিকা
                </h4>
                <p className="text-xs text-blue-800 dark:text-blue-300 mt-1">
                  এই সফটওয়্যারটির মাধ্যমে আপনি ক্লাস ১-১০ এবং প্লে-নার্সারির সম্পূর্ণ রুটিন স্বয়ংক্রিয়ভাবে তৈরি, শিক্ষক বদলি (Proxy), কনফ্লিক্ট যাচাই এবং প্রিন্ট/ডাউনলোড করতে পারবেন। নিচে প্রধান ফিচারগুলোর ব্যবহারবিধি দেওয়া হলো:
                </p>
              </div>

              {/* Feature Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* 1. Class Routine */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2.5 text-blue-700 dark:text-blue-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                      <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <span>১. শ্রেণিভিত্তিক রুটিন (Class Routines)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    উপরে ড্রপডাউন থেকে যেকোনো শ্রেণি (যেমন: Play, Nursery, Class 1-10) ও সেকশন (যেমন: Padma, Meghna) বেছে নিন। সপ্তাহের প্রতিটি দিনের ১-৭ পিরিয়ডের সময়সূচি দেখা যাবে। যেকোনো খালি স্লটে ক্লিক করে সহজে নতুন বিষয় ও শিক্ষক যুক্ত করতে পারেন।
                  </p>
                </div>

                {/* 2. Teacher Routine */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2.5 text-indigo-700 dark:text-indigo-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50">
                      <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <span>২. শিক্ষকভিত্তিক রুটিন (Teacher Routines)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    "Teacher Routines" ট্যাবে ক্লিক করে শিক্ষকদের তালিকা থেকে যেকোনো শিক্ষকের নাম নির্বাচন করুন। ঐ শিক্ষক কোন দিন কোন পিরিয়ডে কোন ক্লাসে ক্লাস নিবেন, তার পূর্ণাঙ্গ তালিকা এবং সাপ্তাহিক মোট ক্লাসের লোড দেখতে পারবেন।
                  </p>
                </div>

                {/* 3. Master Timetable */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2.5 text-purple-700 dark:text-purple-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                      <Grid3X3 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <span>৩. মাস্টার টাইমটেবিল (Master Timetable)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    একই স্ক্রিনে স্কুলের সকল শ্রেণির সকল সেকশনের পূর্ণাঙ্গ রুটিন একসাথে গ্রিড আকারে দেখতে পারবেন। স্কুলের নোটিশ বোর্ডে টাঙানোর জন্য এটি অত্যন্ত উপযোগী।
                  </p>
                </div>

                {/* 4. Proxy Substitution */}
                <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/20 space-y-2">
                  <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/50">
                      <UserMinus className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                    </div>
                    <span>৪. স্মার্ট প্রক্সি / বদলি রুটিন (Proxy Routine)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    কোনো শিক্ষক ছুটিতে থাকলে "Proxy Routine" ট্যাবে গিয়ে শিক্ষক নির্বাচন করুন। ঐ সময়ে কোন কোন শিক্ষক ফ্রি আছেন, সিস্টেম তা স্বয়ংক্রিয়ভাবে বিশ্লেষণ করে প্রক্সি শিক্ষক ঠিক করে দেবে এবং প্রিন্ট উপযোগী প্রক্সি স্লিপ তৈরি করে দেবে।
                  </p>
                </div>

                {/* 5. Auto Generate */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2.5 text-amber-700 dark:text-amber-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                      <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <span>৫. অটো রুটিন তৈরি (Auto-Fill)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    "Auto-Fill" বাটনে চাপলে পুরো স্কুলের বা নির্দিষ্ট কোনো ক্লাসের রুটিন স্বয়ংক্রিয়ভাবে তৈরি হয়ে যাবে। সিস্টেম খেয়াল রাখে যেন একই শিক্ষক একই সময়ে দুই জায়গায় না পড়েন।
                  </p>
                </div>

                {/* 6. Conflicts Detection */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2.5 text-amber-700 dark:text-amber-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <span>৬. কনফ্লিক্ট প্রতিরোধ ও সতর্কবার্তা</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    ভুলবশত যদি একজন শিক্ষককে একই পিরিয়ডে একাধিক ক্লাসে ক্লাস দেওয়া হয়, সিস্টেম উপরে লাল সতর্কবার্তা (Conflict Alert) দেখাবে এবং কোন কোন ক্লাসে ভুল হয়েছে তা চিহ্নিত করে দেবে।
                  </p>
                </div>

                {/* 7. File Import */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2.5 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                      <UploadCloud className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span>৭. পুরোনো ফাইল ইম্পোর্ট (Import File)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    আপনার কাছে যদি আগে থেকে এক্সেল (.xlsx), ওয়ার্ড (.docx), পিডিএফ বা খাতার ছবি থাকে, তবে "Import File" বাটনে গিয়ে ফাইল আপলোড করলেই তা এই সিস্টেমে কনভার্ট হয়ে যাবে।
                  </p>
                </div>

                {/* 8. Export to Word & PDF */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
                  <div className="flex items-center gap-2.5 text-blue-700 dark:text-blue-400 font-bold text-sm">
                    <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                      <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <span>৮. এক্সপোর্ট ও প্রিন্ট (Export Word / PDF)</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    "Export Word / PDF" বাটনে ক্লিক করে অফিশিয়াল হেডার ও স্বাক্ষরসহ কালারফুল রুটিন Microsoft Word (.docx), PDF অথবা Excel ফাইলে ডাউনলোড বা সরাসরি প্রিন্ট করতে পারেন।
                  </p>
                </div>
              </div>

              {/* Quick Actions Shortcuts */}
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  সরাসরি অ্যাকশন শুরু করুন:
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {canEdit && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenAutoGenerate();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
                    >
                      Auto-Fill রুটিন
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onClose();
                      onOpenExport();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition"
                  >
                    ডাউনলোড / প্রিন্ট
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenSmartImport();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition"
                    >
                      ফাইল ইম্পোর্ট
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenSettings();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800 transition"
                    >
                      স্কুল সেটিংস
                    </button>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>আইকন ড্রিমস স্কুল অ্যান্ড কলেজ • স্মার্ট রুটিন ও প্রক্সি সিস্টেম</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-xl transition-colors"
          >
            বন্ধ করুন (Close)
          </button>
        </div>

      </div>
    </div>
  );
};
