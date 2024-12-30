import axios from "axios";
import * as cheerio from "cheerio";
import { Logger } from "./logger";
import { Redis } from "@upstash/redis";

const logger = new Logger("scrapper");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CACHE_TTL = 7 * (24 * 60 * 60);
const MAX_CACHE_SIZE = 1024000;

export const urlPattern =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;

export const isUrlPattern = (str: string) => {
  const urlRegex =
    /\b((https?|ftp|file):\/\/|www\.)[-a-zA-Z0-9+&@#/%=~_|!:,.;]*[-a-zA-Z0-9+&@#/%=~_|]/i;
  return urlRegex.test(str);
};

export const cleanText = (str: string) => {
  return str.replace(/\s+/g, " ").replace(/\n+/g, "").trim();
};

export const scrapeUrl = async (url: string) => {
  try {
    logger.info(`Starting scrape process for: ${url}`);
    const cached = await getCachedContent(url);
    if (cached) {
      logger.info(`Using cached content for: ${url}`);
      return cached;
    }
    logger.info(`Cache miss - proceeding with fresh scrape for: ${url}`);

    const response = await axios.get(url);

    const $ = cheerio.load(response.data);

    // Remove script tags, style tags, and comments
    $("script").remove();
    $("style").remove();
    $("noscript").remove();
    $("iframe").remove();
    // Extract useful information
    const title = $("title").text();
    const metaDescription = $('meta[name="description"]').attr("content") || "";
    const h1 = $("h1")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const h2 = $("h2")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    // Get text from important elements
    const articleText = $("article")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const mainText = $("main")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const contentText = $('.content, #content, [class*="content"]')
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const paragraphs = $("p")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const listItems = $("li")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");

    let combinedContent = [
      title,
      metaDescription,
      h1,
      h2,
      articleText,
      mainText,
      contentText,
      paragraphs,
      listItems,
    ].join("");

    combinedContent = cleanText(combinedContent).slice(0, 10000);

    console.log(title, "url get scrapped response!");

    const final_respons = {
      url,
      title: cleanText(title),
      headings: {
        h1: cleanText(h1),
        h2: cleanText(h2),
      },
      metaDescription: cleanText(metaDescription),
      content: combinedContent,
      error: null,
    };

    await cacheContent(url, final_respons);

    return final_respons;
  } catch (error) {
    console.log("error in scrapping url", url);
    return {
      url,
      title: "",
      headings: {
        h1: "",
        h2: "",
      },
      metaDescription: "",
      content: "",
      error: "Error in scrapping URL",
    };
  }
};

function getCacheKey(url: string): string {
  console.log(url, "asdasdasdasda");

  const sanitizedUrl = url.substring(0, 200);
  return `scrape:${sanitizedUrl}`;
}

export interface ScrapedContent {
  url: string;
  title: string;
  headings: {
    h1: string;
    h2: string;
  };
  metaDescription: string;
  content: string;
  error: string | null;
  cachedAt?: number;
}
// Function to get cached content with error handling
async function getCachedContent(url: string): Promise<ScrapedContent | null> {
  try {
    const cacheKey = getCacheKey(url);
    logger.info(`Checking cache for key: ${cacheKey}`);
    const cached = await redis.get(cacheKey);

    if (!cached) {
      logger.info(`Cache miss - No cached content found for: ${url}`);
      return null;
    }
    logger.info(`Cache hit - Found cached content for: ${url}`);

    // Handle both string and object responses from Redis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    if (typeof cached === "string") {
      try {
        parsed = JSON.parse(cached);
      } catch (parseError) {
        logger.error("JSON parse error for cached content: ${parseError}");
        await redis.del(cacheKey);
        return null;
      }
    } else {
      parsed = cached;
    }

    if (isValidScrapedContent(parsed)) {
      const age = Date.now() - (parsed.cachedAt || 0);
      logger.info(`Cache content age: ${Math.round(age / 1000 / 60)} minutes`);
      return parsed;
    }
    logger.warn(`Invalid cached content format for URL: ${url}`);
    await redis.del(cacheKey);
    return null;
  } catch (error) {
    logger.error(`Cache retrieval error: ${error}`);
    return null;
  }
}

function isValidScrapedContent(data: any): data is ScrapedContent {
  return (
    typeof data == "object" &&
    data !== null &&
    typeof data.url === "string" &&
    typeof data.title === "string" &&
    typeof data.headings == "object" &&
    typeof data.headings.h1 === "string" &&
    typeof data.headings.h2 === "string" &&
    typeof data.metaDescription === "string" &&
    typeof data.content === "string" &&
    (data.error === null || typeof data.error === "string")
  );
}

async function cacheContent(
  url: string,
  content: ScrapedContent
): Promise<void> {
  try {
    const cacheKey = getCacheKey(url);
    content.cachedAt = Date.now();
    // Validate content before serializing
    if (!isValidScrapedContent(content)) {
      logger.error(`Attempted to cache invalid content format for URL: ${url}`);
      return;
    }
    const serialized = JSON.stringify(content);

    if (serialized.length > MAX_CACHE_SIZE) {
      logger.warn(
        `Content too large to cache for URL: ${url} (${serialized.length} bytes)`
      );
      return;
    }
    await redis.set(cacheKey, serialized, { ex: CACHE_TTL });
    logger.info(
      `sucessfully cached content for : ${url} (${serialized.length} bytes, TTL ${CACHE_TTL}s)`
    );
  } catch (error) {
    logger.error(`Cache storage error: ${error}`);
  }
}

// export async function saveConversation(id: string, messages: Message[]) {
//   try {
//     logger.info(`Saving conversation with ID: ${id}`);
//     await redis.set("conversation:${id}", JSON.stringify(messages));
//     // Set expiration to 7 days
//     await redis.expire("conversation:${id}", 7 * (24 * 60 * 60));
//     logger.info(`
// Successfully saved conversation ${id} with ${messages.length} messages`);
//   } catch (error) {
//     logger.error(`Failed to save conversation ${id}: ${error}`);
//     throw error;
//   }
// }

// export async function getConversation(id: string): Promise<Message[] | null> {
//   try {
//     logger.info(`Fetching conversation with ID: ${id}`);
//     const data = await redis.get(`conversation:${id}`);

//     if (!data) {
//       logger.info(`No conversation found for ID: ${id}`);
//       return null;
//     }
//     if (typeof data === "string") {
//       const messages = JSON.parse(data);
//       logger.info(`
// Successfully retrieved conversation ${id} with ${messages.length} messages`);
//       return messages;
//     }
//     logger.info(`Successfully retrieved conversation ${id}`);
//     return data as Message[];
//   } catch (error) {
//     logger.error(`Error getting messages: ${id} : ${error}`);
//     return null;
//   }
// }
