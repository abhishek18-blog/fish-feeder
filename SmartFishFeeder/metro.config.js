// metro.config.js — Expo Metro configuration with MobileNetV2 (.pth) inference middleware
const { getDefaultConfig } = require('expo/metro-config');
const { spawn } = require('child_process');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Fix Firebase JS SDK "Component auth has not been registered yet" in Expo / RN 0.86+
config.resolver.sourceExts = config.resolver.sourceExts || [];
if (!config.resolver.sourceExts.includes('cjs')) {
  config.resolver.sourceExts.push('cjs');
}
config.resolver.unstable_enablePackageExports = false;

// Support .pth PyTorch model files as bundled assets
if (!config.resolver.assetExts.includes('pth')) {
  config.resolver.assetExts.push('pth');
}

// Built-in dev middleware so Expo Go can also execute the exact Python MobileNetV2
// (`android/app/src/main/python/fish_disease_detector.py` + `models/smart_fish_mobilenet.pth`)
config.server = config.server || {};
const prevEnhanceMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (middleware, metroServer) => {
  const baseMiddleware = prevEnhanceMiddleware
    ? prevEnhanceMiddleware(middleware, metroServer)
    : middleware;

  return (req, res, next) => {
    if (req.url && req.url.startsWith('/api/fish-disease-detect') && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const scriptPath = path.join(
          __dirname,
          'android',
          'app',
          'src',
          'main',
          'python',
          'fish_disease_detector.py'
        );
        const modelPath = path.join(__dirname, 'models', 'smart_fish_mobilenet.pth');

        let payload = {};
        try {
          payload = JSON.parse(body || '{}');
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
          return;
        }
        payload.modelPath = modelPath;

        const py = spawn('python3', [scriptPath]);
        let stdout = '';
        let stderr = '';

        py.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        py.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        py.on('close', (code) => {
          res.writeHead(code === 0 ? 200 : 500, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          if (code === 0 && stdout.trim()) {
            res.end(stdout.trim());
          } else {
            res.end(
              JSON.stringify({
                success: false,
                error: stderr || `Python exited with code ${code}`,
              })
            );
          }
        });

        py.stdin.write(JSON.stringify(payload));
        py.stdin.end();
      });
      return;
    }

    if (req.url && req.url.startsWith('/api/auth-session')) {
      const fs = require('fs');
      const sessionPath = path.join(__dirname, '.auth_session.json');

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c.toString()));
        req.on('end', () => {
          try {
            fs.writeFileSync(sessionPath, body, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
        return;
      }

      if (req.method === 'GET') {
        try {
          if (fs.existsSync(sessionPath)) {
            const data = fs.readFileSync(sessionPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, user: null }));
          }
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, user: null }));
        }
        return;
      }

      if (req.method === 'DELETE') {
        try {
          if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
        } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }
    }

    return baseMiddleware(req, res, next);
  };
};

module.exports = config;

