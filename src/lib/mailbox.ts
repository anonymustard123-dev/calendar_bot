export type InboxEmail = { subject: string; body: string; from: string; to?: string; cc?: string; importance?: string; date?: string; row: number };
export type MailboxInfo = { fileName: string; count: number; reviewFor: string };
export type MailboxExcerpt = { subject: string; body: string; from: string; to: string; cc: string; date: string; row: number };

const DATABASE = 'bny-mailbox-v1';
const CHUNK_SIZE = 500;
let cachedEmails: InboxEmail[] | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('chunks');
      request.result.createObjectStore('metadata');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMailbox(emails: InboxEmail[], info: MailboxInfo) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['chunks', 'metadata'], 'readwrite');
      const chunks = transaction.objectStore('chunks');
      chunks.clear();
      for (let index = 0; index < emails.length; index += CHUNK_SIZE) chunks.put(emails.slice(index, index + CHUNK_SIZE), index / CHUNK_SIZE);
      transaction.objectStore('metadata').put(info, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    cachedEmails = emails;
  } finally {
    database.close();
  }
}

export async function loadMailboxInfo(): Promise<MailboxInfo | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('metadata').objectStore('metadata').get('current');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function loadMailbox(): Promise<InboxEmail[]> {
  if (cachedEmails) return cachedEmails;
  const database = await openDatabase();
  try {
    const chunks = await new Promise<InboxEmail[][]>((resolve, reject) => {
      const request = database.transaction('chunks').objectStore('chunks').getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    cachedEmails = chunks.flat();
    return cachedEmails;
  } finally {
    database.close();
  }
}

const STOP_WORDS = new Set('a an and are about by can did do does for from have i in is it me my of on or our please show that the them there these this to was were what when where which who with you your email emails inbox message messages recent latest'.split(' '));
const textWords = (value: string) => value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
const plainBody = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();

export async function searchMailbox(question: string): Promise<MailboxExcerpt[]> {
  const emails = await loadMailbox();
  const terms = [...new Set(textWords(question).filter((term) => !STOP_WORDS.has(term)))];
  const recentStart = Math.max(0, emails.length - 100);
  const ranked = emails.map((email, index) => {
    const subject = email.subject.toLowerCase();
    const people = `${email.from} ${email.to ?? ''} ${email.cc ?? ''}`.toLowerCase();
    const body = email.body.toLowerCase();
    const score = terms.reduce((total, term) => total + (subject.includes(term) ? 8 : 0) + (people.includes(term) ? 5 : 0) + (body.includes(term) ? 1 : 0), 0);
    return { email, index, score };
  });
  const matches = terms.length ? ranked.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 16) : [];
  const selected = new Map<number, InboxEmail>(matches.map((item) => [item.index, item.email]));
  // Recent messages provide current context, but old matching messages can answer a specific question.
  for (let index = emails.length - 1; index >= recentStart && selected.size < 24; index -= 1) selected.set(index, emails[index]);
  return [...selected.entries()].sort((a, b) => b[0] - a[0]).map(([, email]) => ({
    subject: email.subject.slice(0, 300), body: plainBody(email.body).slice(0, 1800), from: email.from.slice(0, 200),
    to: (email.to ?? '').slice(0, 250), cc: (email.cc ?? '').slice(0, 250), date: email.date ?? '', row: email.row,
  }));
}
