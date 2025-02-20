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
    const date = new Date().toISOString().split("T")[0];

    // Get existing content if any
    let existingContent = [];
    try {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: filename,
      });
      existingContent = JSON.parse(Buffer.from(data.sha, "base64").toString());
    } catch (error) {
      // File doesn't exist yet, which is fine
    }

    // Merge new content with existing content
    const mergedContent = [...existingContent, ...content];

    // Create or update file
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: filename,
      message: `Update news data for ${date} - Page ${
        content[0]?.page || "unknown"
      }`,
      content: Buffer.from(JSON.stringify(mergedContent, null, 2)).toString(
        "base64"
      ),
      ...(existingContent.length > 0 ? { sha: data.sha } : {}),
    });

    return true;
  } catch (error) {
    console.error("Error uploading to GitHub:", error);
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // We'll only fetch 2 pages per execution to stay within the time limit
  const currentPage = parseInt(req.query.page) || 1;
  const newsData = await fetchNewsPage(currentPage);

  if (!newsData || !newsData.data || newsData.data.length === 0) {
    return res.status(200).json({ message: "No more data to fetch" });
  }

  // Create filename with current date
  const date = new Date().toISOString().split("T")[0];
  const filename = `news/${date}.json`;

  // Upload to GitHub
  const success = await uploadToGithub(newsData.data, filename);

  if (success) {
    // If there might be more pages, trigger the next page fetch
    if (newsData.meta && newsData.meta.found > currentPage * 100) {
      try {
        // Trigger next page fetch
        await axios.post(
          `${req.headers.origin}/api/fetch-news?page=${currentPage + 1}`,
          {},
          {
            headers: {
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
          }
        );
      } catch (error) {
        console.error("Error triggering next page:", error);
      }
    }

    res.status(200).json({
      message: "News data updated successfully",
      page: currentPage,
      articles: newsData.data.length,
    });
  } else {
    res.status(500).json({ error: "Failed to upload to GitHub" });
  }
};
