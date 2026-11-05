// online.js - start the game AND open a public internet link, so friends on any network (home WiFi, mobile data, another office) can join.
//
//   npm run online          (or double-click play-online.bat)
//
// It starts a free Cloudflare "quick tunnel" to this PC, waits for the public https address, then starts the game server with that address
// as the invite link. Nothing is installed permanently; the link stops working when you close this window.
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3000;
const say = s => console.log(s);
let started = false, tunnel = null;

function startServer(publicUrl) {
  if (started) return;
  started = true;
  const env = Object.assign({}, process.env, { PORT: String(PORT) });
  if (publicUrl) env.PUBLIC_URL = publicUrl;
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: 'inherit' });
  srv.on('exit', code => { if (tunnel) tunnel.kill(); process.exit(code || 0); });
  if (publicUrl) {
    say('\n==============================================================');
    say('  INVITE LINK (works from any network, any phone or PC):');
    say('');
    say('     ' + publicUrl);
    say('');
    say('  Open it yourself, create a room, then press "Copy invite link"');
    say('  in the lobby and send that link to your team.');
    say('  Keep this window open while you play. Ctrl+C stops everything.');
    say('==============================================================\n');
  }
}

say('Opening a public tunnel (this takes 5-20 seconds)...');
tunnel = spawn('npx --yes cloudflared tunnel --no-autoupdate --url http://localhost:' + PORT, { shell: true });   // one string: no shell-argument warning
const timer = setTimeout(() => {
  say('\nCould not open the internet tunnel (no internet, or it is blocked on this network).');
  say('Starting the game for this WiFi/office network only.');
  say('To reach other networks, deploy this folder to a host such as Render or Railway (see render.yaml), or use another tunnel such as ngrok.\n');
  startServer(null);
}, 120000);

const onData = d => {
  for (const l of String(d).split(/\r?\n/)) if (l.trim() && !started && /(download|install|error|fail|connect|register|starting|npm )/i.test(l)) say('  [tunnel] ' + l.trim().slice(0, 140));   // show progress so you can see it is working
  const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m && !started) { clearTimeout(timer); startServer(m[0]); }
};
tunnel.stdout.on('data', onData);
tunnel.stderr.on('data', onData);
tunnel.on('error', e => { say('Tunnel failed to start: ' + e.message); });
process.on('SIGINT', () => { if (tunnel) tunnel.kill(); process.exit(0); });
