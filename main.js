const { app, BrowserWindow } = require('electron');
const path = require('path');
const bytenode = require('bytenode');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Field Service Management",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false // Disabilita console e ispezione codice per l'utente finale
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});