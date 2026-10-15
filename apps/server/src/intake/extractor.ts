import fs from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import Papa from 'papaparse';

export interface ExtractionResult {
  text: string;
  pages?: number;
  rows?: number;
  data?: unknown;
  error?: string;
}

export async function extractFileContent(filePath: string, filename: string, mime: string): Promise<ExtractionResult> {
  const ext = path.extname(filename).toLowerCase();

  try {
    // 1. Text, Markdown, JSON, and Source Code (excluding CSV)
    if (
      (['.txt', '.md', '.markdown', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.html', '.css', '.xml', '.yaml', '.yml', '.log', '.sql', '.sh'].includes(ext) ||
       (mime.startsWith('text/') && mime !== 'text/csv' && ext !== '.csv') ||
       mime === 'application/json')
    ) {
      const text = fs.readFileSync(filePath, 'utf-8');
      let data: unknown = undefined;
      if (ext === '.json') {
        try {
          data = JSON.parse(text);
        } catch {
          // ignore parsing error
        }
      }
      return { text, data };
    }

    // 2. PDF Documents
    if (ext === '.pdf' || mime === 'application/pdf') {
      const buffer = fs.readFileSync(filePath);
      try {
        const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const parser = new PDFParse(uint8);
        const res: any = await parser.getText();
        const text = typeof res === 'string' ? res : (res?.text || '');
        const pages = typeof res === 'object' && Array.isArray(res?.pages) ? res.pages.length : 1;
        return { text, pages };
      } catch {
        return { text: buffer.toString('utf-8', 0, 5000), pages: 1 };
      }
    }

    // 3. Word Documents (.docx)
    if (ext === '.docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const buffer = fs.readFileSync(filePath);
      const res = await mammoth.extractRawText({ buffer });
      return {
        text: res.value || '',
      };
    }

    // 4. CSV Files
    if (ext === '.csv' || mime === 'text/csv') {
      const text = fs.readFileSync(filePath, 'utf-8');
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      return {
        text,
        rows: parsed.data.length,
        data: parsed.data,
      };
    }

    // 5. Excel Spreadsheets (.xlsx, .xls)
    if (ext === '.xlsx' || ext === '.xls' || mime.includes('spreadsheetml') || mime.includes('excel')) {
      const workbook = xlsx.readFile(filePath);
      const allRows: unknown[] = [];
      let totalText = '';

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonRows = xlsx.utils.sheet_to_json(sheet);
        allRows.push(...jsonRows);
        totalText += `--- Sheet: ${sheetName} ---\n` + JSON.stringify(jsonRows.slice(0, 50), null, 2) + '\n\n';
      }

      return {
        text: totalText,
        rows: allRows.length,
        data: allRows,
      };
    }

    // 6. Image Files (Kept for vision LLM tasks / image tools)
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext) || mime.startsWith('image/')) {
      const stats = fs.statSync(filePath);
      return {
        text: `[Image file: ${filename}, size: ${stats.size} bytes]`,
      };
    }

    // 7. Unsupported types
    return {
      text: '',
      error: `Unsupported file type: ${ext || 'unknown'}. Skipping document extraction.`,
    };
  } catch (err: any) {
    return {
      text: '',
      error: `Failed to extract ${filename}: ${err.message}`,
    };
  }
}
