import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

const API_KEY = "4ab4e8050626b846f6d26b1f3fbb14fe4ca88729";
const BASE_URL = "https://api.dealroom.co/api/v1";

function getHeaders() {
  const auth = Buffer.from(`${API_KEY}:`).toString("base64");
  return {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };
}

const EARLY_ROUNDS = new Set([
  "SEED",
  "PRE SEED",
  "EARLY VC",
  "SERIES A",
  "SERIES B",
  "ANGEL",
  "CONVERTIBLE",
]);

async function fetchRecentTransactions(): Promise<any[]> {
  console.log("Fetching recent Swiss funding rounds from Dealroom...");

  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  let allItems: any[] = [];
  let nextPageId: string | null = null;

  // Paginate to get all results
  for (let page = 0; page < 5; page++) {
    const payload: any = {
      limit: 100,
      fields: "id,round,amount,currency,year,month,company",
      form_data: {
        must: {
          hq_locations: ["Switzerland"],
          year_min: threeMonthsAgo.getFullYear(),
          month_min: threeMonthsAgo.getMonth() + 1,
        },
      },
      sort: "-date",
    };
    if (nextPageId) payload.next_page_id = nextPageId;

    const res = await fetch(`${BASE_URL}/transactions/bulk`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.error) {
      console.error("Dealroom API error:", data.message);
      break;
    }

    allItems.push(...(data.items || []));
    nextPageId = data.next_page_id;
    if (!nextPageId || (data.items || []).length < 100) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Filter to early-stage rounds
  const filtered = allItems.filter((t) => EARLY_ROUNDS.has(t.round));
  console.log(
    `${allItems.length} total transactions, ${filtered.length} early-stage`,
  );
  return filtered;
}

function scoreLead(company: any, round: string, amount: number | null): number {
  let score = 50;
  const tagline = (company.tagline || "").toLowerCase();
  const industries = (company.industries || [])
    .map((i: any) => i.name || "")
    .join(" ")
    .toLowerCase();
  const text = tagline + " " + industries;

  // Software/Tech = high relevance
  if (
    /software|saas|platform|app\b|ai\b|machine learning|api|cloud|data/i.test(
      text,
    )
  )
    score += 20;
  if (/fintech|healthtech|proptech|edtech|insurtech/i.test(text)) score += 15;
  if (/enterprise software|developer tools/i.test(text)) score += 10;

  // Early stage = needs to build
  if (/seed|pre.seed/i.test(round)) score += 15;
  if (/series a/i.test(round)) score += 10;
  if (/angel/i.test(round)) score += 10;

  // Growth stage from Dealroom
  const stage = (company.growth_stage || "").toLowerCase();
  if (stage.includes("early")) score += 10;
  if (stage.includes("late") || stage.includes("mature")) score -= 15;

  // Has funding amount = serious
  if (amount && amount > 0.5) score += 5;
  if (amount && amount > 5) score += 5;

  // Hardware/Biotech without software = less relevant
  if (
    /biotech|pharma|therapeutics|medical device/i.test(text) &&
    !/software|platform|saas|ai|data/i.test(text)
  )
    score -= 25;

  return Math.max(0, Math.min(100, score));
}

function guessIndustry(company: any): string {
  const text =
    (company.industries || [])
      .map((i: any) => (i.name || "").toLowerCase())
      .join(" ") +
    " " +
    (company.tagline || "").toLowerCase();
  if (/fintech|banking|payment|trading|crypto/i.test(text)) return "fintech";
  if (/health|medical|pharma|biotech|diagnostics/i.test(text))
    return "healthtech";
  if (/property|real estate|building|construction/i.test(text))
    return "proptech";
  if (/artificial intelligence|machine learning/i.test(text)) return "ai";
  if (/enterprise software|developer tools/i.test(text)) return "software";
  if (/education|learning/i.test(text)) return "edtech";
  if (/energy|solar|clean|climate/i.test(text)) return "cleantech";
  if (/food|agri/i.test(text)) return "foodtech";
  if (/security|cyber/i.test(text)) return "cybersecurity";
  if (/robotics/i.test(text)) return "robotics";
  if (/gaming|games/i.test(text)) return "gaming";
  return "other";
}

async function main() {
  const transactions = await fetchRecentTransactions();

  let inserted = 0;

  for (const tx of transactions) {
    const company = tx.company;
    if (!company) continue;

    const name = company.name;
    const score = scoreLead(company, tx.round, tx.amount);
    const industry = guessIndustry(company);

    // Extract location
    const hq = (company.hq_locations || [])[0];
    const city = hq?.city?.name || hq?.state?.name || null;
    const country = hq?.country?.name || "Switzerland";
    const location = city ? `${city}, ${country}` : country;

    // Format funding amount
    const fundingStr = tx.amount
      ? `${tx.amount}M ${tx.currency}`
      : "undisclosed";

    const icon = score >= 70 ? "★" : score >= 50 ? "○" : "·";
    console.log(
      `  ${icon} [${score}] ${name} | ${fundingStr} | ${tx.round} | ${industry} | ${location}`,
    );

    // Upsert lead
    const { error } = await supabase.from("leads").upsert(
      {
        company_name: name,
        website: company.website_url || null,
        location,
        funding_amount: fundingStr,
        funding_round: tx.round,
        funding_date: `${tx.year}-${String(tx.month).padStart(2, "0")}-01`,
        description: company.tagline || null,
        industry,
        source: "dealroom",
        source_url:
          company.url || `https://app.dealroom.co/companies/${company.path}`,
        score,
        status: "new",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_name,source" },
    );

    if (error) {
      console.error(`  Error: ${name}: ${error.message}`);
      continue;
    }
    inserted++;
  }

  console.log(`\nDone: ${inserted} leads inserted/updated`);
}

main().catch(console.error);
