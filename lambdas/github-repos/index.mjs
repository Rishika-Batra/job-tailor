export const handler = async (event) => {
  try {
    const username = event.queryStringParameters?.username;
    
    if (!username) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing username parameter" })
      };
    }
    
    const githubUrl = `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=30`;

    async function fetchWithRetry(url, options, retries = 2, delayMs = 500) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await fetch(url, options);
        } catch (err) {
          console.error(`Fetch attempt ${attempt} failed:`, err.message);
          if (attempt === retries) throw err;
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    const response = await fetchWithRetry(githubUrl, {
      headers: {
        'User-Agent': 'job-tailor-app'
      }
    });
    
    if (response.status === 404) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "GitHub user not found" })
      };
    }
    
    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    const repos = data
      .filter(repo => !repo.fork)
      .map(repo => ({
        name: repo.name,
        description: repo.description,
        language: repo.language,
        stars: repo.stargazers_count,
        url: repo.html_url,
        updatedAt: repo.updated_at
      }))
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 20);
      
    return {
      statusCode: 200,
      body: JSON.stringify({ repos })
    };
  } catch (error) {
    console.error("Error fetching github repos:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
