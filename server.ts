import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPER_ADMIN_EMAIL = 'ratan.mizan@gmail.com';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig | null {
  try {
    const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch {
    // Ignore read error
  }
  return null;
}

const firebaseCfg = loadFirebaseAppletConfig();

function emailToDocId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/@/g, '-at-')
    .replace(/\./g, '-dot-')
    .replace(/[^a-z0-9_-]/g, '-');
}

let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCerts && now < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Failed to fetch Firebase public signing certificates');
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  const certs = (await resp.json()) as Record<string, string>;
  cachedCerts = { certs, expiresAt: now + maxAgeMs };
  return certs;
}

function decodeBase64Url(input: string): Buffer {
  const norm = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

async function verifyFirebaseIdToken(token: string) {
  if (!firebaseCfg?.projectId) {
    throw new Error('Firebase project configuration missing on server');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed bearer token');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(decodeBase64Url(headerB64).toString('utf8'));
  const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8'));

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid token algorithm or key id');
  }

  const certs = await getGooglePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Unknown signing key id');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const isValidSig = verifier.verify(cert, decodeBase64Url(sigB64));
  if (!isValidSig) {
    throw new Error('Invalid token signature');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== firebaseCfg.projectId) {
    throw new Error('Invalid token audience');
  }
  if (payload.iss !== `https://securetoken.google.com/${firebaseCfg.projectId}`) {
    throw new Error('Invalid token issuer');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Token expired');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Missing token subject');
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Verified email required');
  }

  return payload as {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
  };
}

interface AuthenticatedReq extends Request {
  rbacUser?: {
    uid: string;
    email: string;
    role: 'super_admin' | 'admin' | 'viewer';
    status: 'active' | 'paused' | 'blocked' | 'none';
  };
}

async function resolveUserRoleAndStatus(
  email: string,
  bearerToken: string
): Promise<{ role: 'super_admin' | 'admin' | 'viewer'; status: 'active' | 'paused' | 'blocked' | 'none' }> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return { role: 'super_admin', status: 'active' };
  }
  if (!firebaseCfg?.projectId) {
    return { role: 'viewer', status: 'none' };
  }
  const dbId = firebaseCfg.firestoreDatabaseId || '(default)';
  const docId = emailToDocId(cleanEmail);
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseCfg.projectId}/databases/${dbId}/documents/admins/${docId}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!resp.ok) {
    return { role: 'viewer', status: 'none' };
  }
  const docJson = (await resp.json()) as {
    fields?: {
      role?: { stringValue?: string };
      status?: { stringValue?: string };
    };
  };
  const roleVal = docJson.fields?.role?.stringValue;
  const statusVal = docJson.fields?.status?.stringValue;
  if (roleVal === 'admin' && (statusVal === 'active' || statusVal === 'paused' || statusVal === 'blocked')) {
    return { role: 'admin', status: statusVal };
  }
  return { role: 'viewer', status: 'none' };
}

async function requireActiveAdmin(req: AuthenticatedReq, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'অননুমোদিত অনুরোধ: এই অপারেশনের জন্য অনুমোদিত Admin বা Super Admin লগইন প্রয়োজন।',
      });
    }
    const token = authHeader.slice(7).trim();
    const verified = await verifyFirebaseIdToken(token);
    const { role, status } = await resolveUserRoleAndStatus(verified.email, token);

    if (role === 'viewer') {
      return res.status(403).json({
        error: 'অ্যাক্সেস অস্বীকৃত (403): সাধারণ ভিউয়ার কোনো এডমিন অপারেশন চালাতে পারবেন না।',
      });
    }
    if (role === 'admin' && status !== 'active') {
      return res.status(403).json({
        error:
          status === 'blocked'
            ? 'অ্যাক্সেস ব্লক করা হয়েছে: সুপার এডমিন আপনার অ্যাকাউন্ট ব্লক করেছেন।'
            : 'অ্যাক্সেস সাময়িকভাবে স্থগিত: সুপার এডমিন আপনার কাজ সাময়িকভাবে বন্ধ (Paused) রেখেছেন।',
      });
    }

    req.rbacUser = {
      uid: verified.sub,
      email: verified.email.toLowerCase(),
      role,
      status,
    };
    return next();
  } catch (err: any) {
    return res.status(401).json({
      error: `সেশন যাচাই ব্যর্থ হয়েছে: ${err?.message || 'অবৈধ টোকেন'}`,
    });
  }
}

