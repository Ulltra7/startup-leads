# Startup Leads

Lead-Generierung für Ulltra Software GmbH: Schweizer/DACH Startups mit frischem Funding finden und als potenzielle Kunden kontaktieren.

## Pitch

"Wir sind ein kleines Schweizer Dev-Team (React, TypeScript, Java, Python, Cloud). Wir bauen euch einen kostenlosen Prototypen in 2 Wochen, damit ihr seht ob wir zusammenpassen."

## Warum Startups mit Funding?

- Nach Funding müssen Startups schnell liefern (Investoren wollen Ergebnisse)
- Sie haben Geld aber oft noch kein Dev-Team
- CTO allein kann nicht alles bauen
- Kostenloser Prototyp entfernt jedes Risiko

## Pipeline

```
Täglich (Scheduled Agent):
1. Scrape Startupticker.ch Funding News
2. Filter: nur Tech/Software relevante Startups
3. Enrichment: Website, Gründer (Zefix), Kontakt
4. Score: Braucht die Firma externe Dev-Hilfe?
5. HubSpot: Deal anlegen mit Draft-Email

Manuell (Johannes):
6. Email/LinkedIn Outreach an Gründer
7. Erstgespräch → Prototyp-Angebot
```

## Datenquellen

- **Startupticker.ch** (Primär): Schweizer Startup Funding News, ~4 relevante Leads/Woche
- **Crunchbase/Dealroom** (Später): DACH-weite Funding Rounds
- **SIMAP** (Separat): Öffentliche IT-Ausschreibungen (bereits in ulltra/tenders/simap)

## Infrastruktur

- **Supabase**: Projekt `etteradhwhyjykbzgzgu`, Tabellen `leads`, `lead_contacts`
- **HubSpot**: Account 149144861, Pipeline "Sales", deal_category "sales"
- **Scheduled Agent**: Claude.ai Trigger, täglich

## Lead Scoring

Relevant = Startup braucht wahrscheinlich Software-Hilfe:

- Hat Software/Tech Produkt (SaaS, Platform, App) → Hoch
- Seed/Series A (frühes Stadium, baut noch) → Hoch
- HealthTech/FinTech/PropTech mit Tech-Kern → Hoch
- Hardware/Biotech/Pharma ohne Software-Bedarf → Niedrig
- Late Stage (Series C+, hat schon Team) → Niedrig

## Outreach

- **Absender**: johannes@ulltra-software.com (Ulltra Software, NICHT persönlich)
- **Sprache**: Deutsch für CH/DE/AT Startups, Englisch sonst
- **Kanal**: Email (primär), LinkedIn (follow-up)
- **Keine Dashes** in Emails (Firmenregel)
