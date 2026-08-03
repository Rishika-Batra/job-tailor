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

    const prompt = `You are an expert resume editor. Your task is to make TWO targeted edits to this resume for a specific job application — nothing else. Do NOT restructure, reorder, rewrite, or rephrase any other part of the resume.

STRICT RULES:
1. Copy EVERY section exactly as it appears in the original resume — same section names, same order, same wording — EXCEPT for the two sections below.
2. ONLY modify these two sections:
   a. SKILLS: reorder/lightly reword to emphasize skills that genuinely match the job description. Do not add skills the candidate doesn't have.
   b. PROJECTS: rewrite bullets for EXISTING projects to better match the job description's language (rephrase only, no fabrication), AND add the provided selected GitHub projects with 1-2 concise bullets each.
3. Never invent experience, skills, dates, companies, degrees, or accomplishments not present in the original resume.
4. LENGTH CONSTRAINT — THIS IS CRITICAL: the final resume MUST fit on a single page when rendered. Be ruthlessly concise:
   - Each bullet is ONE line only (roughly 100-120 characters max), no wrapped multi-line bullets
   - Maximum 3 bullets per job/project
   - Skills as a single comma-separated line, not a long list
   - If the original resume has many projects/experience entries, keep only the most relevant ones to stay within one page — cutting weaker/less relevant original entries is acceptable to preserve length, but never fabricate to fill space

Return ONLY valid JSON, no preamble, no markdown fences, matching this schema:
{
  "header": {
    "name": "string — copy exactly from the original resume",
    "contact": "string — copy the contact line exactly (phone, email, links) as it appears in the original resume, preserving the separators used"
  },
  "summary": "string or null — ONLY include if the original resume already has a summary/objective section; otherwise set to null, do not invent one",
  "skills": ["string"],
  "experience": [{ "title": "string", "company": "string", "dates": "string", "bullets": ["string"] }],
  "projects": [{ "name": "string", "tech": "string", "bullets": ["string"] }],
  "education": [{ "degree": "string", "institution": "string", "dates": "string" }],
  "certifications": ["string"],
  "other_sections": [{ "sectionTitle": "string — the exact section heading from the original resume, e.g. Positions of Responsibility", "entries": [{ "title": "string", "dates": "string", "bullets": ["string"] }] }]
}

CRITICAL: The "header", "other_sections", and any section of the original resume not covered by summary/skills/experience/projects/education/certifications MUST be captured somewhere in this JSON. Do not silently drop any section that exists in the original resume — if it doesn't fit an existing field, put it in "other_sections" verbatim. The only fields you are allowed to meaningfully CHANGE are "skills" and "projects" — every other field should be a faithful copy of the original resume's content.

Copy experience, education, and certifications directly from the original resume (verbatim structure and wording) — do not rewrite them.

Include these selected GitHub projects in the "projects" array, writing 1-2 concise ATS-friendly bullets for each based on their name/description/language (do not fabricate metrics or details not implied by the description):
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
