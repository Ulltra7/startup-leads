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
  return { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };
}

// Relevant early-stage round types
const EARLY_ROUNDS = new Set([
  "SEED",
  "PRE SEED",
  "EARLY VC",
  "SERIES A",
  "SERIES B",
  "ANGEL",
  "CONVERTIBLE",
]);

interface DealroomTransaction {
  id: number;
  round: string;
  amount: number | null;
  currency: string;
  year: number;
  month: number;
  company: {
    id: number;
    name: string;
    path: string;
    url: string;
  } | null;
}

interface DealroomCompany {
  id: number;
  name: string;
  tagline: string;
  url: string;
  website_url: string;
  hq_locations: any[];
  industries: any[];
  business_emails: string[];
  employees_latest: number;
  growth_stage: string;
  total_funding: number;
}

async function fetchRecentTransactions(): Promise<DealroomTransaction[]> {
  console.log("Fetching recent Swiss funding rounds from Dealroom...");

  // Get transactions from last 3 months
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const res = await fetch(`${BASE_URL}/transactions/bulk`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
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
    }),
  });

  const data = await res.json();
  if (data.error) {
    console.error("Dealroom API error:", data.message);
    return [];
  }

  const all: DealroomTransaction[] = data.items || [];
  // Filter to early-stage rounds only
  const filtered = all.filter((t) => EARLY_ROUNDS.has(t.round));
  console.log(
    `${all.length} total transactions, ${filtered.length} early-stage`,
  );
  return filtered;
}

async function enrichCompany(
  companyPath: string,
): Promise<DealroomCompany | null> {
  try {
    const res = await fetch(`${BASE_URL}/companies/bulk`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        limit: 1,
        fields:
          "id,name,tagline,url,website_url,hq_locations,industries,business_emails,employees_latest,growth_stage,total_funding",
        keyword: companyPath,
        keyword_type: "name",
        keyword_match_type: "exact",
      }),
    });
    const data = await res.json();
    return data.items?.[0] || null;
  } catch {
    return null;
  }
}

function scoreLead(
  company: DealroomCompany,
  round: string,
  amount: number | null,
): number {
  let score = 50;
  const text = (
    (company.tagline || "") +
    " " +
    (company.industries || []).map((i: any) => i.name).join(" ")
  ).toLowerCase();

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

  // Small team = needs external help
  const emp = company.employees_latest || 0;
  if (emp > 0 && emp <= 10) score += 15;
  else if (emp <= 30) score += 10;
  else if (emp <= 50) score += 5;
  else if (emp > 100) score -= 10;

  // Has funding amount = serious
  if (amount && amount > 0.5) score += 5;

  // Hardware/Biotech without software = less relevant
  if (
    /biotech|pharma|therapeutics|medical device/i.test(text) &&
    !/software|platform|saas|ai|data/i.test(text)
  )
    score -= 25;

  return Math.max(0, Math.min(100, score));
}

function guessIndustry(company: DealroomCompany): string {
  const industries = (company.industries || []).map(
    (i: any) => i.name?.toLowerCase() || "",
  );
  const text =
    industries.join(" ") + " " + (company.tagline || "").toLowerCase();
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
  return "other";
}

async function main() {
  const transactions = await fetchRecentTransactions();

  let inserted = 0;
  let enriched = 0;

  for (const tx of transactions) {
    if (!tx.company) continue;
    const name = tx.company.name;

    // Enrich with company details (rate limit: 1 req/sec)
    const company = await enrichCompany(tx.company.path || name);
    await new Promise((r) => setTimeout(r, 500));

    if (!company) {
      console.log(`  · ${name} - could not enrich`);
      continue;
    }
    enriched++;

    const score = scoreLead(company, tx.round, tx.amount);
    const industry = guessIndustry(company);

    // Extract location
    const hq = company.hq_locations?.[0];
    const city = hq?.city?.name || null;
    const country = hq?.country?.name || "Switzerland";
    const location = city ? `${city}, ${country}` : country;

    // Format funding amount
    const fundingStr = tx.amount
      ? `${tx.amount}M ${tx.currency}`
      : "undisclosed";

    const icon = score >= 70 ? "★" : score >= 50 ? "○" : "·";
    console.log(
      `  ${icon} [${score}] ${name} | ${fundingStr} | ${tx.round} | ${industry} | ${company.employees_latest || "?"} emp`,
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
          company.url || `https://app.dealroom.co/companies/${tx.company.path}`,
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

    // Get lead ID for contact linking
    const { data: leadRow } = await supabase
      .from("leads")
      .select("id")
      .eq("company_name", name)
      .eq("source", "dealroom")
      .single();

    // Insert business emails as contacts
    const emails = company.business_emails || [];
    if (leadRow) {
      for (const email of emails.slice(0, 3)) {
        const { error: cErr } = await supabase.from("lead_contacts").upsert(
          {
            lead_id: leadRow.id,
            name: email.split("@")[0].replace(/\./g, " "),
            email,
            source: "dealroom",
          },
          { onConflict: "email" },
        );
        if (cErr) {
          /* ignore duplicate */
        }
      }
    }
  }

  console.log(`\nDone: ${enriched} enriched, ${inserted} inserted/updated`);
}

main().catch(console.error);
