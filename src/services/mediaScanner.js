const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const sharp = require('sharp');
const { exiftool } = require('exiftool-vendored');
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
      // 优先尝试使用 sharp，因为它可能更快
      const metadata = await sharp(filePath).metadata();
      if (metadata.exif) {
        const parser = exifParser.create(metadata.exif);
        const result = parser.parse();
        if (result.tags && result.tags.DateTimeOriginal) {
          return new Date(result.tags.DateTimeOriginal * 1000);
        }
      }
    } catch (sharpError) {
      // 如果 sharp 失败（例如，对于 .CR3 文件），则回退到 exiftool
      console.log(`[getPhotoDate] Sharp failed for ${filePath}: ${sharpError.message}. Falling back to ExifTool.`);
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('exiftool timeout after 5s')), 5000)
      );

      try {
        const readPromise = exiftool.read(filePath);
        console.log(`[getPhotoDate] Running exiftool for ${filePath}`);
        const exifData = await Promise.race([readPromise, timeoutPromise]);

        if (!exifData) {
          console.log(`[getPhotoDate] exiftool returned no tags for: ${filePath}`);
        } else {
          const createDate = exifData.DateTimeOriginal?.toDate() || exifData.CreateDate?.toDate();
          if (createDate) {
            console.log(`[getPhotoDate] Found date via exiftool: ${createDate}`);
            return createDate;
          }
        }
      } catch (exiftoolError) {
        console.log(`[getPhotoDate] ExifTool failed for ${filePath}: ${exiftoolError.message}`);
      }
    }

    // 如果所有 EXIF 方法都失败，则回退到文件修改时间
    try {
      console.log(`[getPhotoDate] Falling back to file modification time for ${filePath}`);
      const stats = await fs.stat(filePath);
      return stats.mtime;
    } catch (statError) {
      console.error(`无法获取文件统计信息: ${filePath}`, statError);
      return new Date(); // 最后的备用方案
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
    console.log(`[getMediaDate] Getting date for: ${filePath}`);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`exiftool timeout for ${filePath}`)), 10000) // 10秒超时
    );

    try {
      const readPromise = exiftool.read(filePath);
      const tags = await Promise.race([readPromise, timeoutPromise]);

      if (!tags) {
        console.log(`[getMediaDate] exiftool returned no tags for: ${filePath}. Falling back to file stats.`);
        const stats = await fs.stat(filePath);
        return stats.mtime;
      }

      // 尝试从最常见的日期标签中获取日期
      const date = tags.DateTimeOriginal || tags.CreateDate || tags.MediaCreateDate || tags.TrackCreateDate || tags.ModifyDate;
      
      if (date) {
        // exiftool-vendored 返回一个带有 toDate() 方法的 ExifDateTime 对象
        // 它在转换时会使用系统的本地时区。如果 EXIF 时间本身没有时区，
        // JS Date() 构造函数也会假定为本地时间。我们需要补偿这个行为。
        let parsedDate;
        if (date.toDate) {
          parsedDate = date.toDate();
        } else {
          // 对于纯字符串日期，手动解析以避免时区问题
          // 格式通常是 'YYYY:MM:DD HH:mm:ss'
          const parts = String(date).split(/[: ]/);
          if (parts.length >= 6) {
            parsedDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
          } else {
            parsedDate = new Date(date); // 回退到标准解析
          }
        }

        console.log(`[getMediaDate] Found date for ${filePath}: ${parsedDate}`);
        return parsedDate;
      } else {
        console.log(`[getMediaDate] No common date tags found for: ${filePath}. Falling back to file stats.`);
        const stats = await fs.stat(filePath);
        return stats.mtime;
      }
    } catch (err) {
      console.error(`[getMediaDate] Error processing ${filePath}:`, err);
      // 发生任何错误（包括超时），都回退到文件修改时间
      const stats = await fs.stat(filePath);
      return stats.mtime;
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
      let allFiles = await this.collectFiles(sourceDir, (progress) => {
        this.emit('progress', { ...progress, phase: 'collecting' });
      });
      if (!Array.isArray(allFiles)) {
        console.warn('collectFiles did not return an array. Defaulting to an empty array.');
        allFiles = [];
      }
      
      // 过滤媒体文件
      const mediaFiles = [];
      let processed = 0;

      for (const filePath of allFiles) {
        if (this.shouldStop) break;

        const ext = path.extname(filePath).toLowerCase();
        console.log(`[scanDirectory] Processing file: ${filePath} with extension: ${ext}`);

        if (this.supportedExtensions.includes(ext)) {
          console.log(`[scanDirectory] Supported extension found. Creating MediaFile object for: ${filePath}`);
          try {
            const stats = await fs.stat(filePath);
            const fileType = this.photoExtensions.includes(ext) ? '照片' : '视频';
            const mediaDate = await this.getMediaDate(filePath);
            
            const mediaFile = new MediaFile(filePath, mediaDate, fileType);
            mediaFile.fileSize = stats.size;
            mediaFiles.push(mediaFile);
            console.log(`[scanDirectory] Successfully created MediaFile: ${mediaFile.filename}`);

            this.emit('progress', {
              phase: 'processing',
              current: processed + 1,
              total: allFiles.length,
              message: `正在处理: ${path.basename(filePath)}`
            });
          } catch (error) {
            console.error(`[scanDirectory] Error processing file: ${filePath}`, error);
          }
        } else {
          console.log(`[scanDirectory] Unsupported extension. Skipping file: ${filePath}`);
        }

        processed++;
      }

      if (this.shouldStop) {
        throw new Error('扫描已取消');
      }

      // 分析文件状态
      const results = await this.analyzeFiles(mediaFiles, targetDir, overwriteDuplicates, (progress) => {
        this.emit('progress', { ...progress, phase: 'analyzing' });
      });
      
      this.emit('progress', {
        phase: 'completed',
        current: 100,
        total: 100,
        message: '扫描完成'
      });

      return results;

    } catch (error) {
      console.error('!!!!!!!!!!!!!!!!! SCAN METHOD TOP LEVEL ERROR !!!!!!!!!!!!!!!!');
      console.error('Error object:', error);
      console.error('Error message:', error ? error.message : 'N/A');
      console.error('Error stack:', error ? error.stack : 'N/A');
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit('progress', {
        phase: 'error',
        current: 0,
        total: 100,
        message: `扫描失败: ${errorMessage}`
      });
      // 抛出一个带有清晰信息的新错误对象
      throw new Error(`扫描过程中发生错误: ${errorMessage}`);
    } finally {
      this.isScanning = false;
    }
  }

  async collectFiles(dir, onProgress) {
    console.log(`[collectFiles] Starting collection in: ${dir}`);
    const files = [];
    
    async function walk(currentDir) {
      console.log(`[collectFiles] Walking directory: ${currentDir}`);
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        console.log(`[collectFiles] Found ${entries.length} entries in ${currentDir}`);
        
        let i = 0;
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          
          if (onProgress) {
            onProgress({ current: ++i, total: entries.length, message: `正在检查: ${entry.name}` });
          }

          if (entry.isDirectory()) {
            console.log(`[collectFiles] Found directory: ${entry.name}. Recursing...`);
            await walk(fullPath);
          } else if (entry.isFile()) {
            console.log(`[collectFiles] Found file: ${entry.name}`);
            files.push(fullPath);
          }

          if (onProgress && i % 10 === 0) {
            onProgress({
              current: i + 1,
              total: entries.length,
              message: `正在扫描: ${entry.name}`
            });
          }
          i++;
        }
      } catch (error) {
        console.error(`[collectFiles] Error reading directory: ${currentDir}`, error);
      }
    }

    await walk(dir);
    console.log(`[collectFiles] Finished collection. Found a total of ${files.length} files.`);
    return files;
  }

  async analyzeFiles(mediaFiles, targetDir, overwriteDuplicates, onProgress) {
    console.log(`[analyzeFiles] Starting analysis of ${mediaFiles.length} files. Target: ${targetDir}, Overwrite: ${overwriteDuplicates}`);
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
      console.log(`[analyzeFiles] Analyzing: ${mediaFile.filename}. Target path: ${targetFilePath}`);

      // 检查目标文件是否存在
      try {
        const targetStats = await fs.stat(targetFilePath);
        console.log(`[analyzeFiles] File exists at target: ${targetFilePath}`);
        
        if (mediaFile.fileSize === targetStats.size) {
          // 文件大小相同，跳过
          console.log(`[analyzeFiles] Same size. Marking to skip.`);
          mediaFile.status = '将跳过';
          skipCount++;
        } else if (overwriteDuplicates) {
          // 设置为覆盖
          console.log(`[analyzeFiles] Size mismatch (${mediaFile.fileSize} vs ${targetStats.size}) and overwrite is enabled. Marking for overwrite.`);
          mediaFile.status = '将覆盖';
          overwriteCount++;
        } else {
          // 不覆盖，跳过
          console.log(`[analyzeFiles] Size mismatch but overwrite is disabled. Marking to skip.`);
          mediaFile.status = '将跳过';
          skipCount++;
        }
      } catch (error) {
        // 目标文件不存在，将上传
        console.log(`[analyzeFiles] File does not exist at target. Marking for upload.`);
        mediaFile.status = '将上传';
        uploadCount++;
      }

      // 发送进度更新
      if (onProgress && i % 10 === 0) {
        onProgress({
          current: i + 1,
          total: mediaFiles.length,
          message: `正在分析: ${mediaFile.filename}`
        });
      }
    }

    console.log(`[analyzeFiles] Analysis complete. Upload: ${uploadCount}, Overwrite: ${overwriteCount}, Skip: ${skipCount}`);
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