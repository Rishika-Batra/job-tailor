const groqApiKey = process.env.GROQ_API_KEY;

export const handler = async (event) => {
  try {
    if (!event.body) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing request body" }) };
    }
    
    const { jdText, repos } = JSON.parse(event.body);
    if (!jdText || !repos) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing jdText or repos in request" }) };
    }

    const prompt = `You are helping a job seeker pick the single best GitHub projects to feature on a resume for a specific job application.

Given the JOB DESCRIPTION and a list of REPOSITORIES (name, description, primary language), select the TOP 3 repos that would most strengthen this specific application, ranked from strongest fit to weakest.

Rules:
- Return AT MOST 3 repos, ranked 1 (best fit) to 3 (third best fit)
- If fewer than 3 repos are genuinely relevant, return fewer (do not force weak matches just to reach 3)
- If none are relevant, return an empty suggestions array
- Rank by how directly the repo demonstrates skills/technologies the job description asks for, not just general impressiveness

Return ONLY valid JSON, no preamble, no markdown fences, matching this schema:
{
  "suggestions": [
    { "name": "exact repo name from the list", "rank": 1, "reason": "short one-sentence explanation of why this is a strong fit for this specific job" }
  ]
}

JOB DESCRIPTION:
"""
${jdText}
"""

REPOSITORIES:
"""
${JSON.stringify(repos)}
"""`;

    // Try multiple models in order. Groq enforces separate daily token quotas per
    // model, so if the primary model is rate-limited we fall back to another rather
    // than failing the whole request. Only a 429 triggers a fallback; any other
    // error status throws immediately, same as before.
    const MODELS = ["llama-3.1-8b-instant", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"];

    let response;
    let lastErrBody;
    for (const model of MODELS) {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      });

      if (response.ok) break;

      lastErrBody = await response.text();
      console.error(`Groq API error ${response.status} on model ${model}:`, lastErrBody);

      if (response.status !== 429) {
        throw new Error(`Groq API returned ${response.status}`);
      }
      // 429 (rate limit) — try the next model
    }

    if (!response.ok) {
      throw new Error(`Groq API returned 429 for all models. Last error: ${lastErrBody}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error(`Failed to parse Groq response as JSON. Raw response:\n\`\`\`\n${content}\n\`\`\``);
      throw parseError;
    }

    const suggestions = parsed.suggestions || [];

    return {
      statusCode: 200,
      body: JSON.stringify({ suggestions })
    };
  } catch (error) {
    console.error("Error suggesting repos:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
