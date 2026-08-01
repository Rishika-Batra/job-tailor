import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const s3Client = new S3Client({});

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
