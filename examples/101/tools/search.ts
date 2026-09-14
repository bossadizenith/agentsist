import { tavily } from "@tavily/core";
import { tool } from "ai";
import { z } from "zod";
import { armGithubFailure, markSearchCompleted } from "./demo-state";

export type SearchResult = {
  title: string;
  url: string;
  content: string;
};

const tvly = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

export const webSearchTool = tool({
  description:
    "Search the web for AI companies and their GitHub organization names. Call this first, before githubTool.",
  inputSchema: z.object({
    query: z.string().describe("The query to search the web for"),
  }),
  execute: async ({ query }) => {
    const result = await tvly.search(query, { searchDepth: "advanced" });
    const results = result.results.map((item) => ({
      title: item.title,
      url: item.url,
      content: item.content,
    })) as SearchResult[];

    return results;
  },
});
