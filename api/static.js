/**
 * Optimized static file server
 * Serves CSS, JS, and other static assets with aggressive caching
 */

const path = require('path');
const fs = require('fs');

// MIME type mapping
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

module.exports = (req, res) => {
  try {
    // Extract file path from URL - handle both /static/ prefix and direct file requests
    let urlPath = req.url;

    // Remove query parameters (like ?v=20241220-1)
    urlPath = urlPath.split('?')[0];

    // Remove /static/ prefix if present, otherwise use the path as-is
    if (urlPath.startsWith('/static/')) {
      urlPath = urlPath.replace(/^\/static\//, '');
    } else {
      // Remove leading slash for direct file requests
      urlPath = urlPath.replace(/^\//, '');
    }

    const filePath = path.join(process.cwd(), 'public', urlPath);
    const ext = path.extname(filePath).toLowerCase();
    
    // Security check - prevent directory traversal
    if (filePath.indexOf(path.join(process.cwd(), 'public')) !== 0) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Set MIME type
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    
    // Set aggressive caching headers for static assets
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
    res.setHeader('ETag', `"${stats.mtime.getTime()}-${stats.size}"`);
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    
    // Check if client has cached version
    const ifNoneMatch = req.headers['if-none-match'];
    const ifModifiedSince = req.headers['if-modified-since'];
    
    if (ifNoneMatch === `"${stats.mtime.getTime()}-${stats.size}"` ||
        (ifModifiedSince && new Date(ifModifiedSince) >= stats.mtime)) {
      res.status(304).end();
      return;
    }

    // Serve the file
    const fileContent = fs.readFileSync(filePath);
    res.status(200).send(fileContent);
    
  } catch (error) {
    console.error('Static file serving error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
