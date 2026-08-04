import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const s3Client = new S3Client({});

// Pulls every hyperlink annotation out of the PDF, in reading order (top-to-bottom,
// left-to-right per page). pdf-parse never sees these — they live in /Annots, not the
// text stream — so this is the only way to recover clickable URLs.
async function extractLinks(pdfBytes) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  const links = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const annotations = await page.getAnnotations();
    const pageLinks = annotations
      .filter(a => a.subtype === 'Link' && a.url)
      .map(a => ({ url: a.url, y: a.rect[1], x: a.rect[0] }));
    pageLinks.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    links.push(...pageLinks.map(l => l.url));
  }
  return links;
}

export const handler = async (event) => {
  const { jobId } = event;
  if (!jobId) {
    throw new Error('jobId is missing from the event');
  }

  const bucketName = process.env.BUCKET;

  // 1. Fetch resume PDF from S3
  const getResumeCmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: `raw/${jobId}/resume.pdf`
  });
  
  const resumeResponse = await s3Client.send(getResumeCmd);
  const resumeBytes = await resumeResponse.Body.transformToByteArray();

  // 2. Extract text using pdf-parse
  const data = await pdfParse(Buffer.from(resumeBytes));
  const resumeText = data.text;

  // 2b. Extract hyperlink URLs separately, since pdf-parse drops them
  let resumeLinks = [];
  try {
    resumeLinks = await extractLinks(Buffer.from(resumeBytes));
  } catch (err) {
    console.error('Link extraction failed (non-fatal):', err);
  }

  // 3. Fetch JD text from S3
  const getJdCmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: `raw/${jobId}/jd.txt`
  });
  
  const jdResponse = await s3Client.send(getJdCmd);
  const jdText = await jdResponse.Body.transformToString();

  // 4. Write extracted resume text to S3
  const putResumeCmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: `processed/${jobId}/resume.txt`,
    Body: resumeText,
    ContentType: 'text/plain'
  });
  await s3Client.send(putResumeCmd);

  // 4b. Write extracted links to S3, in reading order
  const putLinksCmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: `processed/${jobId}/resume-links.json`,
    Body: JSON.stringify(resumeLinks),
    ContentType: 'application/json'
  });
  await s3Client.send(putLinksCmd);

  // 5. Write JD text to S3
  const putJdCmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: `processed/${jobId}/jd.txt`,
    Body: jdText,
    ContentType: 'text/plain'
  });
  await s3Client.send(putJdCmd);

  return { jobId };
};
