const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('shelfmaster', {
  isElectron: true,
  platform: process.platform,
});
