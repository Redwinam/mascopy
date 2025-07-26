const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const ffprobe = require('ffprobe');
const ffprobeStatic = require('ffprobe-static');

class MediaFile {
  constructor(filePath, date = null, fileType = '未知') {
    this.filePath = filePath;
    this.filename = path.basename(filePath);
    this.fileSize = 0;
    this.date = date;
    this.fileType = fileType;
    this.status = '未处理'; // 状态：未处理、将上传、将覆盖、将跳过
    this.targetPath = '';
  }

  toString() {
    return `${this.filename} (${this.fileType}) - ${this.status}`;
  }
}

class MediaScanner extends EventEmitter {
  constructor() {
    super();
    this.photoExtensions = ['.jpg', '.jpeg', '.png', '.heic', '.nef', '.cr2', '.arw', '.dng', '.cr3'];
    this.videoExtensions = ['.mp4', '.mov', '.avi', '.m4v', '.3gp', '.mkv'];
    this.supportedExtensions = [...this.photoExtensions, ...this.videoExtensions];
    this.isScanning = false;
    this.shouldStop = false;
  }

  async getPhotoDate(filePath) {
    try {
      // 使用sharp读取EXIF数据
      const metadata = await sharp(filePath).metadata();
      
      if (metadata.exif) {
        const parser = exifParser.create(metadata.exif);
        const result = parser.parse();
        
        if (result.tags && result.tags.DateTimeOriginal) {
          return new Date(result.tags.DateTimeOriginal * 1000);
        }
      }
    } catch (error) {
      console.log(`无法读取照片EXIF数据: ${filePath}`, error.message);
    }

    // 如果无法从EXIF获取日期，使用文件修改时间
    try {
      const stats = await fs.stat(filePath);
      return stats.mtime;
    } catch (error) {
      console.error(`无法获取文件统计信息: ${filePath}`, error);
      return new Date();
    }
  }

  async getVideoDate(filePath) {
    try {
      // 使用ffprobe获取视频元数据
      const data = await ffprobe(filePath, { path: ffprobeStatic.path });
      
      if (data.format && data.format.tags) {
        const tags = data.format.tags;
        
        // 尝试不同的日期字段
        const dateFields = [
          tags.creation_time,
          tags.date,
          tags.encoded_date,
          tags['com.apple.quicktime.creationdate']
        ];

        for (const dateField of dateFields) {
          if (dateField) {
            try {
              const date = new Date(dateField);
              if (!isNaN(date.getTime())) {
                return date;
              }
            } catch (error) {
              continue;
            }
          }
        }
      }
    } catch (error) {
      console.log(`无法读取视频元数据: ${filePath}`, error.message);
    }

    // 如果无法从元数据获取日期，使用文件修改时间
    try {
      const stats = await fs.stat(filePath);
      return stats.mtime;
    } catch (error) {
      console.error(`无法获取文件统计信息: ${filePath}`, error);
      return new Date();
    }
  }

  async getMediaDate(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (this.photoExtensions.includes(ext)) {
      return await this.getPhotoDate(filePath);
    } else if (this.videoExtensions.includes(ext)) {
      return await this.getVideoDate(filePath);
    } else {
      // 默认使用文件修改时间
      try {
        const stats = await fs.stat(filePath);
        return stats.mtime;
      } catch (error) {
        console.error(`无法获取文件统计信息: ${filePath}`, error);
        return new Date();
      }
    }
  }

  async scanDirectory(sourceDir, targetDir, overwriteDuplicates) {
    this.isScanning = true;
    this.shouldStop = false;

    try {
      // 检查目录是否存在
      await fs.access(sourceDir);
      await fs.access(targetDir);

      this.emit('progress', {
        phase: 'collecting',
        current: 0,
        total: 100,
        message: '正在收集文件列表...'
      });

      // 收集所有文件
      const allFiles = await this.collectFiles(sourceDir);
      
      // 过滤媒体文件
      const mediaFiles = [];
      let processed = 0;

      for (const filePath of allFiles) {
        if (this.shouldStop) break;

        const ext = path.extname(filePath).toLowerCase();
        if (this.supportedExtensions.includes(ext)) {
          try {
            const stats = await fs.stat(filePath);
            const fileType = this.photoExtensions.includes(ext) ? '照片' : '视频';
            const mediaDate = await this.getMediaDate(filePath);
            
            const mediaFile = new MediaFile(filePath, mediaDate, fileType);
            mediaFile.fileSize = stats.size;
            mediaFiles.push(mediaFile);

            this.emit('progress', {
              phase: 'processing',
              current: processed + 1,
              total: allFiles.length,
              message: `正在处理: ${path.basename(filePath)}`
            });
          } catch (error) {
            console.error(`处理文件失败: ${filePath}`, error);
          }
        }

        processed++;
      }

      if (this.shouldStop) {
        throw new Error('扫描已取消');
      }

      // 分析文件状态
      const results = await this.analyzeFiles(mediaFiles, targetDir, overwriteDuplicates);
      
      this.emit('progress', {
        phase: 'completed',
        current: 100,
        total: 100,
        message: '扫描完成'
      });

      return results;

    } catch (error) {
      this.emit('progress', {
        phase: 'error',
        current: 0,
        total: 100,
        message: `扫描失败: ${error.message}`
      });
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  async collectFiles(dir) {
    const files = [];
    
    async function walk(currentDir) {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.error(`无法读取目录: ${currentDir}`, error);
      }
    }

    await walk(dir);
    return files;
  }

  async analyzeFiles(mediaFiles, targetDir, overwriteDuplicates) {
    let uploadCount = 0;
    let overwriteCount = 0;
    let skipCount = 0;

    for (let i = 0; i < mediaFiles.length; i++) {
      if (this.shouldStop) break;

      const mediaFile = mediaFiles[i];
      
      // 确定目标路径
      const dateFolder = mediaFile.date.toISOString().split('T')[0]; // YYYY-MM-DD
      const targetDateDir = path.join(targetDir, dateFolder);
      const targetFilePath = path.join(targetDateDir, mediaFile.filename);
      mediaFile.targetPath = targetFilePath;

      // 检查目标文件是否存在
      try {
        const targetStats = await fs.stat(targetFilePath);
        
        if (mediaFile.fileSize === targetStats.size) {
          // 文件大小相同，跳过
          mediaFile.status = '将跳过';
          skipCount++;
        } else if (overwriteDuplicates) {
          // 设置为覆盖
          mediaFile.status = '将覆盖';
          overwriteCount++;
        } else {
          // 不覆盖，跳过
          mediaFile.status = '将跳过';
          skipCount++;
        }
      } catch (error) {
        // 目标文件不存在，将上传
        mediaFile.status = '将上传';
        uploadCount++;
      }

      // 发送进度更新
      if (i % 10 === 0) {
        this.emit('progress', {
          phase: 'analyzing',
          current: i + 1,
          total: mediaFiles.length,
          message: `正在分析: ${mediaFile.filename}`
        });
      }
    }

    return {
      files: mediaFiles,
      stats: {
        total: mediaFiles.length,
        upload: uploadCount,
        overwrite: overwriteCount,
        skip: skipCount
      }
    };
  }

  stop() {
    this.shouldStop = true;
  }
}

module.exports = { MediaScanner, MediaFile };