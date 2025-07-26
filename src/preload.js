const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 配置管理
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config)
  },

  // 对话框
  dialog: {
    selectFolder: (title, defaultPath) => ipcRenderer.invoke('dialog:selectFolder', title, defaultPath)
  },

  // 媒体处理
  media: {
    scan: (sourceDir, targetDir, overwriteDuplicates) => 
      ipcRenderer.invoke('media:scan', sourceDir, targetDir, overwriteDuplicates),
    upload: (files, targetDir, overwriteDuplicates) => 
      ipcRenderer.invoke('media:upload', files, targetDir, overwriteDuplicates)
  },

  // 上传控制
  upload: {
    pause: () => ipcRenderer.invoke('upload:pause'),
    resume: () => ipcRenderer.invoke('upload:resume'),
    cancel: () => ipcRenderer.invoke('upload:cancel')
  },

  // 系统操作
  system: {
    openPath: (filePath) => ipcRenderer.invoke('system:openPath', filePath),
    showInFolder: (filePath) => ipcRenderer.invoke('system:showInFolder', filePath)
  },

  // 事件监听
  on: (channel, callback) => {
    const validChannels = [
      'scan:progress',
      'upload:progress', 
      'upload:fileProcessed'
    ];
    
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  // 移除事件监听
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // 移除所有监听器
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});