const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.configPath = path.join(os.homedir(), '.mascopy-config.json');
    this.defaultConfig = {
      // 向后兼容的全局设置
      sourceDir: '',
      targetDir: '',
      overwriteDuplicates: false,
      lastScanResults: null,
      
      // 新的模式配置
      currentMode: 'sd', // 'sd' 或 'dji'
      sdMode: {
        sourceDir: '',
        targetDir: '',
        overwriteDuplicates: false
      },
      djiMode: {
        sourceDir: '',
        targetDir: '',
        overwriteDuplicates: false
      },
      
      windowBounds: {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined
      }
    };
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // 合并默认配置，确保所有字段都存在
      return { ...this.defaultConfig, ...config };
    } catch (error) {
      // 如果配置文件不存在或读取失败，返回默认配置
      console.log('使用默认配置:', error.message);
      return { ...this.defaultConfig };
    }
  }

  async saveConfig(config) {
    try {
      // 确保配置目录存在
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // 保存配置
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf8');
      return { success: true };
    } catch (error) {
      console.error('保存配置失败:', error);
      return { success: false, error: error.message };
    }
  }

  async updateConfig(updates) {
    try {
      const currentConfig = await this.loadConfig();
      const newConfig = { ...currentConfig, ...updates };
      return await this.saveConfig(newConfig);
    } catch (error) {
      console.error('更新配置失败:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = { ConfigManager };