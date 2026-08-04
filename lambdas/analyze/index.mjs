import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});

export const handler = async (event) => {
  const { jobId } = event;
  if (!jobId) {
    throw new Error('jobId is missing from the event');
  }

  const bucketName = process.env.BUCKET;
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

  const prompt = `You are a career analyst helping a job seeker understand how well their resume matches a job posting.

Analyze the RESUME against the JOB DESCRIPTION below. Return ONLY valid JSON, no preamble, no markdown code fences, matching exactly this schema:

{
  "must_have_requirements": ["string"],
  "nice_to_have_requirements": ["string"],
  "matches": [{ "requirement": "string", "evidence_from_resume": "string" }],
  "gaps": [{ "requirement": "string", "note": "string explaining what's missing" }],
  "match_score": 0,
  "seniority_signal": "string, e.g. entry-level / mid / senior, based on JD language"
}

Rules:
- match_score is 0-100, based on how well the resume's actual content covers the must-have requirements.
- Do not invent resume content. Only reference what is explicitly present in RESUME.
- Be honest and specific in gaps — vague gaps are not useful to the user.

RESUME:
"""
${resumeText}
"""

JOB DESCRIPTION:
"""
${jdText}
"""`;

  const requestBody = {
    model: 'openai/gpt-oss-120b',
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

  let analysis;
  try {
    analysis = JSON.parse(rawContent);
  } catch (error) {
    console.error('Failed to parse Groq response as JSON. Raw response:', rawContent);
    throw new Error('Failed to parse Groq response as JSON');
  }

  // Write the parsed analysis JSON to S3
  const putAnalysisCmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: `analysis/${jobId}/gaps.json`,
    Body: JSON.stringify(analysis, null, 2),
    ContentType: 'application/json'
  });
  await s3Client.send(putAnalysisCmd);

  return { jobId, matchScore: analysis.match_score };
};
