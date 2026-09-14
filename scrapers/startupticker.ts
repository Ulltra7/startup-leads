import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BASE_URL = "https://www.startupticker.ch";
const NEWS_URL = `${BASE_URL}/en/news`;

interface FundingItem {
  company_name: string;
  funding_amount: string | null;
  funding_round: string | null;
  funding_date: string | null;
  description: string;
  source_url: string;
  categories: string[];
}

async function scrapeStartupticker(): Promise<FundingItem[]> {
  console.log("Fetching Startupticker news...");
  const res = await fetch(NEWS_URL);
  const html = await res.text();

  const items: FundingItem[] = [];
  // Parse each news item
  const itemRegex =
    /<div class="item (?:sponsored )?news">\s*<a href="([^"]+)">\s*<div class="item-content">[\s\S]*?<h2>(.*?)<\/h2>[\s\S]*?<div class="published-date">(.*?)<\/div>[\s\S]*?<div class="item-intro">\s*<p>([\s\S]*?)<\/p>[\s\S]*?<\/div>[\s\S]*?<div class="item-column-top">([\s\S]*?)<\/div>\s*<\/div>/g;

  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const [, url, title, dateStr, intro, categoryHtml] = match;

    // Extract categories
    const categories: string[] = [];
    const catRegex = /category=(\w+)/g;
    let catMatch;
    while ((catMatch = catRegex.exec(categoryHtml)) !== null) {
      categories.push(catMatch[1]);
    }

    // Only keep financing/funding items
    if (!categories.includes("Financing")) continue;

    // Parse funding amount from title or intro
    const amountMatch = (title + " " + intro).match(
      /(?:CHF|EUR|€|\$|USD)\s*[\d.,]+\s*(?:M|m|million|bn|B)?|[\d.,]+\s*(?:M|m|million|bn|B)\s*(?:CHF|EUR|€|\$|USD)/i,
    );

    // Parse round type
    const roundMatch = (title + " " + intro).match(
      /(?:pre-seed|seed|series\s*[A-D]|growth|bridge|angel|venture kick)/i,
    );

    // Parse date
    const dateParts = dateStr.trim().match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const fundingDate = dateParts
      ? `${dateParts[3]}-${dateParts[2]}-${dateParts[1]}`
      : null;

    // Extract company name from title (remove funding amount text)
    let companyName = title
      .replace(
        /secures?|raises?|closes?|receives?|lands?|gets?|announces?/gi,
        "|",
      )
      .split("|")[0]
      .trim();
    // Clean up common patterns
    companyName = companyName
      .replace(/^Following.*?,\s*/i, "")
      .replace(/^Swiss\s+/i, "")
      .replace(/^\w+\s+company\s+/i, "")
      .replace(/^\w+\s+startup\s+/i, "")
      .trim();

    // If company name extraction failed, use first capitalized words
    if (companyName.length > 60 || companyName.length < 2) {
      const words = title.split(/\s+/);
      companyName = words
        .filter((w) => /^[A-Z]/.test(w) && w.length > 1)
        .slice(0, 3)
        .join(" ");
    }

    // Clean HTML from intro
    const description = intro.replace(/<[^>]+>/g, "").trim();

    items.push({
      company_name: companyName,
      funding_amount: amountMatch ? amountMatch[0].trim() : null,
      funding_round: roundMatch ? roundMatch[0].trim() : null,
      funding_date: fundingDate,
      description,
      source_url: `${BASE_URL}${url}`,
      categories,
    });
  }

  console.log(`Found ${items.length} funding items`);
  return items;
}

function scoreLead(item: FundingItem): number {
  let score = 50; // base
  const text = (item.description + " " + item.company_name).toLowerCase();

  // Software/Tech product = high relevance
  if (
    /software|saas|platform|app\b|ai\b|machine learning|api|cloud/i.test(text)
  )
    score += 20;
  if (/fintech|healthtech|proptech|edtech|insurtech/i.test(text)) score += 15;
  if (/data|analytics|automation|digital/i.test(text)) score += 10;

  // Early stage = needs to build
  const round = (item.funding_round || "").toLowerCase();
  if (round.includes("seed") || round.includes("pre-seed")) score += 15;
  if (round.includes("series a")) score += 10;
  if (round.includes("series b")) score += 5;

  // Swiss location = easier to reach
  if (
    /zurich|zürich|zug|luzern|lucerne|bern|basel|geneva|genf|lausanne|switzerland|swiss/i.test(
      text,
    )
  )
    score += 10;

  // Hardware/Biotech/Pharma without software = low relevance
  if (
    /biotech|pharma|therapeutics|clinical|medical device|hardware/i.test(
      text,
    ) &&
    !/software|platform|saas|ai/i.test(text)
  )
    score -= 25;

  // Pure grants/small amounts = less interesting
  if (/venture kick|CHF\s*(?:50|100|150),?000/i.test(item.funding_amount || ""))
    score -= 15;

  return Math.max(0, Math.min(100, score));
}

function guessIndustry(item: FundingItem): string {
  const text = (item.description + " " + item.company_name).toLowerCase();
  if (/fintech|banking|payment|trading|crypto|bitcoin/i.test(text))
    return "fintech";
  if (/health|medical|pharma|biotech|diagnostics|therapeutics/i.test(text))
    return "healthtech";
  if (/property|real estate|building|construction/i.test(text))
    return "proptech";
  if (/ai\b|machine learning|artificial intelligence|llm/i.test(text))
    return "ai";
  if (/education|learning|university|student/i.test(text)) return "edtech";
  if (/energy|solar|clean|climate|sustainability/i.test(text))
    return "cleantech";
  if (/food|agri|farm/i.test(text)) return "foodtech";
  if (/insur/i.test(text)) return "insurtech";
  if (/security|cyber/i.test(text)) return "cybersecurity";
  return "other";
}

async function insertLeads(
  items: FundingItem[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    const score = scoreLead(item);
    const industry = guessIndustry(item);

    const { error } = await supabase.from("leads").upsert(
      {
        company_name: item.company_name,
        website: null,
        location: null,
        funding_amount: item.funding_amount,
        funding_round: item.funding_round,
        funding_date: item.funding_date,
        description: item.description,
        industry,
        source: "startupticker",
        source_url: item.source_url,
        score,
        status: "new",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_name,source" },
    );

    if (error) {
      console.error(`Error inserting ${item.company_name}:`, error.message);
    } else {
      inserted++;
    }
  }

  return { inserted, skipped };
}

async function main() {
  const items = await scrapeStartupticker();

  // Log summary
  for (const item of items) {
    const score = scoreLead(item);
    const industry = guessIndustry(item);
    console.log(
      `  ${score >= 70 ? "★" : score >= 50 ? "○" : "·"} [${score}] ${item.company_name} | ${item.funding_amount || "?"} ${item.funding_round || ""} | ${industry}`,
    );
  }

  const result = await insertLeads(items);
  console.log(`\nInserted: ${result.inserted}, Skipped: ${result.skipped}`);
}

main().catch(console.error);
