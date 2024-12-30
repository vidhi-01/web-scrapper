// TODO: Implement the chat API with Groq and web scraping with Cheerio and Puppeteer
// Refer to the Next.js Docs on how to read the Request body: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
// Refer to the Groq SDK here on how to use an LLM: https://www.npmjs.com/package/groq-sdk
// Refer to the Cheerio docs here on how to parse HTML: https://cheerio.js.org/docs/basics/loading
// Refer to Puppeteer docs here: https://pptr.dev/guides/what-is-puppeteer

import { getGroqResponse } from "@/app/utils/groqClient";
import { scrapeUrl, urlPattern } from "@/app/utils/scraper";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { message, messages } = await req.json();

    console.log("Msg received: ", message);

    let scrappedContent = "";

    const url = message.match(urlPattern);
    if (url) {
      console.log("url found", url);

      const scrappedResponse = await scrapeUrl(url[0]);
      scrappedContent = scrappedResponse.content;
      // console.log("scrapped contetn", scrappedContent);
    }

    const userQuery = message.replace(url ? url[0] : "", "").trim();

    const userPrompt = `
      Respond to the user's query:
      "${userQuery}"

      Use the provided content as the basis for your response:
      <content>
      ${scrappedContent}
      </content>

      If a URL is provided, ensure the content is accurately cited with proper attribution:
      <url>
      ${url}
      </url>

      If no sufficient content is provided, politely ask the user for more relevant information or useful links to help craft the most detailed and accurate response. Always base your answers strictly on the given content when available, and properly cite any external references or links provided.
    `;

    let llmMessages = [
      ...messages,
      {
        role: "user",
        content: userPrompt,
      },
    ];

    const response = await getGroqResponse(llmMessages);

    return NextResponse.json({ message: response });
  } catch (error) {
    console.log(error);

    return NextResponse.json({ message: "Error" });
  }
}
