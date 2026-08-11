const baseUrl = process.env.API_BASE_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function login(username, password) {
  const data = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!data.token || !data.user) throw new Error(`Invalid login response for ${username}`);
  return data.token;
}

function auth(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

console.log(`Running smoke test against ${baseUrl}`);
const health = await request('/health');
if (health.status !== 'ok') throw new Error('Health endpoint did not return ok.');

const adminToken = await login(process.env.SMOKE_ADMIN_USER || 'admin', process.env.SMOKE_ADMIN_PASSWORD || 'Admin123!');
await request('/auth/me', auth(adminToken));
await request('/dashboard', auth(adminToken));
await request('/users', auth(adminToken));
await request('/projects', auth(adminToken));
await request('/tasks', auth(adminToken));
await request('/timers/logs', auth(adminToken));
await request('/reports', auth(adminToken));
await request('/notifications', auth(adminToken));
await request('/activities?limit=5', auth(adminToken));

const developerToken = await login(process.env.SMOKE_DEVELOPER_USER || 'developer', process.env.SMOKE_DEVELOPER_PASSWORD || 'Developer123!');
await request('/dashboard', auth(developerToken));
await request('/projects', auth(developerToken));
await request('/tasks', auth(developerToken));
await request('/timers/active', auth(developerToken));
await request('/reports', auth(developerToken));

console.log('Smoke test passed.');
