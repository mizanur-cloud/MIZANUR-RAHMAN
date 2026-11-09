import express, { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
}

startServer();
