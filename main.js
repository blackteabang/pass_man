const { app, BrowserWindow } = require('electron');
const path = require('path');

// Launch the local server backend immediately
require('./server.js');

let win = null;

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 1000,
        minHeight: 650,
        show: false, // Don't show the window until it's ready-to-show
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Remove the default menu bar for a clean, premium desktop app appearance
    win.setMenu(null);

    // Robust loading with retries to ensure server is fully bound to port 3000
    function loadApp() {
        if (!win) return;
        win.loadURL('http://127.0.0.1:3000').then(() => {
            win.show();
        }).catch((err) => {
            console.log("로컬 서버가 아직 구동되지 않았습니다. 200ms 후 재시도합니다...");
            setTimeout(loadApp, 200);
        });
    }

    loadApp();

    win.on('closed', () => {
        win = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
