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
  "cover_letter_paragraphs": ["string"]  // 5-6 SEPARATE array elements forming a complete, formal business letter. Do NOT return this as one long string. Structure MUST be exactly:
  //   [0] Salutation on its own line: "Dear Hiring Manager," (or "Dear [Company] Hiring Team," if a company name is identifiable in the JD)
  //   [1] Opening paragraph: state the role being applied for and a brief, professional hook
  //   [2-3] Body paragraph(s): specific relevant experience, projects, and skills that map to the job description
  //   [second-to-last] Honest, brief acknowledgment of any gap if relevant, framed positively (eagerness to learn), without groveling or over-apologizing
  //   [last] Closing paragraph ending in "Sincerely," followed by a line break and the candidate'\''s full name (pull the name from the resume text)
  // Tone: formal, confident, professional business-letter register throughout — avoid casual phrasing, avoid excessive enthusiasm/exclamation, avoid generic filler like "esteemed organization"
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

  // Try multiple models in order. Groq enforces separate daily token quotas per
  // model, so if the primary model is rate-limited we fall back to another rather
  // than failing the whole request. Only a 429 triggers a fallback; any other
  // error status throws immediately, same as before.
  const MODELS = ['llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];

  let groqResponse;
  let lastErrorText;
  for (const model of MODELS) {
    const requestBody = {
      model,
      messages: [
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    };

    groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (groqResponse.ok) break;

    lastErrorText = await groqResponse.text();
    console.error(`Groq API error on model ${model}:`, lastErrorText);

    if (groqResponse.status !== 429) {
      throw new Error(`Groq API error: ${groqResponse.status} ${lastErrorText}`);
    }
    // 429 (rate limit) — try the next model
  }

  if (!groqResponse.ok) {
    throw new Error(`Groq API error: all models rate-limited. Last error: ${lastErrorText}`);
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
  const jdSnippet = jdText.trim().slice(0, 150);
  const matchScore = gapsAnalysis.match_score ?? null;

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { jobId },
      UpdateExpression: 'SET #st = :status, resultKey = :resultKey, completedAt = :completedAt, jdSnippet = :jdSnippet, matchScore = :matchScore',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':status': 'complete',
        ':resultKey': finalKey,
        ':completedAt': completedAt,
        ':jdSnippet': jdSnippet,
        ':matchScore': matchScore
      }
    })
  );

  return { jobId, status: 'complete' };
};
