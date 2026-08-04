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
    const resumeLinksStr = await getS3Text(`processed/${jobId}/resume-links.json`);

    if (!resumeText || !jdText || !finalResultStr) {
      return { statusCode: 404, body: JSON.stringify({ error: "Job data not found in S3" }) };
    }

    let resumeLinks = [];
    try { resumeLinks = resumeLinksStr ? JSON.parse(resumeLinksStr) : []; } catch (e) {}

    let finalResult = {};
    try { finalResult = JSON.parse(finalResultStr); } catch (e) {}
    const gapsAnalysis = finalResult.gaps || [];

    const prompt = `You are an expert resume editor. Your task is to extract and reformat the provided resume into a strict, standardized ATS-friendly JSON schema, while making targeted edits to the Skills and Projects sections based on the Job Description.

STRICT RULES:
1. Extract ALL information from the original resume and map it to the provided JSON schema. Do not drop any experience, education, or other sections.
2. For the HEADER, extract the name, email, phone, and any URLs (GitHub, LinkedIn, Portfolio) from the text or the KNOWN HYPERLINK URLS list. Output actual URLs. CRITICAL: Do NOT hallucinate LinkedIn or LeetCode URLs. Use the EXACT URLs provided in the KNOWN HYPERLINK URLS list.
3. For EDUCATION, create a separate entry in the array for EACH degree/school (e.g., one for B.Tech, one for 12th grade, one for 10th grade). Extract GPA/Scores if present.
4. For SKILLS, extract the EXACT category labels word-for-word as they appear in the original resume (e.g. "Languages", "Frameworks & Tools", "Cloud & Databases", "ML/Data", "Data Visualization", "Competitive Programming" — whatever the original actually uses). Do NOT invent, rename, merge, split, or reorganize categories — never produce categories like "Front-end", "Full-stack", "DevOps", or "Artificial Intelligence" unless that EXACT label is literally in the original resume. Within each existing category you may reorder/reword items to emphasize matches with the job description, but the set of category names must be identical to the original, no more and no fewer.
5. For PROJECTS, select exactly 3 projects total. You MUST include the selected GitHub projects provided below. If you include GitHub projects, remove some original projects so the total number of projects is EXACTLY 3. Write 1-2 concise ATS-friendly bullets for each.
6. LENGTH CONSTRAINT: Limit bullets to EXACTLY 1-2 per experience/project to ensure it fits on one page. Do NOT exceed 2 bullets for any item. Be ruthlessly concise.
7. Skills information belongs ONLY in the top-level "skills" field. NEVER create an "other_sections" entry for skills, technical skills, or any variant of that heading, even partially — if you already captured skills content in "skills", do not repeat any part of it anywhere else in the JSON.

Return ONLY valid JSON, no preamble, no markdown fences, matching exactly this schema:
{
  "header": {
    "name": "string",
    "phone": "string",
    "email": "string",
    "links": ["string (e.g. https://github.com/...)"]
  },
  "summary": "string or null",
  "skills": { "Category Name": ["skill1", "skill2"] },
  "experience": [{ "title": "string", "company": "string", "dates": "string", "bullets": ["string"] }],
  "projects": [{ "name": "string", "tech": "string", "dates": "string", "url": "string or null", "bullets": ["string"] }],
  "education": [{ "degree": "string (e.g. B.Tech, ISC 12th)", "institution": "string", "dates": "string", "gpa": "string (e.g. CGPA: 8.29, 94%)" }],
  "certifications": ["string"],
  "other_sections": [{ "sectionTitle": "string", "entries": [{ "title": "string", "dates": "string", "bullets": ["string"] }] }]
}

SELECTED GITHUB PROJECTS (Add these to the "projects" array. For "dates", extract the year from the provided "updatedAt" field. Do not leave dates null):
${JSON.stringify(selectedRepos)}

KNOWN HYPERLINK URLS (Use these to populate header links if they match):
${JSON.stringify(resumeLinks)}

ORIGINAL RESUME TEXT:
"""
${resumeText}
"""

JOB DESCRIPTION:
"""
${jdText}
"""`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`Groq API error ${response.status}:`, errBody);
      throw new Error(`Groq API returned ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    let parsedResult = JSON.parse(content);

    // Merge real repo URLs back in
    if (parsedResult.projects) {
      parsedResult.projects = parsedResult.projects.slice(0, 3);
      const repoByName = Object.fromEntries((selectedRepos || []).map(r => [(r.name || '').toLowerCase(), r]));
      parsedResult.projects = parsedResult.projects.map(p => {
        const match = repoByName[(p.name || '').toLowerCase()];
        return match ? { ...p, url: match.url || match.html_url || p.url } : p;
      });
    }

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `ats-resumes/${jobId}/structured.json`,
      Body: JSON.stringify(parsedResult),
      ContentType: "application/json"
    }));

    return { statusCode: 200, body: JSON.stringify({ jobId, structuredResume: parsedResult }) };
  } catch (error) {
    console.error("Error generating ATS resume:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
