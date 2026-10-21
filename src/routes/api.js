const express = require('express');
const router = express.Router();

// Mock database
const mockProducts = [
  { id: 'prod_101', name: 'Ultra-Fast Edge Router', price: 299.99, stock: 45, category: 'Hardware' },
  { id: 'prod_102', name: 'Enterprise WAF License', price: 1200.0, stock: 999, category: 'Software' },
  { id: 'prod_103', name: 'Redis Cloud Dedicated Cluster', price: 450.0, stock: 120, category: 'Cloud' },
  { id: 'prod_104', name: 'DDoS Mitigation Appliance', price: 3499.0, stock: 12, category: 'Security' },
  { id: 'prod_105', name: 'API Gateway SSL Accelerator', price: 890.0, stock: 34, category: 'Hardware' },
];

// 1. GET /api/v1/products
router.get('/products', (req, res) => {
  res.json({
    success: true,
    count: mockProducts.length,
    data: mockProducts,
    meta: {
      timestamp: new Date().toISOString(),
      apiVersion: 'v1.4.0',
    },
  });
});

// 2. GET /api/v1/products/:id
router.get('/products/:id', (req, res) => {
  const product = mockProducts.find((p) => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }
  res.json({ success: true, data: product });
});

// 3. GET /api/v1/profile
router.get('/profile', (req, res) => {
  res.json({
    success: true,
    user: {
      id: 'usr_78942',
      username: 'cloud_architect',
      email: 'engineer@production-grid.io',
      role: 'SecOps Lead',
      tier: 'Enterprise Dedicated',
    },
  });
});

// 4. POST /api/v1/login (Simulates authentication & credential brute forcing)
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  // For testing: correct login is admin / secretpass
  if (username === 'admin' && password === 'secretpass') {
    return res.json({
      success: true,
      token: 'jwt_mock_token_8a9f02cb84ef9012',
      message: 'Authentication successful',
    });
  }

  // Failed login returns 401 which triggers failure accumulation in abuse detector
  return res.status(401).json({
    success: false,
    error: 'Invalid username or credentials provided',
    code: 'AUTH_FAILED',
  });
});

// 5. GET /api/v1/search (Heavy compute simulation)
router.get('/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const results = mockProducts.filter(
    (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
  );
  res.json({
    success: true,
    query,
    resultsCount: results.length,
    results,
  });
});

// Honeypot endpoints trap
const honeypotHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    warning: 'Suspicious path access logged for abuse analysis',
  });
};

router.all('/.env', honeypotHandler);
router.all('/.git', honeypotHandler);
router.all('/wp-admin', honeypotHandler);
router.all('/wp-login.php', honeypotHandler);
router.all('/phpmyadmin', honeypotHandler);
router.all('/actuator/env', honeypotHandler);
router.all('/actuator/health', honeypotHandler);
router.all('/shell', honeypotHandler);

module.exports = router;
