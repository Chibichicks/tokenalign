#!/usr/bin/env node
/**
 * SG Tax Job Extraction Script
 * 
 * A deterministic Playwright-based extraction script for Singapore tax jobs.
 * Sources:
 *   1. MyCareersFuture.gov.sg (primary, 113+ tax jobs, no auth required)
 *   2. LinkedIn (secondary, browser-based extraction with real job IDs)
 * 
 * Usage:
 *   node sg-tax-job-extract.js [options]
 * 
 * Options:
 *   --force              Force LinkedIn extraction even if known IDs >= 10
 *   --linkedin           Run LinkedIn extraction (default: only if state has < 10 known IDs)
 *   --mcf-only           Only extract from MyCareersFuture (skip LinkedIn entirely)
 *   --max-pages N        Max search result pages to extract from MCF (default: 3)
 *   --scroll-count N      Max LinkedIn infinite-scroll iterations (default: 3, overridden by --force)
 *   --state-file         Path to the state JSON file
 *   --output-dir         Output directory for job results
 *   --markdown           Output Discord-ready markdown report instead of JSON
 *   --update-tracking    Update the persistent Obsidian tracking table (implies --markdown)
 *   --tracking-file      Path to the master tracking markdown file
 *   --verbose            Print detailed extraction info
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Redirect ALL console.log to stderr to prevent stdout pollution for cron delivery
// (cron captures stdout for Discord; stderr goes to logs only)
console.log = console.error;

// ─── Configuration ───────────────────────────────────────────────────────────

let stateFilePath = path.resolve('/home/lucas/.hermes/cron/job_search_state.json');
let outputDir = path.resolve('/home/lucas/.hermes/reports');
let trackingFilePath = path.resolve('/home/lucas/documents/job_search/SG tax job search.md');
let databasePath = path.resolve('/home/lucas/.hermes/jobs_database.jsonl');

const MCF_JOB_URL_PREFIX = 'https://www.mycareersfuture.gov.sg/job/';

// Multiple LinkedIn search keyword variations to maximize coverage.
const LINKEDIN_SEARCH_QUERIES = [
  { keywords: 'tax', label: 'tax' },
  { keywords: 'tax+manager', label: 'tax manager' },
  { keywords: 'tax+director', label: 'tax director' },
  { keywords: 'corporate+tax', label: 'corporate tax' },
  { keywords: 'indirect+tax', label: 'indirect tax' },
  { keywords: 'transfer+pricing', label: 'transfer pricing' },
  { keywords: 'taxation', label: 'taxation' },
  { keywords: 'GST', label: 'GST' },
  { keywords: 'tax+compliance', label: 'tax compliance' },
  { keywords: 'international+tax', label: 'international tax' },
];

const KNOWN_LINKEDIN_JOB_IDS = [
  { id: '4412285357', company: 'Hudson Singapore', title: 'Tax Director' },
  { id: '4408644054', company: 'LVMH Fashion Group', title: 'Tax Manager' },
  { id: '4140697828', company: 'RSM Singapore', title: 'Associate Corporate Tax' },
  { id: '4409799585', company: 'Baker McKenzie', title: 'Junior Associate Tax' },
  { id: '4413255912', company: 'Louis Vuitton', title: 'Indirect Tax Specialist' },
];

// ─── URL Slug Helper ────────────────────────────────────────────────────────

function buildSlug(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── TAX KEYWORD FILTER ───────────────────────────────────────────────────────

const TAX_KEYWORDS = ['tax', 'taxation', 'gst', 'vat', 'beps', 'transfer pricing', 'indirect tax', 'corporate tax', 'international tax'];
const EXCLUDE_KEYWORDS = ['taxi', 'taxonomy', 'taxidermy', 'syntax'];

function isTaxRelevant(title, company) {
  const text = ((title || '') + ' ' + (company || '')).toLowerCase();
  const hasTax = TAX_KEYWORDS.some(k => {
    const regex = new RegExp('\\b' + k.replace(/\s+/g, '\\s+') + '\\b', 'i');
    return regex.test(text);
  });
  if (!hasTax) return false;
  const hasExclude = EXCLUDE_KEYWORDS.some(k => {
    const regex = new RegExp('\\b' + k + '\\b', 'i');
    return regex.test(text);
  });
  return !hasExclude;
}

// ─── Industry Classification ─────────────────────────────────────────────────

function classifyIndustry(company) {
  const c = (company || '').toLowerCase();
  const map = [
    { keywords: ['bank', 'dbs', 'ocbc', 'uob', 'hsbc', 'citibank', 'nomura', 'goldman sachs', 'j.p. morgan', 'morgan stanley', 'ing '], industry: 'Banking & Finance' },
    { keywords: ['pwc', 'kpmg', 'deloitte', 'ey', 'rsm', 'forvis', 'randstad', 'hudson', 'rgf', 'acca', 'baker mckenzie', 'allen & gledhill'], industry: 'Professional Services' },
    { keywords: ['lvmh', 'louis vuitton', 'dior', 'fendi', 'gucci', 'prada', 'hermes'], industry: 'Luxury Goods' },
    { keywords: ['temasek', 'gic', 'schroders', 'blackrock', 'vanguard', 'fidelity'], industry: 'Financial Services' },
    { keywords: ['apple', 'microsoft', 'google', 'amazon', 'meta', 'byte', 'oracle', 'salesforce', 'adobe', 'reolink', 'aiper', 'oppo'], industry: 'Technology' },
    { keywords: ['exxonmobil', 'shell', 'bp', 'chevron', 'total'], industry: 'Oil & Gas' },
    { keywords: ['singapore airlines', 'scoot'], industry: 'Aviation' },
    { keywords: ['grab', 'gojek'], industry: 'Technology/Transportation' },
    { keywords: ['ntuc', 'fairprice'], industry: 'Retail/Cooperative' },
    { keywords: ['straitsx', 'dayone', 'coins', 'circle'], industry: 'Financial Technology' },
    { keywords: ['marina bay sands', 'genting', 'resorts world'], industry: 'Hospitality/Entertainment' },
    { keywords: ['dyson', 'versalis', 'stamford land', 'far east organization'], industry: 'Real Estate/Manufacturing' },
    { keywords: ['swire', 'coca-cola'], industry: 'Beverages/Consumer' },
    { keywords: ['micron', 'applied materials', 'asml', 'ams'], industry: 'Semiconductor/Technology' },
  ];
  for (const entry of map) {
    if (entry.keywords.some(k => c.includes(k))) return entry.industry;
  }
  return 'Corporate / Other';
}

// ─── State Management ────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
      if (!state || typeof state !== 'object') {
        throw new Error('State file parsed to non-object');
      }
      return state;
    }
  } catch (e) {
    console.error(`FATAL: Corrupted state file at ${stateFilePath}: ${e.message}`);
    throw e;
  }
  return {
    version: 1,
    known_linkedin_jobs: KNOWN_LINKEDIN_JOB_IDS.map(j => ({ ...j, last_verified: null, times_failed: 0 })),
    reported_urls: [],
    last_mcf_count: 0,
    consecutive_zero_mcf: 0,
    last_run_at: null,
  };
}

function saveState(state) {
  const dir = path.dirname(stateFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.last_run_at = new Date().toISOString();
  // Atomic write with unique UUID suffix to prevent race conditions
  const tmpPath = stateFilePath + '.tmp.' + crypto.randomUUID();
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, stateFilePath);
  return state;
}

// ─── Dashboard Content Sanitization ──────────────────────────────────────────

function sanitizeDashboardText(text) {
  return (text || '')
    .replace(/<!--/g, '')
    .replace(/-->/g, '')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\|/g, '/')
    .replace(/</g, '‹')
    .replace(/>/g, '›');
}

// ─── JSONL Database Management ───────────────────────────────────────────────

function appendToDatabase(jobs, dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const lines = jobs.map(j => JSON.stringify({
    url: j.url || '',
    title: j.title || '',
    company: j.company || '',
    source: j.source || '',
    date_found: j.date_identified || new Date().toISOString().split('T')[0],
    date_posted: j.posted_date || '',
  }));
  
  if (lines.length > 0) {
    fs.appendFileSync(dbPath, lines.join('\n') + '\n', 'utf-8');
  }
}

function loadDatabaseUrls(dbPath) {
  const urls = new Set();
  try {
    if (fs.existsSync(dbPath)) {
      const content = fs.readFileSync(dbPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.url) urls.add(normalizeUrl(entry.url));
        } catch {}
      }
    }
  } catch (e) {
    console.error('[DB] Error reading database:', e.message);
  }
  return urls;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

// ─── Dashboard Management (Prepend-Only Marker Injection) ───────────────────

const INBOX_START = '<!-- HERMES_INBOX_START -->';
const INBOX_END = '<!-- HERMES_INBOX_END -->';

function extractAllUrlsFromDashboard(content) {
  const urls = new Set();
  const regex = /\[.*?\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    urls.add(normalizeUrl(match[1]));
  }
  return urls;
}

function updateDashboard(newJobs, dateFound) {
  const dir = path.dirname(trackingFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  let content = '';
  if (fs.existsSync(trackingFilePath)) {
    content = fs.readFileSync(trackingFilePath, 'utf-8');
  }
  
  // Ensure dashboard has the required structure
  if (!content.includes(INBOX_START) || !content.includes(INBOX_END)) {
    content = buildDashboardTemplate(content);
  }
  
  // Collect all known URLs: database + dashboard
  const dbUrls = loadDatabaseUrls(databasePath);
  const dashboardUrls = extractAllUrlsFromDashboard(content);
  const allKnownUrls = new Set([...dbUrls, ...dashboardUrls]);
  
  // Find genuinely new jobs
  const trulyNew = newJobs.filter(j => {
    if (!j.url) return false;
    const norm = normalizeUrl(j.url);
    return !allKnownUrls.has(norm);
  });
  
  if (trulyNew.length === 0) {
    return { newCount: 0 };
  }
  
  // Build new inbox lines — use dateFound (not posted_date) so auto-archive logic is correct.
  // Company names use [[wiki-links]] for GBrain knowledge graph compatibility.
  const newLines = trulyNew.map(j => {
    const company = sanitizeDashboardText(j.company || 'N/A');
    const title = sanitizeDashboardText(j.title || 'N/A');
    return `- [ ] **NEW** [[${company}]] · ${title} · [Apply](${j.url}) · \`${dateFound}\` · \`New\` · \`\``;
  });
  
  // Extract positions of markers
  const startIdx = content.indexOf(INBOX_START);
  const endIdx = content.indexOf(INBOX_END);
  
  if (startIdx < 0 || endIdx < 0) {
    console.error('[DASHBOARD] Markers missing after template rebuild — aborting update');
    return { newCount: 0 };
  }
  
  // Extract existing inbox content (between markers)
  const existingInboxContent = content.slice(startIdx + INBOX_START.length, endIdx);
  
  // Auto-archive: move checked items older than 7 days to archive section
  // Also archive unchecked items older than 30 days (prevents infinite growth)
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const checkedCutoff = sevenDaysAgo.toISOString().split('T')[0];
  const uncheckedCutoff = thirtyDaysAgo.toISOString().split('T')[0];
  
  let keptInboxLines = [];
  let archivedLines = [];
  
  const existingLines = existingInboxContent.split('\n');
  for (const line of existingLines) {
    const trimmed = line.trim();
    if (!trimmed) { keptInboxLines.push(line); continue; }
    
    const isChecked = /^- \[x\]/.test(trimmed);
    const isUnchecked = /^- \[ \]/.test(trimmed);
    const dateMatch = trimmed.match(/`(\d{4}-\d{2}-\d{2})`/);
    
    // Checked items: archive if older than 7 days
    if (isChecked && dateMatch && dateMatch[1] < checkedCutoff) {
      archivedLines.push(trimmed);
    }
    // Unchecked items: archive if older than 30 days (prevent infinite growth)
    else if (isUnchecked && dateMatch && dateMatch[1] < uncheckedCutoff) {
      archivedLines.push(trimmed);
    } else {
      keptInboxLines.push(line);
    }
  }
  
  // Build new content: before markers + new items + existing kept items + after markers
  let newInbox = '\n';
  if (newLines.length > 0) {
    newInbox += newLines.join('\n') + '\n';
  }
  if (keptInboxLines.length > 0) {
    newInbox += keptInboxLines.join('\n') + '\n';
  }
  
  let newContent = content.slice(0, startIdx + INBOX_START.length) + newInbox + content.slice(endIdx);
  
  // If items were archived, append them to the end of the file
  if (archivedLines.length > 0) {
    const archiveHeader = `\n\n## 🗄️ Auto-Archived (checked >7d, ignored >30d)\n<details>\n<summary>${archivedLines.length} items</summary>\n\n`;
    newContent = newContent.trimEnd() + archiveHeader + archivedLines.join('\n') + '\n\n</details>\n';
  }
  
  // Update frontmatter
  newContent = updateFrontmatter(newContent, dateFound, trulyNew.length);
  
  // Atomic write: temp file in same directory, then rename
  const tmpPath = trackingFilePath + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmpPath, newContent, 'utf-8');
  fs.renameSync(tmpPath, trackingFilePath);
  
  // Append to database with dateFound
  appendToDatabase(trulyNew.map(j => ({ ...j, date_identified: dateFound })), databasePath);
  
  return { newCount: trulyNew.length };
}

function buildDashboardTemplate(existingContent) {
  // If there's existing content without markers, preserve it below the dashboard
  let preservedContent = '';
  if (existingContent && existingContent.trim()) {
    preservedContent = '\n\n---\n\n## 📋 Legacy (Preserved)\n\n' + existingContent;
  }
  
  return `---
database: ~/.hermes/jobs_database.jsonl
type: job-tracker
tags: [tax, jobs, singapore, sg-tax]
last_updated: ${new Date().toISOString()}
total_new_this_run: 0
---
# SG Tax Job Search

## 📥 Inbox
<!-- HERMES_INBOX_START -->
<!-- HERMES_INBOX_END -->

---

## 🎯 My Pipeline
_Script never modifies this section._

### 📝 Shortlisted

### ✅ Applied / Interviewing

### 🛑 Declined
${preservedContent}`;
}

function updateFrontmatter(content, dateFound, newCount) {
  const now = new Date().toISOString();
  
  // Update last_updated
  content = content.replace(/^last_updated:.*$/m, `last_updated: ${now}`);
  
  // Update total_new_this_run
  if (/^total_new_this_run:/m.test(content)) {
    content = content.replace(/^total_new_this_run:.*$/m, `total_new_this_run: ${newCount}`);
  }
  
  // Ensure GBrain-compatible frontmatter fields exist
  if (!/^type:/m.test(content)) {
    content = content.replace(/^---\n/, `---\ntype: job-tracker\n`);
  }
  if (!/^tags:/m.test(content)) {
    content = content.replace(/^type: job-tracker\n/, `type: job-tracker\ntags: [tax, jobs, singapore, sg-tax]\n`);
  }
  
  return content;
}

// ─── MyCareersFuture Extraction (REST API) ───────────────────────────────────

async function extractMCFJobs(_browser, maxPages, verbose) {
  // _browser is unused — MCF extraction now uses the REST API instead of DOM scraping.
  // Kept in signature for backward compatibility with main().
  const allJobs = [];
  const seenUuids = new Set();
  
  try {
    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const apiUrl = `https://api.mycareersfuture.gov.sg/v2/jobs?search=tax&page=${pageNum}&limit=20&salary=0`;
      if (verbose) console.error(`[MCF] Fetching API page ${pageNum}: ${apiUrl}`);
      
      const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Hermes/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      
      if (!resp.ok) {
        if (verbose) console.error(`[MCF] API returned ${resp.status}`);
        break;
      }
      
      const data = await resp.json();
      const results = data.results || [];
      
      if (verbose) console.error(`[MCF] Page ${pageNum}: ${results.length} results`);
      
      if (results.length === 0) break;
      
      for (const job of results) {
        const uuid = job.uuid;
        if (!uuid || seenUuids.has(uuid)) continue;
        seenUuids.add(uuid);
        
        const title = job.title || '';
        const hiringCo = job.hiringCompany || job.postedCompany || {};
        const company = hiringCo.name || '';
        
        if (!isTaxRelevant(title, company)) continue;
        
        const slug = buildSlug(title);
        const url = `${MCF_JOB_URL_PREFIX}${slug}-${uuid}`;
        const location = (job.address || {}).addressLine1 || '';
        const postedDate = job.postedAt || job.postedDate || '';
        
        allJobs.push({
          title,
          company,
          location,
          employment_type: job.employmentType || '',
          salary_min: (job.salary || {}).minimum || null,
          salary_max: (job.salary || {}).maximum || null,
          posted_date: postedDate,
          url,
          source: 'MyCareersFuture',
          validated: true,
        });
      }
      
      // Check if there's a next page
      const nextLink = (data._links || {}).next;
      if (!nextLink) break;
    }
  } catch (e) {
    if (verbose) console.error('[MCF] API extraction error:', e.message);
  }
  
  return allJobs;
}

// ─── LinkedIn Extraction ─────────────────────────────────────────────────────

function buildLinkedInUrl(jobId, title, company) {
  const slug = buildSlug(title);
  const companySlug = buildSlug(company);
  return `https://sg.linkedin.com/jobs/view/${slug}-at-${companySlug}-${jobId}`;
}

async function validateLinkedInUrl(page, url, verbose) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    const status = resp ? resp.status() : 0;
    const bodyText = await page.evaluate(() => document.body?.textContent?.slice(0, 300) || '');
    const is404 = status === 404 || bodyText.includes('Page not found') || bodyText.includes("page doesn't exist");
    return !is404;
  } catch {
    return false;
  }
}

async function extractLinkedInJobs(browser, state, flags) {
  const verbose = flags.verbose;
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  
  const results = [];
  const LINKEDIN_SCROLL_COUNT = flags.scrollCount ?? (flags.force ? 5 : 3);
  let linkedinStatus = 'blocked';

  try {
    let queriesToRun = [];
    if (flags.force) {
      queriesToRun = LINKEDIN_SEARCH_QUERIES;
    } else {
      queriesToRun = selectQueriesForHour(LINKEDIN_SEARCH_QUERIES, 3);
    }
    
    let allQueryJobs = [];
    let allAccessible = true;
    
    for (const query of queriesToRun) {
      const url = `https://sg.linkedin.com/jobs/search/?keywords=${query.keywords}&location=singapore&f_TPR=r604800`;
      if (verbose) console.error(`[LI] Navigating to query "${query.label}": ${url}`);
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(4000);
      
      const pageTitle = await page.title();
      const pageContent = await page.evaluate(() => document.body?.textContent?.slice(0, 500) || '');
      
      const isLoginWall = pageContent.includes('Sign in') && 
        (pageContent.includes('LinkedIn') || pageTitle.includes('LinkedIn'));
      
      if (isLoginWall) {
        if (verbose) console.error('[LI] LinkedIn sign-in wall detected');
        allAccessible = false;
        
        try {
          const dismissBtn = await page.$('button[aria-label="Dismiss"], .modal__dismiss, [data-tracking-control="public_profile__dismiss"]');
          if (dismissBtn) {
            await dismissBtn.click();
            await page.waitForTimeout(2000);
            if (verbose) console.error('[LI] Dismissed sign-in dialog');
          }
        } catch {}
        
        const afterDismissContent = await page.evaluate(() => document.body?.textContent?.slice(0, 500) || '');
        if (!afterDismissContent.includes('Sign in')) {
          allAccessible = true;
          const jobs = await extractLinkedInWithScroll(page, query.label, LINKEDIN_SCROLL_COUNT, verbose);
          allQueryJobs.push(...jobs);
        }
      } else {
        if (verbose) console.error(`[LI] LinkedIn accessible for query "${query.label}"`);
        const jobs = await extractLinkedInWithScroll(page, query.label, LINKEDIN_SCROLL_COUNT, verbose);
        allQueryJobs.push(...jobs);
      }
      
      await page.waitForTimeout(1500);
    }
    
    if (allAccessible) linkedinStatus = 'ok';
    results.push(...allQueryJobs);
    
    // Validate known LinkedIn URLs (cap at 10 per run to avoid timeout)
    const MAX_VALIDATIONS = 10;
    let validationCount = 0;
    if (linkedinStatus === 'ok') {
      for (const known of state.known_linkedin_jobs) {
        if (validationCount >= MAX_VALIDATIONS) break;
        const url = buildLinkedInUrl(known.id, known.title, known.company);
        const isValid = await validateLinkedInUrl(page, url, verbose);
        validationCount++;
        if (isValid) {
          known.last_verified = new Date().toISOString().split('T')[0];
          known.times_failed = Math.max(0, (known.times_failed || 0) - 1);
        } else {
          known.times_failed = (known.times_failed || 0) + 1;
          if (verbose) console.error(`[LI] URL validation failed for ${known.company} - ${known.title} (fail count: ${known.times_failed})`);
        }
      }
      
      // Prune jobs that failed validation 3+ times
      state.known_linkedin_jobs = state.known_linkedin_jobs.filter(k => (k.times_failed || 0) < 3);
    }    
    // Include known job IDs from state (age-based pruning runs in finally block)
    for (const known of state.known_linkedin_jobs) {
      const url = buildLinkedInUrl(known.id, known.title, known.company);
      if (!results.some(r => r.jobId === known.id || r.url === url)) {
        results.push({
          jobId: known.id,
          title: known.title,
          company: known.company,
          url,
          source: 'LinkedIn',
          validated: true,
          posted_date: known.last_verified || '',
          date_identified: known.last_verified || '',
        });
      }
    }
    
  } catch (e) {
    if (verbose) console.error('[LI] Extraction error:', e.message);
    linkedinStatus = 'blocked';
    for (const known of state.known_linkedin_jobs || []) {
      const url = buildLinkedInUrl(known.id, known.title, known.company);
      results.push({
        jobId: known.id,
        title: known.title,
        company: known.company,
        url,
        source: 'LinkedIn',
        validated: true,
        posted_date: known.last_verified || '',
      });
    }
  } finally {
    // Prune stale known_linkedin_jobs even on error — prevents unbounded growth
    // during extended LinkedIn outages. Hard cap at 100 to prevent validation timeout.
    if (state.known_linkedin_jobs && state.known_linkedin_jobs.length > 0) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoff = thirtyDaysAgo.toISOString().split('T')[0];
      state.known_linkedin_jobs = state.known_linkedin_jobs.filter(k => {
        if ((k.times_failed || 0) < 3 && !k.last_verified) return true;
        if (k.last_verified && k.last_verified >= cutoff) return true;
        return false;
      });
      // Hard cap: keep newest 100 if still exceeding after age prune
      if (state.known_linkedin_jobs.length > 100) {
        state.known_linkedin_jobs = state.known_linkedin_jobs.slice(-100);
      }
    }
    await page.close();
  }
  
  return { jobs: results, status: linkedinStatus };
}

function selectQueriesForHour(allQueries, count) {
  const hour = new Date().getHours();
  const result = [];
  for (let i = 0; i < count; i++) {
    const idx = (hour + i) % allQueries.length;
    result.push(allQueries[idx]);
  }
  return result;
}

async function extractLinkedInWithScroll(page, label, scrollCount, verbose) {
  const allJobs = [];
  const seenUrls = new Set();
  
  for (let scroll = 0; scroll < scrollCount; scroll++) {
    if (verbose) console.error(`[LI][${label}] Scroll ${scroll + 1}/${scrollCount}`);
    
    await page.waitForTimeout(2000);
    
    await page.evaluate(() => {
      const listContainer = document.querySelector('.jobs-search__results-list, .scaffold-layout__list-container, [class*="results-list"]');
      if (listContainer) {
        listContainer.scrollTop = listContainer.scrollHeight;
      } else {
        window.scrollBy(0, 800);
      }
    });
    
    await page.waitForTimeout(2500);
    
    const jobs = await extractLinkedInFromPage(page, verbose);
    
    for (const job of jobs) {
      const url = job.url || job.jobId;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        allJobs.push(job);
      }
    }
    
    if (verbose) console.error(`[LI][${label}] After scroll ${scroll + 1}: ${allJobs.length} unique tax jobs`);
  }
  
  return allJobs;
}

async function extractLinkedInFromPage(page, verbose) {
  const jobs = await page.evaluate(({keywords, excludes}) => {
    const results = [];
    // Multi-strategy job card detection — LinkedIn changes DOM classes frequently.
    // Try data attributes first (most stable), then semantic, then class-based fallbacks.
    const jobCards = document.querySelectorAll([
      '[data-job-id]',
      '[data-view-name="job-card"]',
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.job-search-card',
      '.base-search-card',
      'li.jobs-search-results__list-item',
      'article.job-card',
    ].join(', '));
    
    for (const card of jobCards) {
      const jobId = card.getAttribute('data-job-id') || 
        card.querySelector('[data-job-id]')?.getAttribute('data-job-id');
      const linkEl = card.querySelector('a[href*="/jobs/view"]');
      const href = linkEl ? linkEl.href : '';
      
      const titleEl = card.querySelector([
        '.job-card-list__title',
        '.job-card-search__title',
        '.job-title',
        '.base-search-card__title',
        '.artdeco-entity-lockup__title',
        'a[href*="/jobs/view"] span',
        '[class*="title"]',
      ].join(', '));
      const title = titleEl ? titleEl.textContent.trim() : '';
      
      const companyEl = card.querySelector([
        '.job-card-container__company-name',
        '.job-card-search__company-name',
        '.base-search-card__subtitle',
        '.artdeco-entity-lockup__subtitle',
        '[class*="company"]',
      ].join(', '));
      const company = companyEl ? companyEl.textContent.trim() : '';
      
// Filter: must be tax-relevant (word-boundary matching to avoid false positives like 'syntax')
      const text = (title + ' ' + company).toLowerCase();
      const hasTax = keywords.some(k => {
        const regex = new RegExp('\\b' + k.replace(/\s+/g, '\\s+') + '\\b', 'i');
        return regex.test(text);
      });
      if (!hasTax) continue;
      const hasExclude = excludes.some(k => {
        const regex = new RegExp('\\b' + k + '\\b', 'i');
        return regex.test(text);
      });
      if (hasExclude) continue;
      
      const locationEl = card.querySelector([
        '.job-card-container__metadata-item',
        '.job-card-search__location',
        '.base-search-card__metadata',
        '.artdeco-entity-lockup__caption',
        '[class*="location"]',
      ].join(', '));
      const location = locationEl ? locationEl.textContent.trim() : '';
      
      const dateEl = card.querySelector([
        '.job-card-container__listed-state',
        '.job-card-search__listed-state',
        'time.job-card-container__footer-item',
        'time',
        '[class*="date"]',
        '[class*="time"]',
      ].join(', '));
      const postedDate = dateEl ? (dateEl.textContent.trim() || dateEl.getAttribute('datetime') || '') : '';
      
      if (title && (jobId || href)) {
        const url = href || (jobId ? `https://sg.linkedin.com/jobs/view/${jobId}` : '');
        results.push({
          jobId: jobId || (href.match(/-(\d+)$/)?.[1] || ''),
          title, company, location,
          posted_date: postedDate,
          url,
          source: 'LinkedIn',
          validated: true,
        });
      }
    }
    
    // Also extract currentJobId from URL if available
    const urlParams = new URLSearchParams(window.location.search);
    const currentJobId = urlParams.get('currentJobId');
    if (currentJobId && !results.some(r => r.jobId === currentJobId)) {
      const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, .top-card-layout__title, [class*="job-title"]');
      const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .top-card-layout__second-subtitle, [class*="company"]');
      const title = titleEl?.textContent?.trim() || '';
      const company = companyEl?.textContent?.trim() || '';
      const text = (title + ' ' + company).toLowerCase();
      if (keywords.some(k => text.includes(k)) && !excludes.some(k => text.includes(k))) {
        results.push({
          jobId: currentJobId,
          title, company,
          url: `https://sg.linkedin.com/jobs/view/${currentJobId}`,
          source: 'LinkedIn',
          validated: true,
        });
      }
    }
    
    return results;
  }, {keywords: TAX_KEYWORDS, excludes: EXCLUDE_KEYWORDS}).catch(e => {
    console.error(`[LI] page.evaluate() failed: ${e.message} — likely DOM/selector mismatch`);
    return [];
  });
  
  if (verbose) console.error(`[LI] Extracted ${jobs.length} tax-relevant jobs from page`);
  return jobs;
}

// ─── Shutdown Handler ─────────────────────────────────────────────────────────

let browser = null;

// Graceful shutdown — must NOT use process.exit before async cleanup completes
process.on('SIGTERM', () => {
  if (browser) {
    browser.close().catch(() => {}).finally(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  if (browser) {
    browser.close().catch(() => {}).finally(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const flags = {
    force: args.includes('--force'),
    linkedin: args.includes('--linkedin'),
    mcfOnly: args.includes('--mcf-only'),
    markdown: args.includes('--markdown'),
    updateTracking: args.includes('--update-tracking'),
    maxPages: 3,
    scrollCount: null,
    verbose: args.includes('--verbose'),
  };
  
  if (flags.updateTracking) flags.markdown = true;
  
  const maxPagesIdx = args.indexOf('--max-pages');
  if (maxPagesIdx >= 0 && maxPagesIdx < args.length - 1) {
    flags.maxPages = parseInt(args[maxPagesIdx + 1], 10) || 3;
  }

  const scrollCountIdx = args.indexOf('--scroll-count');
  if (scrollCountIdx >= 0 && scrollCountIdx < args.length - 1) {
    const val = parseInt(args[scrollCountIdx + 1], 10);
    flags.scrollCount = val > 0 ? val : null;
  }
  
  const stateFileIdx = args.indexOf('--state-file');
  if (stateFileIdx >= 0 && stateFileIdx < args.length - 1) {
    stateFilePath = path.resolve(args[stateFileIdx + 1]);
  }
  
  const outputDirIdx = args.indexOf('--output-dir');
  if (outputDirIdx >= 0 && outputDirIdx < args.length - 1) {
    outputDir = path.resolve(args[outputDirIdx + 1]);
  }
  
  const trackingFileIdx = args.indexOf('--tracking-file');
  if (trackingFileIdx >= 0 && trackingFileIdx < args.length - 1) {
    trackingFilePath = path.resolve(args[trackingFileIdx + 1]);
  }
  
  const state = loadState();
  
  const shouldRunLinkedIn = !flags.mcfOnly;
  
  if (flags.verbose) {
    console.error(`[START] Max pages: ${flags.maxPages}, LinkedIn: ${shouldRunLinkedIn}`);
    console.error(`[START] State has ${state.known_linkedin_jobs.length} known LinkedIn jobs`);
  }
  
  // Only launch Chromium if we need LinkedIn extraction (MCF now uses REST API)
  if (!flags.mcfOnly) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  
  let allJobs = [];
  let mcfCount = 0;
  let liCount = 0;
  let linkedinStatus = 'skipped';
  
  try {
    const mcfJobs = await extractMCFJobs(browser, flags.maxPages, flags.verbose);
    mcfCount = mcfJobs.length;
    if (flags.verbose) console.error(`[MCF] Total: ${mcfCount} tax jobs found`);
    
    let liJobs = [];
    if (shouldRunLinkedIn) {
      const liResult = await extractLinkedInJobs(browser, state, flags);
      liJobs = liResult.jobs;
      liCount = liJobs.length;
      linkedinStatus = liResult.status;
      if (flags.verbose) console.error(`[LI] Total: ${liCount} jobs found (status: ${linkedinStatus})`);
      
      for (const job of liJobs) {
        if (job.jobId && !state.known_linkedin_jobs.some(k => k.id === job.jobId)) {
          state.known_linkedin_jobs.push({
            id: job.jobId,
            company: job.company,
            title: job.title,
            last_verified: new Date().toISOString().split('T')[0],
            times_failed: 0,
          });
        } else if (job.jobId) {
          const existing = state.known_linkedin_jobs.find(k => k.id === job.jobId);
          if (existing) {
            existing.last_verified = new Date().toISOString().split('T')[0];
            existing.times_failed = Math.max(0, (existing.times_failed || 0) - 1);
          }
        }
      }
    } else {
      for (const known of state.known_linkedin_jobs) {
        const url = buildLinkedInUrl(known.id, known.title, known.company);
        liJobs.push({
          title: known.title,
          company: known.company,
          url,
          source: 'LinkedIn',
          validated: true,
          posted_date: known.last_verified || '',
        });
      }
      liCount = liJobs.length;
    }
    
    // Prune known_linkedin_jobs by age: keep jobs verified within 30 days, drop stale ones
    // Runs unconditionally — even in mcf-only mode, stale entries should be cleaned
    {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoff = thirtyDaysAgo.toISOString().split('T')[0];
      state.known_linkedin_jobs = state.known_linkedin_jobs.filter(k => {
        if ((k.times_failed || 0) < 3 && !k.last_verified) return true;
        if (k.last_verified && k.last_verified >= cutoff) return true;
        return false;
      });
      // Hard cap: keep newest 100 if still exceeding after age prune
      if (state.known_linkedin_jobs.length > 100) {
        state.known_linkedin_jobs = state.known_linkedin_jobs.slice(-100);
      }
    }
    
    allJobs = [...mcfJobs, ...liJobs];
    
  } catch (e) {
    if (flags.verbose) console.error('[FATAL]', e.message);
  } finally {
    if (browser) await browser.close();
  }
  
  const seenUrls = new Set();
  const dedupedJobs = allJobs.filter(j => {
    if (!j.url || seenUrls.has(j.url)) return false;
    seenUrls.add(j.url);
    return true;
  });
  
  // Dedup is now handled by the database + dashboard URL scan in updateDashboard().
  // reported_urls in state.json is kept for backward compatibility but no longer caps dedup.
  const previouslyReported = new Set(state.reported_urls);
  const newJobs = dedupedJobs;
  
  for (const job of dedupedJobs) {
    if (!state.reported_urls.includes(job.url)) {
      state.reported_urls.push(job.url);
    }
  }
  state.reported_urls = state.reported_urls.slice(-10000);
  
  // FIXED: MCF health logic — initialize to 1 on first zero after non-zero
  const prevMcfCount = state.last_mcf_count;
  if (mcfCount === 0 && prevMcfCount === 0) {
    state.consecutive_zero_mcf = (state.consecutive_zero_mcf || 0) + 1;
  } else if (mcfCount === 0) {
    state.consecutive_zero_mcf = 1;
  } else {
    state.consecutive_zero_mcf = 0;
  }
  
  state.last_mcf_count = mcfCount;
  saveState(state);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dateIdentified = new Date().toISOString().split('T')[0];
  
  const output = {
    generated_at: new Date().toISOString(),
    mcf_health: {
      consecutive_zero_count: state.consecutive_zero_mcf,
      healthy: state.consecutive_zero_mcf < 3,
      status: state.consecutive_zero_mcf === 0 ? 'ok' : state.consecutive_zero_mcf < 3 ? 'warning' : 'error',
    },
    sources: {
      mycareersfuture: {
        jobs_found: mcfCount,
        status: mcfCount > 0 ? 'ok' : 'empty',
      },
      linkedin: {
        jobs_found: liCount,
        status: linkedinStatus,
        known_ids: state.known_linkedin_jobs.length,
      },
    },
    summary: {
      total_unique_jobs: dedupedJobs.length,
      new_jobs_this_run: newJobs.length,
      total_reported_all_time: state.reported_urls.length,
    },
    jobs: dedupedJobs.map(j => ({
      ...j,
      industry: classifyIndustry(j.company || ''),
      date_identified: dateIdentified,
      is_new: !previouslyReported.has(j.url),
    })),
  };
  
  const outputPath = path.join(outputDir, `sg-tax-jobs-${timestamp}.json`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  try {
    const allFiles = fs.readdirSync(outputDir)
      .filter(f => f.startsWith('sg-tax-jobs-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (allFiles.length > 30) {
      for (const f of allFiles.slice(30)) {
        try { fs.unlinkSync(path.join(outputDir, f)); } catch {}
      }
      if (flags.verbose) console.error(`[ROTATE] Removed ${allFiles.length - 30} old output files`);
    }
  } catch {}
  
  if (flags.updateTracking) {
    const trackingResult = updateDashboard(newJobs, dateIdentified);
    if (flags.verbose) {
      console.error(`[DASHBOARD] Injected ${trackingResult.newCount} new jobs into inbox`);
    }
  }
  
  // Build output string buffer first, then write once to stdout
  // This prevents interleaving with console.error verbose output
  let outputStr = '';
  
  if (flags.markdown) {
    const date = dateIdentified;
    let markdown = `**SG Tax Jobs \u2014 ${date}**\n\n`;
    
    if (state.consecutive_zero_mcf >= 3) {
      markdown += `\u26a0\ufe0f **WARNING:** MyCareersFuture has returned 0 jobs for ${state.consecutive_zero_mcf} consecutive runs. Extraction selectors may be broken.\n\n`;
    }
    
    if (newJobs.length > 0) {
      markdown += `**\u2728 New Jobs This Run (${newJobs.length})**\n\n`;
      markdown += `| Company | Industry | Position | Posted | Source |\n`;
      markdown += `|---------|----------|----------|--------|--------|\n`;
      for (const job of newJobs) {
        const company = job.company || 'N/A';
        const industry = classifyIndustry(job.company || '');
        const title = job.title || 'N/A';
        const posted = job.posted_date || '';
        const source = job.source || 'N/A';
        const link = job.url ? `[View](${job.url})` : 'N/A';
        markdown += `| ${company} | ${industry} | ${title} ${link} | ${posted} | ${source} |\n`;
      }
      markdown += `\n`;
    }
    
    if (dedupedJobs.length > 0) {
      markdown += `**All Jobs (${dedupedJobs.length})**\n\n`;
      markdown += `| Company | Industry | Position | Posted | Source | URL |\n`;
      markdown += `|---------|----------|----------|--------|--------|-----|\n`;
      for (const job of dedupedJobs) {
        const company = job.company || 'N/A';
        const industry = classifyIndustry(job.company || '');
        const title = job.title || 'N/A';
        const posted = job.posted_date || '';
        const source = job.source || 'N/A';
        const urlCell = job.url ? `[Link](${job.url})` : '';
        const newTag = job.is_new ? ' \u2705' : '';
        markdown += `| ${company} | ${industry} | ${title} | ${posted} | ${source}${newTag} | ${urlCell} |\n`;
      }
      markdown += `\n`;
    }
    
    markdown += `**Summary:** ${dedupedJobs.length} total jobs, ${newJobs.length} new this run\n`;
    
    if (flags.updateTracking) {
      markdown += `\uD83D\uDCC4 **Dashboard:** \`job_search/SG tax job search.md\`\n`;
    }
    
    if (linkedinStatus !== 'skipped') {
      markdown += `LinkedIn: ${linkedinStatus === 'ok' ? '\u2705 accessible' : '\u26a0\ufe0f blocked (using ' + liCount + ' known IDs)'}\n`;
    }
    
    const MAX_MARKDOWN_LEN = 1900;
    if (markdown.length > MAX_MARKDOWN_LEN) {
      const summaryIdx = markdown.indexOf('**Summary:**');
      const afterSummary = summaryIdx >= 0 ? markdown.slice(summaryIdx) : '';
      const available = Math.max(0, MAX_MARKDOWN_LEN - afterSummary.length - 50);
      markdown = markdown.slice(0, available)
        + `\n\n... (${dedupedJobs.length} total jobs) ...\n\n`
        + afterSummary;
      if (markdown.length > MAX_MARKDOWN_LEN) {
        markdown = markdown.slice(0, MAX_MARKDOWN_LEN - 30) + '\n\n... (truncated)\n';
      }
    }
    
    // Close any unclosed markdown table by ensuring the output ends cleanly
    if (markdown.includes('|') && !markdown.endsWith('\n\n')) {
      markdown = markdown.trimEnd() + '\n';
    }
    
    outputStr = markdown;
  } else {
    outputStr = JSON.stringify(output, null, 2);
  }
  
  // Write output to stdout — prevents interleaving with stderr verbose logs
  process.stdout.write(outputStr);
  
  if (flags.verbose) {
    console.error(`\n[OUTPUT] Written to ${outputPath}`);
    console.error(`[DONE] ${dedupedJobs.length} unique jobs (${newJobs.length} new)`);
  }
}

main().then(() => {
  process.exit(0);
}).catch(e => {
  console.error('FATAL:', e.message);
  // Deliver a fallback message to Discord so the cron doesn't fail silently
  try {
    process.stdout.write(`**\u26a0\ufe0f SG Tax Job Search FAILED**\n\nError: ${e.message}\n\nCheck logs for details.`);
  } catch {}
  process.exit(1);
});
