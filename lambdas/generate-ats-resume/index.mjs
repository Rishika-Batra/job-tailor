import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({});
const bucketName = process.env.BUCKET;
const groqApiKey = process.env.GROQ_API_KEY;

export const handler = async (event) => {
  try {
    const authorizer = event.requestContext?.authorizer;
    const userId = authorizer?.claims?.sub || authorizer?.jwt?.claims?.sub;
    
    if (!userId) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing request body" }) };
    }
    
    const { jobId, selectedRepos } = JSON.parse(event.body);
    if (!jobId || !selectedRepos) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId or selectedRepos" }) };
    }

    // Fetch files from S3
    const getS3Text = async (key) => {
      try {
        const cmd = new GetObjectCommand({ Bucket: bucketName, Key: key });
        const res = await s3Client.send(cmd);
        return await res.Body.transformToString();
      } catch (err) {
        console.error(`Error fetching ${key}:`, err);
        return null;
      }
    };

    const resumeText = await getS3Text(`processed/${jobId}/resume.txt`);
    const jdText = await getS3Text(`processed/${jobId}/jd.txt`);
    const finalResultStr = await getS3Text(`results/${jobId}/final.json`);

    if (!resumeText || !jdText || !finalResultStr) {
      return { statusCode: 404, body: JSON.stringify({ error: "Job data not found in S3" }) };
    }

    let finalResult;
    try {
      finalResult = JSON.parse(finalResultStr);
    } catch (e) {
      finalResult = {};
    }

    const gapsAnalysis = finalResult.gaps || [];

    const prompt = `You are an expert resume writer specializing in ATS (Applicant Tracking System) optimization. Restructure this resume to be maximally ATS-compatible and tailored to the target job, using ONLY real content from the original resume and the provided project list — never invent experience, skills, dates, or accomplishments.

ATS RULES YOU MUST FOLLOW:
- Use standard section headers only: SUMMARY, SKILLS, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS
- No tables, no columns, no graphics, no special characters or symbols in bullets
- Bullets start with strong action verbs
- Naturally incorporate keywords from the job description that genuinely apply to the candidate's real background — do not keyword-stuff
- Keep dates, company names, degree names exactly as they appear in the original resume

Return ONLY valid JSON, no preamble, no markdown fences, matching this schema:
{
  "summary": "2-3 sentence professional summary tailored to this role, based on real background",
  "skills": ["string"],
  "experience": [{ "title": "string", "company": "string", "dates": "string", "bullets": ["string"] }],
  "projects": [{ "name": "string", "tech": "string", "bullets": ["string"] }],
  "education": [{ "degree": "string", "institution": "string", "dates": "string" }],
  "certifications": ["string"]
}

Include the following selected GitHub projects in the "projects" section, writing 2-3 ATS-friendly bullets for each based on their name/description/language (do not fabricate metrics or details not implied by the description):
${JSON.stringify(selectedRepos)}

ORIGINAL RESUME:
"""
${resumeText}
"""

TARGET JOB DESCRIPTION:
"""
${jdText}
"""

KNOWN GAPS (do not try to hide these, just don't over-emphasize them):
"""
${JSON.stringify(gapsAnalysis)}
"""`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Groq API error: ${response.status} ${text}`);
      throw new Error(`Groq API returned ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch (parseError) {
      console.error(`Failed to parse Groq response as JSON. Raw response:\n\`\`\`\n${content}\n\`\`\``);
      throw parseError;
    }

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `ats-resumes/${jobId}/structured.json`,
      Body: JSON.stringify(parsedResult),
      ContentType: "application/json"
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ jobId, structuredResume: parsedResult })
    };
  } catch (error) {
    console.error("Error generating ATS resume:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
