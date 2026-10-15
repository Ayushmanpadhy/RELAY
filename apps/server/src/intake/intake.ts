import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { CONFIG, type Manifest, type ManifestItem } from '@relay/shared';
import { extractFileContent } from './extractor.js';

export interface ProcessedUploadFile {
  originalName: string;
  savedPath: string;
  mime: string;
  bytes: number;
}

export class IntakeManager {
  private baseJobsDir: string;

  constructor(dataDir?: string) {
    const rootData = dataDir || process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
    this.baseJobsDir = path.join(rootData, 'jobs');
    if (!fs.existsSync(this.baseJobsDir)) {
      fs.mkdirSync(this.baseJobsDir, { recursive: true });
    }
  }

  getJobDir(jobId: string): string {
    const dir = path.join(this.baseJobsDir, jobId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getUploadsDir(jobId: string): string {
    const dir = path.join(this.getJobDir(jobId), 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getExtractedDir(jobId: string): string {
    const dir = path.join(this.getJobDir(jobId), 'extracted');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getDeliverableDir(jobId: string): string {
    const dir = path.join(this.getJobDir(jobId), 'deliverable');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Safe extraction of ZIP archives blocking path traversal (Zip Slip vulnerability).
   * Enforces limits: total size <= 500 MB, total files <= 2,000.
   */
  async extractZipArchive(
    zipPath: string,
    targetDir: string,
    currentTotalFiles: number,
    currentTotalBytes: number
  ): Promise<{ files: ProcessedUploadFile[]; newTotalFiles: number; newTotalBytes: number }> {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const extractedFiles: ProcessedUploadFile[] = [];

    let totalFiles = currentTotalFiles;
    let totalBytes = currentTotalBytes;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      totalFiles++;
      if (totalFiles > CONFIG.MAX_UPLOAD_FILES) {
        throw new Error(`Upload exceeds maximum file limit of ${CONFIG.MAX_UPLOAD_FILES} files.`);
      }

      totalBytes += entry.header.size;
      if (totalBytes > CONFIG.MAX_UPLOAD_BYTES) {
        throw new Error(`Upload exceeds maximum size limit of ${Math.round(CONFIG.MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
      }

      // Security check: Zip Slip / path traversal
      const entryName = entry.entryName.replace(/\\/g, '/');
      if (entryName.includes('..') || path.isAbsolute(entryName)) {
        throw new Error(`Security violation: Malicious zip entry detected (${entryName}).`);
      }

      const destPath = path.resolve(targetDir, entryName);
      if (!destPath.startsWith(path.resolve(targetDir))) {
        throw new Error(`Security violation: Zip entry points outside target directory (${entryName}).`);
      }

      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.writeFileSync(destPath, entry.getData());

      const mime = this.guessMime(entryName);
      extractedFiles.push({
        originalName: path.basename(entryName),
        savedPath: destPath,
        mime,
        bytes: entry.header.size,
      });
    }

    return { files: extractedFiles, newTotalFiles: totalFiles, newTotalBytes: totalBytes };
  }

  /**
   * Process uploaded files, extract text / rows, and construct the file manifest.
   */
  async processUploads(jobId: string, rawFiles: ProcessedUploadFile[]): Promise<Manifest> {
    const uploadsDir = this.getUploadsDir(jobId);
    const extractedDir = this.getExtractedDir(jobId);

    const allFiles: ProcessedUploadFile[] = [];
    let runningFileCount = 0;
    let runningBytes = 0;

    // 1. Process files and unpack any ZIP archives
    for (const file of rawFiles) {
      runningFileCount++;
      runningBytes += file.bytes;

      if (runningFileCount > CONFIG.MAX_UPLOAD_FILES) {
        throw new Error(`Exceeded maximum limit of ${CONFIG.MAX_UPLOAD_FILES} files.`);
      }
      if (runningBytes > CONFIG.MAX_UPLOAD_BYTES) {
        throw new Error(`Exceeded maximum upload limit of 500 MB.`);
      }

      const ext = path.extname(file.originalName).toLowerCase();
      if (ext === '.zip' || file.mime === 'application/zip') {
        const unzipped = await this.extractZipArchive(
          file.savedPath,
          uploadsDir,
          runningFileCount,
          runningBytes
        );
        allFiles.push(...unzipped.files);
        runningFileCount = unzipped.newTotalFiles;
        runningBytes = unzipped.newTotalBytes;
      } else {
        allFiles.push(file);
      }
    }

    // 2. Extract content and construct manifest items
    const manifestItems: ManifestItem[] = [];
    let totalEstTokens = 0;
    const typeCounts: Record<string, number> = {};
    let totalPages = 0;
    let totalRows = 0;

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      const fileId = `f_${i}_${path.basename(file.originalName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const ext = path.extname(file.originalName).toLowerCase() || 'other';

      typeCounts[ext] = (typeCounts[ext] || 0) + 1;

      const extraction = await extractFileContent(file.savedPath, file.originalName, file.mime);

      if (extraction.pages) totalPages += extraction.pages;
      if (extraction.rows) totalRows += extraction.rows;

      const tokenEstimate = Math.ceil(extraction.text.length / 4);
      totalEstTokens += tokenEstimate;

      // Persist extracted content to data/jobs/<id>/extracted/<fileId>.json
      const extractedJsonPath = path.join(extractedDir, `${fileId}.json`);
      fs.writeFileSync(
        extractedJsonPath,
        JSON.stringify(
          {
            fileId,
            filename: file.originalName,
            mime: file.mime,
            bytes: file.bytes,
            pages: extraction.pages,
            rows: extraction.rows,
            data: extraction.data,
            text: extraction.text,
            error: extraction.error,
          },
          null,
          2
        ),
        'utf-8'
      );

      // Construct text preview (first 1500 chars or first 5 rows)
      let preview = '';
      if (extraction.rows && Array.isArray(extraction.data)) {
        preview = JSON.stringify(extraction.data.slice(0, 5), null, 2);
      } else if (extraction.text) {
        preview = extraction.text.slice(0, 1500).trim();
      } else if (extraction.error) {
        preview = `[${extraction.error}]`;
      }

      manifestItems.push({
        id: fileId,
        name: file.originalName,
        mime: file.mime,
        bytes: file.bytes,
        pages: extraction.pages,
        rows: extraction.rows,
        textPreview: preview,
        estTokens: tokenEstimate,
        extractedPath: extractedJsonPath,
        error: extraction.error,
      });
    }

    // 3. Generate summary string
    const summaryParts: string[] = [];
    for (const [ext, count] of Object.entries(typeCounts)) {
      summaryParts.push(`${count} ${ext}`);
    }
    if (totalPages > 0) summaryParts.push(`~${totalPages} pages`);
    if (totalRows > 0) summaryParts.push(`~${totalRows} rows`);
    summaryParts.push(`~${(totalEstTokens / 1000).toFixed(1)}k tokens`);

    const summary = `${allFiles.length} file(s) (${summaryParts.join(', ')})`;

    return {
      files: manifestItems,
      summary,
      totalFiles: allFiles.length,
      totalBytes: runningBytes,
      totalEstTokens,
    };
  }

  private guessMime(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case '.pdf': return 'application/pdf';
      case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case '.xls': return 'application/vnd.ms-excel';
      case '.csv': return 'text/csv';
      case '.json': return 'application/json';
      case '.txt': return 'text/plain';
      case '.md': return 'text/markdown';
      case '.png': return 'image/png';
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.webp': return 'image/webp';
      case '.gif': return 'image/gif';
      case '.zip': return 'application/zip';
      default: return 'application/octet-stream';
    }
  }
}
