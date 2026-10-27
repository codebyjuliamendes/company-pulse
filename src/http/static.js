'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves files from root only (no traversal, no directory listing), with ETag revalidation. */
function createStatic(root) {
  const base = path.resolve(root);
  const cache = new Map();

  async function load(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
    const content = await fs.readFile(file);
    const entry = {
      content,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      etag: `"${crypto.createHash('sha1').update(content).digest('base64url')}"`,
    };
    cache.set(file, entry);
    return entry;
  }

  /** Returns false when nothing was served (caller answers 404). */
  return async function serve(req, res, pathname) {
    let relative;
    try {
      relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    } catch {
      return false;
    }
    if (relative.includes('\0')) return false;
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) return false;
    let entry;
    try {
      entry = await load(file);
    } catch {
      return false;
    }
    if (!entry) return false;
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    // Unhashed asset names: always revalidate (cheap 304), never stale.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', entry.etag);
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304);
      res.end();
      return true;
    }
    res.setHeader('Content-Length', entry.content.length);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : entry.content);
    return true;
  };
}

module.exports = { createStatic };
