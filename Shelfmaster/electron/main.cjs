const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 5000);
const isDev = !app.isPackaged && process.env.ELECTRON_DEV === '1';

let serverProcess = null;
let mainWindow = null;

function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/lan-info', timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('Server did not start in time.'));
        else setTimeout(check, 300);
      });
      req.on('timeout', () => req.destroy());
    };
    check();
  });
}

function startServer() {
  if (isDev) {
    return waitForServer(PORT);
  }

  const projectRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..');

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
    },
    stdio: 'inherit',
  });

  serverProcess.on('exit', (code) => {
    console.log(`[server] exited with code ${code}`);
    serverProcess = null;
  });

  return waitForServer(PORT);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'ShelfMaster',
    backgroundColor: '#fafaf5',
    icon: path.join(__dirname, '..', 'public', 'shelfmaster_logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  try {
    await startServer();
    await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  } catch (err) {
    console.error('Failed to start ShelfMaster server:', err);
    mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
      encodeURIComponent(`
        <html><body style="font-family:system-ui;padding:40px;background:#fef2f2;color:#7f1d1d">
          <h2>ShelfMaster could not start its server.</h2>
          <p>Make sure MySQL (XAMPP) is running and try again.</p>
          <pre>${String(err.message || err)}</pre>
        </body></html>
      `)
    );
    mainWindow.show();
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown() {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill(); } catch (_) {}
    serverProcess = null;
  }
}

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', shutdown);
process.on('exit', shutdown);
