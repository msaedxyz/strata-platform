document.getElementById('login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const body = JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value });
  const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body });
  if (res.ok) {
    const next = new URLSearchParams(location.search).get('next') || '/dashboard';
    location.href = next;
  } else {
    document.getElementById('login-error').hidden = false;
  }
});
