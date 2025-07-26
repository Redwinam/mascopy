const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

class MediaUploader extends EventEmitter {
  constructor() {
    super();
    this.isUploading = false;
    this.isPaused = false;
    this.isCancelled = false;
    this.currentIndex = 0;
    this.files = [];
  }

  async uploadFiles(files, targetDir, overwriteDuplicates) {
    this.isUploading = true;
    this.isPaused = false;
    this.isCancelled = false;
    this.currentIndex = 0;
    this.files = files;

    try {
      let processedFiles = 0;
      const totalFiles = files.length;

      this.emit('progress', {
        current: 0,
        total: totalFiles,
        message: `开始上传 ${totalFiles} 个媒体文件...`
      });

      for (let i = 0; i < files.length; i++) {
        if (this.isCancelled) {
          this.emit('progress', {
            current: processedFiles,
            total: totalFiles,
            message: '上传已取消'
          });
          break;
        }

        // 检查是否暂停
        while (this.isPaused && !this.isCancelled) {
          await this.sleep(100);
        }

        if (this.isCancelled) break;

        this.currentIndex = i;
        const mediaFile = files[i];

        try {
          if (mediaFile.status === '将上传' || mediaFile.status === '将覆盖') {
            await this.copyFile(mediaFile);
            
            this.emit('fileProcessed', {
              file: mediaFile,
              success: true,
              message: `已复制 (${mediaFile.fileType}): ${mediaFile.filename}`
            });
          } else {
            this.emit('fileProcessed', {
              file: mediaFile,
              success: true,
              message: `跳过 (${mediaFile.fileType}): ${mediaFile.filename}`
            });
          }

          processedFiles++;
          
          this.emit('progress', {
            current: processedFiles,
            total: totalFiles,
            message: `正在处理: ${mediaFile.filename} (${processedFiles}/${totalFiles})`
          });

        } catch (error) {
          console.error(`处理文件失败: ${mediaFile.filename}`, error);
          
          this.emit('fileProcessed', {
            file: mediaFile,
            success: false,
            message: `处理文件出错 ${mediaFile.filename}: ${error.message}`
          });
        }
      }

      if (!this.isCancelled) {
        this.emit('progress', {
          current: totalFiles,
          total: totalFiles,
          message: '上传完成!'
        });
      }

      return {
        success: !this.isCancelled,
        processed: processedFiles,
        total: totalFiles
      };

    } catch (error) {
      this.emit('progress', {
        current: 0,
        total: files.length,
        message: `上传失败: ${error.message}`
      });
      throw error;
    } finally {
      this.isUploading = false;
      this.isPaused = false;
    }
  }

  async copyFile(mediaFile) {
    const targetDir = path.dirname(mediaFile.targetPath);
    
    // 确保目标目录存在
    await fs.mkdir(targetDir, { recursive: true });
    
    // 复制文件
    await fs.copyFile(mediaFile.filePath, mediaFile.targetPath);
    
    // 复制文件时间戳
    try {
      const stats = await fs.stat(mediaFile.filePath);
      await fs.utimes(mediaFile.targetPath, stats.atime, stats.mtime);
    } catch (error) {
      console.warn(`无法复制文件时间戳: ${mediaFile.filename}`, error.message);
    }
  }

  pause() {
    if (this.isUploading && !this.isPaused) {
      this.isPaused = true;
      this.emit('progress', {
        current: this.currentIndex,
        total: this.files.length,
        message: '上传已暂停'
      });
    }
  }

  resume() {
    if (this.isUploading && this.isPaused) {
      this.isPaused = false;
      this.emit('progress', {
        current: this.currentIndex,
        total: this.files.length,
        message: '继续上传...'
      });
    }
  }

  cancel() {
    if (this.isUploading) {
      this.isCancelled = true;
      this.isPaused = false;
      this.emit('progress', {
        current: this.currentIndex,
        total: this.files.length,
        message: '正在取消上传...'
      });
    }
  }

  isRunning() {
    return this.isUploading;
  }

  isPausedState() {
    return this.isPaused;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { MediaUploader };