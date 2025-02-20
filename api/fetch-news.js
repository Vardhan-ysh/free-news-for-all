// api/fetch-news.js
const axios = require("axios");
const { Octokit } = require("@octokit/rest");

const API_KEY = process.env.NEWS_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const REPO_NAME = process.env.GITHUB_REPO_NAME;

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
});

async function fetchNewsPage(page) {
  try {
    const response = await axios.get(`https://api.thenewsapi.com/v1/news/all`, {
      params: {
        api_token: API_KEY,
        language: "en",
        page: page,
        limit: 100,
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching page ${page}:`, error);
    return null;
  }
}

async function uploadToGithub(content, filename) {
  try {
    // Get the current date for the commit message
    const date = new Date().toISOString().split("T")[0];

    // Check if file exists and get its SHA if it does
    let fileSha;
    try {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: filename,
      });
      fileSha = data.sha;
    } catch (error) {
      // File doesn't exist yet, which is fine
    }

    // Create or update file
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: filename,
      message: `Update news data for ${date}`,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      sha: fileSha,
    });

    return true;
  } catch (error) {
    console.error("Error uploading to GitHub:", error);
    return false;
  }
}

module.exports = async (req, res) => {
  // Only allow scheduled POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify the request is from our scheduler
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const allNews = [];
  let page = 1;
  let hasMorePages = true;

  // Fetch all pages until we hit the API limit or run out of news
  while (hasMorePages && page <= 10) {
    // Limiting to 10 pages as an example
    const newsData = await fetchNewsPage(page);

    if (!newsData || !newsData.data || newsData.data.length === 0) {
      hasMorePages = false;
      break;
    }

    allNews.push(...newsData.data);
    page++;

    // Respect API rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (allNews.length > 0) {
    // Create filename with current date
    const date = new Date().toISOString().split("T")[0];
    const filename = `news/${date}.json`;

    // Upload to GitHub
    const success = await uploadToGithub(allNews, filename);

    if (success) {
      res.status(200).json({
        message: "News data updated successfully",
        articles: allNews.length,
      });
    } else {
      res.status(500).json({ error: "Failed to upload to GitHub" });
    }
  } else {
    res.status(500).json({ error: "Failed to fetch news data" });
  }
};
