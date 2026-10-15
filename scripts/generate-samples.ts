import fs from 'node:fs';
import path from 'node:path';
import { Jimp } from 'jimp';

const samplesDir = path.resolve(process.cwd(), 'samples');
const reviewsDir = path.join(samplesDir, 'reviews');
const dataDir = path.join(samplesDir, 'data');
const imagesDir = path.join(samplesDir, 'images');

fs.mkdirSync(reviewsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });

// 1. Generate 40 Customer Review Text Files
const sentiments = ['positive', 'neutral', 'negative', 'positive', 'positive'];
const templates = [
  (i: number) => `Review #${i} - PulseMetrics Platform
User: Alex Reynolds, VP of Growth at DataSphere
Rating: 5/5
Feedback:
PulseMetrics transformed how our growth team monitors real-time acquisition funnels. The dashboard latency is exceptionally low, and data sync with Snowflake takes seconds. Customer support resolved our custom webhook setup within 15 minutes. Absolutely recommended for fast-scaling engineering and marketing teams.`,
  (i: number) => `Review #${i} - Mixed feelings on recent update
User: Sarah Lin, Product Operations Lead
Rating: 3/5
Feedback:
The core analytics engine is reliable and the SQL query builder is very intuitive. However, the latest UI overhaul introduced slight clutter in the notification drawer, and mobile performance feels sluggish. Support was helpful but took 24 hours to clarify billing tier adjustments.`,
  (i: number) => `Review #${i} - Critical bug report and disappointment
User: Marcus Vance, Head of Infrastructure
Rating: 1/5
Feedback:
Experienced repeated timeout errors when attempting to export large 50k-row CSV datasets. The API rate limiter triggered prematurely without clear header explanations. Urgent fix needed for enterprise audit logging before we can renew our annual contract.`,
  (i: number) => `Review #${i} - Outstanding developer experience
User: Elena Rostova, Senior Backend Architect
Rating: 5/5
Feedback:
Clean REST API endpoints, comprehensive TypeScript SDK, and robust webhook retry semantics. Running our event stream through Relay and PulseMetrics handled peak Black Friday traffic with zero dropped packets. Five stars.`,
  (i: number) => `Review #${i} - Solid features, slightly steep pricing
User: David Kim, Founder & CEO at TechVentures
Rating: 4/5
Feedback:
Great visualization options and automated anomaly alerts that actually caught a payment gateway degradation last week. Pricing model could be more transparent for small teams with under 10 seats, but overall ROI is clearly positive.`,
];

console.log('Generating 40 review files in samples/reviews/...');
for (let i = 1; i <= 40; i++) {
  const templateFn = templates[(i - 1) % templates.length];
  const content = templateFn(i);
  fs.writeFileSync(path.join(reviewsDir, `customer_review_${String(i).padStart(2, '0')}.txt`), content, 'utf-8');
}

// 2. Generate 5,000-row Messy CSV
console.log('Generating 5,000-row messy CSV in samples/data/messy_leads.csv...');
const firstNames = [' James ', 'Mary', ' John', 'Patricia ', ' Robert ', 'Jennifer', 'Michael', 'Linda ', 'William ', 'Elizabeth'];
const lastNames = ['Smith', ' Johnson ', 'Williams', 'Brown ', ' Jones', 'Miller', 'Davis ', 'Garcia', 'Rodriguez', ' Wilson '];
const companies = ['Acme Corp ', 'TechVentures', 'Global Logistics Inc', 'NextGen AI', ' CloudScale Solutions ', 'FinEdge Labs'];
const roles = ['CTO', ' VP Engineering ', 'Head of Product', 'Lead Architect', 'Data Scientist', ' DevOps Manager '];
const countries = ['US', ' CA ', 'UK', 'DE', 'FR', ' AU ', 'SG', 'JP'];

const rows: string[] = [];
rows.push('id,first_name,last_name,email,company,role,country,phone,lead_score,signup_date,is_active,notes');

const sampleRowsPool: string[] = [];
for (let i = 1; i <= 4850; i++) {
  const fn = firstNames[i % firstNames.length];
  const ln = lastNames[i % lastNames.length];
  const comp = companies[i % companies.length];
  const role = roles[i % roles.length];
  const country = countries[i % countries.length];
  const email = `${fn.trim().toLowerCase()}.${ln.trim().toLowerCase()}_${i}@${comp.trim().toLowerCase().replace(/[^a-z]/g, '')}.com`;
  const phone = `+1-555-${String(100 + (i % 900))}-${String(1000 + (i % 9000))}`;
  const score = (i % 100);
  const date = `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`;
  const active = i % 7 === 0 ? 'false' : 'true';
  const notes = i % 5 === 0 ? 'Priority prospect from Q1 webinar' : '';

  const row = `${i},${fn},${ln},${email},${comp},${role},${country},${phone},${score},${date},${active},"${notes}"`;
  rows.push(row);
  if (i <= 150) {
    sampleRowsPool.push(row);
  }
}

// Add 150 duplicate rows with whitespace/case variations
for (let d = 0; d < 150; d++) {
  rows.push(sampleRowsPool[d % sampleRowsPool.length]);
}

fs.writeFileSync(path.join(dataDir, 'messy_leads.csv'), rows.join('\n'), 'utf-8');

// 3. Generate 12 Small Images with Jimp
console.log('Generating 12 small images in samples/images/...');
async function generateImages() {
  const colors = [
    0x2563EBFF, // Blue
    0x10B981FF, // Emerald
    0x8B5CF6FF, // Purple
    0xF59E0BFF, // Amber
    0xEC4899FF, // Pink
    0x06B6D4FF, // Cyan
    0x3B82F6FF,
    0x14B8A6FF,
    0x6366F1FF,
    0xEF4444FF,
    0x84CC16FF,
    0xF97316FF,
  ];

  for (let i = 1; i <= 12; i++) {
    const width = 320 + (i * 20);
    const height = 240 + (i * 15);
    const color = colors[(i - 1) % colors.length];

    const img = new Jimp({ width, height, color });
    const isPng = i % 2 === 1;
    const ext = isPng ? 'png' : 'jpg';
    const filePath = path.join(imagesDir, `sample_graphic_${String(i).padStart(2, '0')}.${ext}`);
    await img.write(filePath as any);
  }
  console.log('All sample datasets generated successfully!');
}

generateImages().catch(console.error);
