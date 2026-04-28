/**
 * Script to populate a test repo with realistic code for hackathon testing.
 * Run: node scripts/populate-test-repo.mjs
 */

const REPO = "MartinPuli/hackaclaw-test-invoice-parser";
const TOKEN = process.env.GH_TOKEN;
const API = "https://api.github.com";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

async function putFile(path, content, message) {
  // Check if file exists
  let sha;
  try {
    const getRes = await fetch(`${API}/repos/${REPO}/contents/${path}`, { headers });
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  } catch {}

  const body = {
    message,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Failed to create ${path}: ${res.status} ${err}`);
    return false;
  }
  console.log(`✓ ${path}`);
  return true;
}

const FILES = {
  "README.md": `# 📄 AI Invoice Parser

An automated invoice processing tool that extracts structured data from PDF invoices using AI.

## Features
- PDF text extraction via pdf-parse
- AI-powered field extraction (vendor, amount, date, line items)
- REST API endpoint for processing
- JSON output format
- Batch processing support
- Error handling with confidence scores

## Tech Stack
- **Runtime**: Node.js + TypeScript
- **AI**: OpenAI GPT-4o for extraction
- **PDF**: pdf-parse for text extraction
- **API**: Express.js REST server
- **Testing**: Jest + supertest

## Quick Start
\`\`\`bash
npm install
npm run dev    # Start dev server on :3000
npm test       # Run test suite
\`\`\`

## API Usage
\`\`\`bash
curl -X POST http://localhost:3000/api/parse \\
  -F 'invoice=@invoice.pdf'
\`\`\`

## Response Format
\`\`\`json
{
  "vendor": "Acme Corp",
  "invoice_number": "INV-2026-0042",
  "date": "2026-03-15",
  "due_date": "2026-04-15",
  "total": 1250.00,
  "currency": "USD",
  "line_items": [
    { "description": "Consulting services", "qty": 10, "unit_price": 125.00 }
  ],
  "confidence": 0.95
}
\`\`\`

## License
MIT
`,

  "package.json": JSON.stringify({
    name: "ai-invoice-parser",
    version: "1.0.0",
    description: "AI-powered invoice PDF parser",
    main: "dist/index.js",
    scripts: {
      dev: "tsx src/index.ts",
      build: "tsc",
      start: "node dist/index.js",
      test: "jest",
    },
    dependencies: {
      express: "^4.18.2",
      multer: "^1.4.5-lts.1",
      "pdf-parse": "^1.1.1",
      openai: "^4.52.0",
      zod: "^3.23.8",
      dotenv: "^16.4.5",
    },
    devDependencies: {
      "@types/express": "^4.17.21",
      "@types/multer": "^1.4.11",
      "@types/jest": "^29.5.12",
      jest: "^29.7.0",
      "ts-jest": "^29.1.2",
      tsx: "^4.12.0",
      typescript: "^5.4.5",
      supertest: "^6.3.4",
    },
  }, null, 2),

  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "commonjs",
      lib: ["ES2022"],
      outDir: "./dist",
      rootDir: "./src",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist", "**/*.test.ts"],
  }, null, 2),

  "Dockerfile": `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/index.js"]
`,

  ".env.example": `OPENAI_API_KEY=sk-your-key-here
PORT=3000
MAX_FILE_SIZE_MB=10
LOG_LEVEL=info
`,

  "src/index.ts": `import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { parseInvoice } from "./parser";
import { extractFields } from "./extractor";
import { InvoiceSchema } from "./types";

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024 },
});

app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

// Parse a PDF invoice
app.post("/api/parse", upload.single("invoice"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Send a PDF as 'invoice' field." });
    }

    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF files are accepted." });
    }

    // Step 1: Extract text from PDF
    const text = await parseInvoice(req.file.buffer);

    if (!text || text.trim().length < 10) {
      return res.status(422).json({ error: "Could not extract text from PDF. File may be image-based." });
    }

    // Step 2: Use AI to extract structured fields
    const result = await extractFields(text);

    // Step 3: Validate against schema
    const validated = InvoiceSchema.safeParse(result);

    if (!validated.success) {
      return res.status(422).json({
        error: "AI extraction returned invalid data",
        details: validated.error.issues,
        raw: result,
      });
    }

    return res.json({
      success: true,
      data: validated.data,
      metadata: {
        pages_processed: 1,
        text_length: text.length,
        processing_time_ms: Date.now(), // simplified
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Parse error:", err);
    return res.status(500).json({ error: message });
  }
});

// Batch parse
app.post("/api/parse/batch", upload.array("invoices", 20), async (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No files uploaded." });
  }

  const results = await Promise.allSettled(
    files.map(async (file) => {
      const text = await parseInvoice(file.buffer);
      return extractFields(text);
    })
  );

  return res.json({
    success: true,
    total: files.length,
    results: results.map((r, i) => ({
      filename: files[i].originalname,
      status: r.status,
      data: r.status === "fulfilled" ? r.value : null,
      error: r.status === "rejected" ? r.reason?.message : null,
    })),
  });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(\`Invoice Parser API running on http://localhost:\${PORT}\`);
});

export { app };
`,

  "src/parser.ts": `import pdfParse from "pdf-parse";

/**
 * Extract raw text content from a PDF buffer.
 */
export async function parseInvoice(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown PDF parse error";
    throw new Error(\`PDF parsing failed: \${message}\`);
  }
}
`,

  "src/extractor.ts": `import OpenAI from "openai";
import type { InvoiceData } from "./types";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = \`You are an expert invoice data extractor. Given raw text from a PDF invoice, extract structured data.

Return ONLY a valid JSON object with these fields:
- vendor: string (company name on the invoice)
- invoice_number: string
- date: string (YYYY-MM-DD format)
- due_date: string | null (YYYY-MM-DD format)
- total: number (total amount)
- subtotal: number | null
- tax: number | null
- currency: string (ISO 4217 code, default "USD")
- line_items: array of { description: string, qty: number, unit_price: number, total: number }
- confidence: number (0.0 to 1.0, how confident you are in the extraction)

If a field cannot be determined, use null. Always return valid JSON.\`;

/**
 * Use AI to extract structured invoice data from raw text.
 */
export async function extractFields(text: string): Promise<InvoiceData> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: \`Extract invoice data from this text:\\n\\n\${text}\` },
    ],
    temperature: 0.1,
    max_tokens: 1024,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("AI returned empty response");
  }

  try {
    return JSON.parse(content) as InvoiceData;
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}
`,

  "src/types.ts": `import { z } from "zod";

export const LineItemSchema = z.object({
  description: z.string(),
  qty: z.number(),
  unit_price: z.number(),
  total: z.number().optional(),
});

export const InvoiceSchema = z.object({
  vendor: z.string(),
  invoice_number: z.string(),
  date: z.string(),
  due_date: z.string().nullable().optional(),
  total: z.number(),
  subtotal: z.number().nullable().optional(),
  tax: z.number().nullable().optional(),
  currency: z.string().default("USD"),
  line_items: z.array(LineItemSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type InvoiceData = z.infer<typeof InvoiceSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;
`,

  "src/__tests__/parser.test.ts": `import { parseInvoice } from "../parser";

describe("parseInvoice", () => {
  it("should throw on empty buffer", async () => {
    await expect(parseInvoice(Buffer.from(""))).rejects.toThrow();
  });

  it("should throw on invalid PDF data", async () => {
    await expect(parseInvoice(Buffer.from("not a pdf"))).rejects.toThrow("PDF parsing failed");
  });
});
`,

  "src/__tests__/types.test.ts": `import { InvoiceSchema } from "../types";

describe("InvoiceSchema", () => {
  it("should validate a correct invoice", () => {
    const result = InvoiceSchema.safeParse({
      vendor: "Acme Corp",
      invoice_number: "INV-001",
      date: "2026-01-15",
      total: 500.00,
      currency: "USD",
      line_items: [
        { description: "Service", qty: 1, unit_price: 500.00 },
      ],
      confidence: 0.95,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing vendor", () => {
    const result = InvoiceSchema.safeParse({
      invoice_number: "INV-001",
      date: "2026-01-15",
      total: 500.00,
    });
    expect(result.success).toBe(false);
  });

  it("should reject confidence > 1", () => {
    const result = InvoiceSchema.safeParse({
      vendor: "Test",
      invoice_number: "X",
      date: "2026-01-01",
      total: 100,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
`,
};

async function main() {
  if (!TOKEN) {
    console.error("Set GH_TOKEN env var");
    process.exit(1);
  }

  console.log(`Populating ${REPO} with ${Object.keys(FILES).length} files...\n`);

  for (const [path, content] of Object.entries(FILES)) {
    await putFile(path, content, `Add ${path}`);
  }

  console.log(`\nDone! https://github.com/${REPO}`);
}

main().catch(console.error);
