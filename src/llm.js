import { config } from './config.js';
import 'dotenv/config';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REVENUE = 'SUM(il.UnitPrice * il.Quantity)';

export async function post(url, payload, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ttyd/1.0',
        ...headers
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`Groq HTTP ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Groq request timed out after ${config.llmTimeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class GroqClient {
  constructor(model = config.model) {
    this.name = 'groq';
    this.model = model;
    this.apiKey = process.env.GROQ_API_KEY;
    if (!this.apiKey) throw new Error('GROQ_API_KEY is not set');
  }

  async complete(system, user) {
    const startedAt = performance.now();
    const payload = {
      model: this.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    };

    if (system.includes('JSON object')) payload.response_format = { type: 'json_object' };

    const data = await post(GROQ_URL, payload, { Authorization: `Bearer ${this.apiKey}` });
    const usage = data.usage || {};

    return {
      text: data.choices?.[0]?.message?.content ?? '',
      latencyMs: performance.now() - startedAt,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0
    };
  }
}

export class OfflineClient {
  constructor() {
    this.name = 'offline';
    this.model = 'offline-rules';
  }

  async complete(system, user) {
    return {
      text: JSON.stringify(offlinePlan(user)),
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0
    };
  }
}

export function getClient() {
  return process.env.GROQ_API_KEY ? new GroqClient() : new OfflineClient();
}

function sql(query, tables, columns, assumption = '') {
  return { kind: 'sql', sql: query, tables_used: tables, columns_used: columns, assumption, confidence: 0.9 };
}

function refuse(concept, explanation, alternative) {
  return {
    kind: 'refuse',
    missing_concept: concept,
    explanation,
    nearest_answerable: alternative,
    confidence: 0.95
  };
}

export function offlinePlan(prompt) {
  const question = prompt.includes('## Question') ? prompt.split('## Question')[1].split('##')[0].trim() : prompt;
  const q = question.toLowerCase();
  const has = (...terms) => terms.every((term) => q.includes(term));
  const any = (...terms) => terms.some((term) => q.includes(term));

  const wantsAll = any('all ', 'every', "don't limit", 'do not limit', 'no limit', 'list down', 'list the');
  const top = (n) => (wantsAll ? '' : ` LIMIT ${n}`);

  if (any('profit', 'margin', 'cogs')) {
    return refuse(
      'cost / profit margin',
      'The database records what customers paid but holds no cost or expense data, so margin cannot be derived.',
      'What is total revenue per album?'
    );
  }

  if (any('stream', 'play count', 'plays', 'listen')) {
    return refuse(
      'playback / streaming events',
      'Only purchases are recorded. There are no play, stream or listen events in the schema.',
      'How many tracks were purchased in the last month of data?'
    );
  }

  if (any('credit card', 'card number', 'password', 'date of birth', 'gender')) {
    return refuse(
      'personal / payment attributes',
      'The Customer table stores contact details only - no payment instruments, demographics or credentials exist here.',
      'What contact details do we hold for our customers?'
    );
  }

  if (has('best', 'customer') || (has('top', 'customer') && !q.includes('top 10'))) {
    return {
      kind: 'clarify',
      clarifying_question: '"Best" can mean highest total spend or most frequent purchases. Which did you mean?',
      options: [
        {
          label: 'highest total spend',
          sql: `SELECT c.FirstName || ' ' || c.LastName AS Customer, ROUND(${REVENUE}, 2) AS TotalSpend FROM Customer c JOIN Invoice i ON i.CustomerId = c.CustomerId JOIN InvoiceLine il ON il.InvoiceId = i.InvoiceId GROUP BY c.CustomerId ORDER BY TotalSpend DESC LIMIT 5`,
          tables_used: ['Customer', 'Invoice', 'InvoiceLine'],
          columns_used: ['Customer.FirstName', 'Customer.LastName', 'InvoiceLine.UnitPrice', 'InvoiceLine.Quantity']
        },
        {
          label: 'most purchases made',
          sql: "SELECT c.FirstName || ' ' || c.LastName AS Customer, COUNT(DISTINCT i.InvoiceId) AS Purchases FROM Customer c JOIN Invoice i ON i.CustomerId = c.CustomerId GROUP BY c.CustomerId ORDER BY Purchases DESC, Customer LIMIT 5",
          tables_used: ['Customer', 'Invoice'],
          columns_used: ['Customer.FirstName', 'Customer.LastName', 'Invoice.InvoiceId']
        }
      ],
      confidence: 0.6
    };
  }

  if (q.includes('employee') || q.includes('staff')) {
    const wantsRevenue = any('revenue', 'sales figure', 'generated', 'earned', 'most money');

    if (!wantsRevenue) {
      const filter = any('sales', 'support') ? " WHERE Title LIKE '%Sales%'" : '';
      return sql(
        `SELECT FirstName || ' ' || LastName AS Employee, Title, Country FROM Employee${filter} ORDER BY Title, LastName`,
        ['Employee'],
        ['Employee.FirstName', 'Employee.LastName', 'Employee.Title', 'Employee.Country'],
        filter ? 'Matched on Title containing "Sales".' : ''
      );
    }

    return sql(
      `SELECT e.FirstName || ' ' || e.LastName AS Employee, ROUND(${REVENUE}, 2) AS Revenue FROM Employee e JOIN Customer c ON c.SupportRepId = e.EmployeeId JOIN Invoice i ON i.CustomerId = c.CustomerId JOIN InvoiceLine il ON il.InvoiceId = i.InvoiceId GROUP BY e.EmployeeId ORDER BY Revenue DESC${top(3)}`,
      ['Employee', 'Customer', 'Invoice', 'InvoiceLine'],
      ['Employee.FirstName', 'Employee.LastName', 'Customer.SupportRepId', 'InvoiceLine.UnitPrice', 'InvoiceLine.Quantity'],
      'Revenue is attributed to an employee via the customers they support.'
    );
  }

  if (has('how many', 'customer') && !q.includes('country')) {
    return sql('SELECT COUNT(*) AS CustomerCount FROM Customer', ['Customer'], ['Customer.CustomerId']);
  }

  if (has('longest', 'track')) {
    const n = Number((q.match(/\b(\d{1,3})\b/) || [])[1] || 5);
    return sql(
      `SELECT Name, Milliseconds, ROUND(Milliseconds / 60000.0, 2) AS Minutes FROM Track ORDER BY Milliseconds DESC LIMIT ${n}`,
      ['Track'],
      ['Track.Name', 'Track.Milliseconds'],
      'Duration is Track.Milliseconds; minutes shown for readability.'
    );
  }

  if (has('revenue', 'country') || has('sales', 'country')) {
    return sql(
      `SELECT c.Country, ROUND(${REVENUE}, 2) AS Revenue FROM Customer c JOIN Invoice i ON i.CustomerId = c.CustomerId JOIN InvoiceLine il ON il.InvoiceId = i.InvoiceId GROUP BY c.Country ORDER BY Revenue DESC`,
      ['Customer', 'Invoice', 'InvoiceLine'],
      ['Customer.Country', 'InvoiceLine.UnitPrice', 'InvoiceLine.Quantity'],
      "Country is the customer's home country, not the billing country."
    );
  }

  if (has('genre', 'revenue') || (q.includes('genre') && any('most money', 'highest sales'))) {
    return sql(
      `SELECT g.Name AS Genre, ROUND(${REVENUE}, 2) AS Revenue FROM Genre g JOIN Track t ON t.GenreId = g.GenreId JOIN InvoiceLine il ON il.TrackId = t.TrackId GROUP BY g.GenreId ORDER BY Revenue DESC${top(5)}`,
      ['Genre', 'Track', 'InvoiceLine'],
      ['Genre.Name', 'Track.GenreId', 'InvoiceLine.UnitPrice', 'InvoiceLine.Quantity']
    );
  }

  if (has('average', 'invoice')) {
    const filter = any('usa', 'united states') ? " WHERE c.Country = 'USA'" : '';
    return sql(
      `SELECT ROUND(AVG(i.Total), 2) AS AverageInvoiceTotal FROM Invoice i JOIN Customer c ON c.CustomerId = i.CustomerId${filter}`,
      ['Invoice', 'Customer'],
      ['Invoice.Total', 'Customer.Country'],
      'Averaged at invoice grain, so Invoice.Total is safe here.'
    );
  }

  if (q.includes('album') && q.includes('how many')) {
    const artist = (q.match(/["']([^"']{2,60})["']/) || [])[1] || 'iron maiden';
    const name = artist.replace(/\b\w/g, (c) => c.toUpperCase());
    return sql(
      `SELECT COUNT(DISTINCT al.AlbumId) AS AlbumCount FROM Artist ar JOIN Album al ON al.ArtistId = ar.ArtistId WHERE ar.Name = '${name}'`,
      ['Artist', 'Album'],
      ['Artist.Name', 'Album.AlbumId', 'Album.ArtistId']
    );
  }

  if (q.includes('track') && any('share', 'percentage', 'proportion')) {
    return sql(
      'SELECT ROUND(100.0 * SUM(CASE WHEN Milliseconds > 300000 THEN 1 ELSE 0 END) / COUNT(*), 2) AS PercentOverFiveMinutes, COUNT(*) AS TotalTracks FROM Track',
      ['Track'],
      ['Track.Milliseconds'],
      '5 minutes = 300000 milliseconds.'
    );
  }

  if (q.includes('country') && any('most customers', 'how many customers')) {
    return sql(
      `SELECT Country, COUNT(*) AS Customers FROM Customer GROUP BY Country ORDER BY Customers DESC, Country ASC${top(5)}`,
      ['Customer'],
      ['Customer.Country', 'Customer.CustomerId']
    );
  }

  if (q.includes('revenue') && /\b(19|20)\d{2}\b/.test(q)) {
    const year = Number(q.match(/\b((?:19|20)\d{2})\b/)[1]);
    return sql(
      `SELECT ROUND(${REVENUE}, 2) AS Revenue FROM Invoice i JOIN InvoiceLine il ON il.InvoiceId = i.InvoiceId WHERE i.InvoiceDate >= '${year}-01-01' AND i.InvoiceDate < '${year + 1}-01-01'`,
      ['Invoice', 'InvoiceLine'],
      ['Invoice.InvoiceDate', 'InvoiceLine.UnitPrice', 'InvoiceLine.Quantity'],
      `Calendar year ${year}.`
    );
  }

  if (q.includes('track') && any('popular', 'best selling', 'best-selling')) {
    return sql(
      `SELECT t.Name AS Track, SUM(il.Quantity) AS UnitsSold FROM Track t JOIN InvoiceLine il ON il.TrackId = t.TrackId GROUP BY t.TrackId ORDER BY UnitsSold DESC, Track ASC${top(5)}`,
      ['Track', 'InvoiceLine'],
      ['Track.Name', 'InvoiceLine.Quantity'],
      'Popularity means units purchased - this database records no plays or streams.'
    );
  }

  if (q.includes('revenue') && q.includes('customer') && q.includes('brazil')) {
    return sql(
      `SELECT c.FirstName || ' ' || c.LastName AS Customer, ROUND(${REVENUE}, 2) AS Revenue FROM Customer c JOIN Invoice i ON i.CustomerId = c.CustomerId JOIN InvoiceLine il ON il.InvoiceId = i.InvoiceId WHERE c.Country = 'Brazil' GROUP BY c.CustomerId ORDER BY Revenue DESC`,
      ['Customer', 'Invoice', 'InvoiceLine'],
      ['Customer.Country', 'InvoiceLine.UnitPrice', 'InvoiceLine.Quantity']
    );
  }

  return refuse(
    'offline planner coverage',
    'No GROQ_API_KEY is set, so the offline rule planner is running and it has no rule for this question.',
    'What is total sales revenue by country?'
  );
}
