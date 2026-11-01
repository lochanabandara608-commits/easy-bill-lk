const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 420, show: false, title: 'EASY BILL Owner',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0f172a',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
