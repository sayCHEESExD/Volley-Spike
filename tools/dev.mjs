// Local development: game server on :2567 (restarts on change) + Vite client on :5173.
import { spawn } from 'node:child_process';
const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });
const server = run(['--watch-path=server', '--watch-path=shared', 'server/index.js']);
const vite = run(['node_modules/vite/bin/vite.js', '--config', 'client/vite.config.js']);
const stop = () => { server.kill(); vite.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
