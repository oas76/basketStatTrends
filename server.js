const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure csv directory exists
const csvDir = path.join(__dirname, 'csv');
if (!fs.existsSync(csvDir)) {
  fs.mkdirSync(csvDir, { recursive: true });
}

// Configure multer for CSV uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, csvDir);
  },
  filename: (req, file, cb) => {
    // Use original filename, sanitized
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve static files
app.use(express.static(__dirname));

/**
 * Validate that a filename is safe and resolves within the csv directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd)
 * @param {string} filename - The filename to validate
 * @returns {string|null} - Safe absolute path or null if invalid
 */
function getSafeFilePath(filename) {
  // Reject if filename contains path separators or is empty
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return null;
  }
  
  // Resolve the full path
  const filePath = path.resolve(csvDir, filename);
  
  // Ensure the resolved path is within csvDir
  if (!filePath.startsWith(csvDir + path.sep) && filePath !== csvDir) {
    return null;
  }
  
  return filePath;
}

// API: Upload CSV file
app.post('/api/upload-csv', upload.single('csvFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  res.json({
    success: true,
    filename: req.file.filename,
    path: `/csv/${req.file.filename}`,
    size: req.file.size
  });
});

// API: List CSV files
app.get('/api/csv-files', (req, res) => {
  fs.readdir(csvDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read csv directory' });
    }
    
    const csvFiles = files
      .filter(f => f.endsWith('.csv'))
      .map(filename => {
        const filePath = path.join(csvDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          path: `/csv/${filename}`,
          size: stats.size,
          modified: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json(csvFiles);
  });
});

// API: Get CSV file content
app.get('/api/csv/:filename', (req, res) => {
  const filePath = getSafeFilePath(req.params.filename);
  
  // Reject path traversal attempts
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.sendFile(filePath);
});

// Serve csv directory
app.use('/csv', express.static(csvDir));

app.listen(PORT, () => {
  console.log(`BasketStat server running at http://localhost:${PORT}`);
  console.log(`CSV files stored in: ${csvDir}`);
});
