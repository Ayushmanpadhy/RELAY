import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from 'docx';
import type { Plan, Task } from '@relay/shared';

export async function createDeliverable(
  jobId: string,
  deliverableDir: string,
  plan: Plan,
  finalResult: any,
  tasks: Task[]
): Promise<string> {
  if (!fs.existsSync(deliverableDir)) {
    fs.mkdirSync(deliverableDir, { recursive: true });
  }

  const format = plan.deliverable.format;
  const filename = plan.deliverable.filename || `deliverable_${jobId}.${format}`;
  const outPath = path.join(deliverableDir, filename);

  switch (format) {
    case 'md': {
      let content = `# ${plan.deliverable.description || 'Task Deliverable'}\n\n`;
      content += `> **Job ID:** \`${jobId}\`  \n`;
      content += `> **Summary:** ${plan.userSummary}\n\n---\n\n`;

      if (typeof finalResult === 'string') {
        content += finalResult;
      } else if (finalResult && typeof finalResult === 'object') {
        if (finalResult.synthesis) {
          content += `## Executive Synthesis\n\n${finalResult.synthesis}\n\n`;
        }
        if (Array.isArray(finalResult.keyFindings) && finalResult.keyFindings.length > 0) {
          content += `### Key Findings\n\n`;
          for (const item of finalResult.keyFindings) {
            content += `- ${item}\n`;
          }
          content += '\n';
        }
        if (finalResult.summary) {
          content += `## Summary\n\n${finalResult.summary}\n\n`;
        }
        if (finalResult.translatedText) {
          content += `## Translated Content\n\n${finalResult.translatedText}\n\n`;
        }
        if (finalResult.rows && Array.isArray(finalResult.rows)) {
          content += `## Processed Rows (${finalResult.rows.length})\n\n`;
          const previewRows = finalResult.rows.slice(0, 50);
          content += '```json\n' + JSON.stringify(previewRows, null, 2) + '\n```\n';
        }
        if (!finalResult.synthesis && !finalResult.summary && !finalResult.rows && !finalResult.translatedText) {
          content += '```json\n' + JSON.stringify(finalResult, null, 2) + '\n```\n';
        }
      }

      fs.writeFileSync(outPath, content, 'utf-8');
      break;
    }

    case 'csv': {
      let csvContent = '';
      if (typeof finalResult === 'string') {
        csvContent = finalResult;
      } else if (finalResult?.csv) {
        csvContent = finalResult.csv;
      } else if (Array.isArray(finalResult?.rows)) {
        csvContent = Papa.unparse(finalResult.rows);
      } else if (Array.isArray(finalResult)) {
        csvContent = Papa.unparse(finalResult);
      } else if (typeof finalResult === 'object' && finalResult !== null) {
        csvContent = Papa.unparse([finalResult]);
      }
      fs.writeFileSync(outPath, csvContent, 'utf-8');
      break;
    }

    case 'xlsx': {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Relay Distributed Platform';
      wb.created = new Date();
      const ws = wb.addWorksheet('Deliverable');

      let rows: any[] = [];
      if (Array.isArray(finalResult)) rows = finalResult;
      else if (Array.isArray(finalResult?.rows)) rows = finalResult.rows;
      else if (typeof finalResult === 'object' && finalResult !== null) rows = [finalResult];

      if (rows.length > 0) {
        const columns = Object.keys(rows[0]).map(key => ({
          header: key,
          key,
          width: Math.max(15, key.length + 5),
        }));
        ws.columns = columns;

        // Style header row
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFEFEFEF' },
        };

        for (const row of rows) {
          ws.addRow(row);
        }
      } else {
        ws.addRow(['No tabular data returned.']);
      }

      await wb.xlsx.writeFile(outPath);
      break;
    }

    case 'docx': {
      const docChildren: Paragraph[] = [
        new Paragraph({
          text: plan.deliverable.description || 'Task Deliverable',
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Job ID: ${jobId}`, bold: true }),
            new TextRun({ text: `\nGenerated: ${new Date().toISOString()}` }),
          ],
        }),
        new Paragraph({
          text: 'Executive Summary',
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          text: plan.userSummary,
        }),
      ];

      if (finalResult?.synthesis) {
        docChildren.push(
          new Paragraph({ text: 'Synthesis', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: String(finalResult.synthesis) })
        );
      } else if (typeof finalResult === 'string') {
        docChildren.push(
          new Paragraph({ text: 'Output', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: finalResult })
        );
      } else if (finalResult) {
        docChildren.push(
          new Paragraph({ text: 'Data Output', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: JSON.stringify(finalResult, null, 2) })
        );
      }

      const doc = new Document({
        sections: [{ children: docChildren }],
      });

      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(outPath, buffer);
      break;
    }

    case 'json': {
      const jsonContent = JSON.stringify(finalResult ?? {}, null, 2);
      fs.writeFileSync(outPath, jsonContent, 'utf-8');
      break;
    }

    case 'zip': {
      const zip = new AdmZip();

      // Check tasks for image outputs or file attachments
      let addedAny = false;
      for (const t of tasks) {
        const res = t.result as any;
        if (res?.base64) {
          const buf = Buffer.from(res.base64, 'base64');
          const ext = res.format || 'png';
          const payloadObj = (t.payload || {}) as Record<string, any>;
          const name = typeof payloadObj.filename === 'string' ? payloadObj.filename : `output_${t.idx}.${ext}`;
          zip.addFile(name, buf);
          addedAny = true;
        } else if (res?.outputPath && typeof res.outputPath === 'string' && fs.existsSync(res.outputPath)) {
          zip.addLocalFile(res.outputPath);
          addedAny = true;
        }
      }

      if (!addedAny) {
        // Fallback: package JSON results into zip
        const summaryBuf = Buffer.from(JSON.stringify(finalResult ?? {}, null, 2), 'utf-8');
        zip.addFile('results.json', summaryBuf);
      }

      zip.writeZip(outPath);
      break;
    }
  }

  return outPath;
}
