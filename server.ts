import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// API route to parse schedule files (Image, PDF, Word text) using Gemini
app.post('/api/parse-schedule-file', async (req: Request, res: Response) => {
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
