import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler = async (event) => {
  const { jobId } = event;
  if (!jobId) {
    throw new Error('jobId is missing from the event');
  }

  const bucketName = process.env.BUCKET;
  const tableName = process.env.TABLE;
  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  // Fetch resume.txt
  const getResumeCmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: `processed/${jobId}/resume.txt`
  });
  const resumeResponse = await s3Client.send(getResumeCmd);
  const resumeText = await resumeResponse.Body.transformToString();

  // Fetch jd.txt
  const getJdCmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: `processed/${jobId}/jd.txt`
  });
  const jdResponse = await s3Client.send(getJdCmd);
  const jdText = await jdResponse.Body.transformToString();

  // Fetch gaps.json (from the analyze step)
  const getGapsCmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: `analysis/${jobId}/gaps.json`
  });
  const gapsResponse = await s3Client.send(getGapsCmd);
  const gapsText = await gapsResponse.Body.transformToString();
  const gapsAnalysis = JSON.parse(gapsText);
  const analysisJson = gapsText;

  const prompt = `You are helping a job seeker tailor their application materials. You have their resume, the job description, and a gap analysis already performed.

STRICT RULE: Never invent experience, skills, or accomplishments that are not present in the original resume. You may only REPHRASE and REFRAME existing content to better match the job description's language. If asked to address a gap, do not fabricate — instead note it honestly.

Return ONLY valid JSON matching this schema, no preamble, no markdown fences:

{
  "rewritten_bullets": [{ "original": "string", "rewritten": "string", "why": "short explanation of what changed and why" }],
  "cover_letter": "string, 3-4 paragraphs, professional tone, references specific details from both the resume and job description"
}

Pick the 3-5 resume bullets most relevant to this job description to rewrite.

RESUME:
"""
${resumeText}
"""

JOB DESCRIPTION:
"""
${jdText}
"""

GAP ANALYSIS:
"""
${analysisJson}
"""`;

  const requestBody = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' }
  };

  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqApiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!groqResponse.ok) {
    const errorText = await groqResponse.text();
    console.error('Groq API Error Text:', errorText);
    throw new Error(`Groq API error: ${groqResponse.status} ${errorText}`);
  }

  const responseJson = await groqResponse.json();
  const rawContent = responseJson.choices[0].message.content;

  let generated;
  try {
    generated = JSON.parse(rawContent);
  } catch (error) {
    console.error('Failed to parse Groq response as JSON. Raw response:', rawContent);
    throw new Error('Failed to parse Groq response as JSON');
  }

  // Combine the analysis JSON and the generated JSON into one object
  const finalResult = {
    ...gapsAnalysis,
    ...generated
  };

  // Write it to S3 at results/{jobId}/final.json
  const finalKey = `results/${jobId}/final.json`;
  const putFinalCmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: finalKey,
    Body: JSON.stringify(finalResult, null, 2),
    ContentType: 'application/json'
  });
  await s3Client.send(putFinalCmd);

  // Update the DynamoDB record for this jobId: set status to "complete", resultKey to the S3 key above, and completedAt to the current timestamp
  const completedAt = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { jobId },
      UpdateExpression: 'SET #st = :status, resultKey = :resultKey, completedAt = :completedAt',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':status': 'complete',
        ':resultKey': finalKey,
        ':completedAt': completedAt
      }
    })
  );

  return { jobId, status: 'complete' };
};