const app = express();
const port = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Server-side RBAC session verification endpoint
app.get('/api/auth/status', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.json({ authenticated: false, role: 'viewer', status: 'none' });
    }
    const token = authHeader.slice(7).trim();
    const verified = await verifyFirebaseIdToken(token);
    const { role, status } = await resolveUserRoleAndStatus(verified.email, token);
    return res.json({
      authenticated: true,
      email: verified.email.toLowerCase(),
      role,
      status,
    });
  } catch {
    return res.json({ authenticated: false, role: 'viewer', status: 'none' });
  }
});

// Direct APK download route with appropriate attachment headers
app.get(['/IDSC_Routine.apk', '/api/download-apk'], (_req: Request, res: Response) => {
  const publicApk = path.resolve(__dirname, 'public', 'IDSC_Routine.apk');
  const distApk = path.resolve(__dirname, 'dist', 'IDSC_Routine.apk');
  const targetApk = fs.existsSync(publicApk) ? publicApk : distApk;

  if (fs.existsSync(targetApk)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    return res.download(targetApk, 'IDSC_Routine.apk');
  }
  return res.status(404).send('APK file not found. Please refresh.');
});

// Protected API route to parse schedule files (Active Admin & Super Admin only)
app.post('/api/parse-schedule-file', requireActiveAdmin, async (req: AuthenticatedReq, res: Response) => {
  try {
    const { base64Data, mimeType, fileName } = req.body;

    if (!base64Data || !mimeType) {
      return res.status(400).json({ error: 'Missing base64Data or mimeType' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not set on server' });
    }

    const ai = new GoogleGenAI({});

    const systemInstruction = `You are a school routine and timetable data extraction specialist.
Analyze the provided document, image, or text file containing school routine information.
Extract all classes, sections, teachers, subjects, and timetable period assignments.
Standard working days are: Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday.
Return STRICT JSON conforming to this schema without any markdown wrapping or explanation:
{
  "schoolName": string,
  "academicYear": string,
  "classes": [
    {
      "name": "Play" | "Nursery" | "KG" | "Class 1" | "Class 2" ... "Class 10",
      "sections": ["Section A", "Section B" ...]
    }
  ],
  "teachers": [
    {
      "name": string,
      "initials": string,
      "designation": string,
      "subjects": [string]
    }
  ],
  "subjects": [
    {
      "name": string,
      "code": string
    }
  ],
  "entries": [
    {
      "className": string,
      "sectionName": string,
      "day": "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday",
      "periodIndex": number (1, 2, 3...),
      "subjectName": string,
      "teacherName": string,
      "room": string (optional)
    }
  ]
}`;

    const prompt = `Please extract the complete school routine timetable from this uploaded file: "${fileName}".
Identify the class name, section, day of week, period number, subject, and teacher for every class in the routine.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    return res.json({ success: true, data: parsed });
  } catch (error: any) {
    console.error('Error in /api/parse-schedule-file:', error);
    return res.status(500).json({ error: error?.message || 'Failed to parse file with AI' });
  }
});

async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    // Serve a clean no-WebSocket @vite/client shim since HMR is disabled in preview environment
    app.get('/@vite/client', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
if (typeof customElements !== 'undefined' && !customElements.get('vite-error-overlay')) {
  customElements.define('vite-error-overlay', ErrorOverlay);
}
`);
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
}

startServer();
