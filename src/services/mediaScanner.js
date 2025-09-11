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
    // SD卡模式支持的文件类型
    this.sdPhotoExtensions = ['.jpg', '.jpeg', '.png', '.heic', '.nef', '.cr2', '.arw', '.dng', '.cr3'];
    this.sdVideoExtensions = ['.mp4', '.mov', '.avi', '.m4v', '.3gp', '.mkv'];
    
    // DJI模式支持的文件类型
    this.djiPhotoExtensions = ['.jpg', '.jpeg', '.lrf'];
    this.djiVideoExtensions = ['.osv', '.mp4', '.mov'];
    
    // 向后兼容的默认扩展名（SD模式）
    this.photoExtensions = this.sdPhotoExtensions;
    this.videoExtensions = this.sdVideoExtensions;
    this.supportedExtensions = [...this.photoExtensions, ...this.videoExtensions];
    
    this.isScanning = false;
    this.shouldStop = false;
    this.currentMode = 'sd'; // 默认SD模式
  }

  setMode(mode) {
    this.currentMode = mode;
    if (mode === 'dji') {
      this.photoExtensions = this.djiPhotoExtensions;
      this.videoExtensions = this.djiVideoExtensions;
    } else {
      this.photoExtensions = this.sdPhotoExtensions;
      this.videoExtensions = this.sdVideoExtensions;
    }
    this.supportedExtensions = [...this.photoExtensions, ...this.videoExtensions];
    console.log(`[MediaScanner] Mode set to: ${mode}, supported extensions:`, this.supportedExtensions);
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

    // 1) 先按拍摄时间排序（如时间相同则按文件名稳定排序）
    const files = [...mediaFiles].sort((a, b) => {
      if (a.date && b.date && a.date.getTime() !== b.date.getTime()) {
        return a.date - b.date;
      }
      return (a.filename || '').localeCompare(b.filename || '');
    });

    let uploadCount = 0;
    let overwriteCount = 0;
    let skipCount = 0;

    // 记录每个日期目录下，本批次已分配的目标文件名，避免批内重名
    const usedNamesByDate = new Map(); // dateFolder -> Set(filenames)

    // 针对 SMB/NAS：缓存每个日期目录的现有文件名（size懒获取），避免频繁 stat
    const existingByDir = new Map(); // targetDateDir -> Map(name -> size|null)
    const getDirIndex = async (dir) => {
      if (existingByDir.has(dir)) return existingByDir.get(dir);
      const map = new Map();
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isFile()) {
            // 仅记录文件名；size 按需获取
            map.set(ent.name, null);
          }
        }
      } catch {
        // 目录不存在或无法访问时，按空目录处理
      }
      existingByDir.set(dir, map);
      return map;
    };

    // 懒获取指定文件的size（并缓存到索引中）
    const getIndexedSize = async (dir, indexMap, name) => {
      if (!indexMap.has(name)) return undefined;
      const cached = indexMap.get(name);
      if (cached != null) return cached;
      try {
        const st = await fs.stat(path.join(dir, name));
        indexMap.set(name, st.size);
        return st.size;
      } catch {
        // 文件可能被外部删除
        indexMap.delete(name);
        return undefined;
      }
    };

    const getDateFolder = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD（本地时区）
    };

    // 生成相邻日期目录（兼容历史UTC命名导致的偏移）
    const getAdjacentDateDirs = (d) => {
      const base = new Date(d.getTime());
      const prev = new Date(d.getTime() - 24 * 60 * 60 * 1000);
      const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      return [getDateFolder(base), getDateFolder(prev), getDateFolder(next)];
    };

    const makeUniqueName = async (targetDateDir, originalName) => {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      const nameSet = usedNamesByDate.get(targetDateDir) || new Set();

      // 匹配：任意前缀 + 可选单字母 + 末尾数字
      const m = base.match(/^(.*?)([A-Za-z])?(\d+)$/);

      let attempt = 0;
      while (true) {
        let candidateBase;
        if (m) {
          const prefix = m[1] || '';
          const letter = (m[2] || '').toUpperCase();
          const digits = m[3];

          if (letter) {
            // 有字母+数字结尾：按字母递增，超过 Z 后使用 _1、_2 后缀避免无限循环
            if (attempt === 0) {
              candidateBase = `${prefix}${letter}${digits}`;
            } else if (attempt <= 26) {
              const startCode = letter.charCodeAt(0) - 65; // 0..25
              const nextCode = startCode + attempt; // 不取模
              if (nextCode <= 25) {
                const nextLetter = String.fromCharCode(65 + nextCode);
                candidateBase = `${prefix}${nextLetter}${digits}`;
              } else {
                // 超过 Z，回退为在原名后追加 _N
                candidateBase = `${prefix}${letter}${digits}_${nextCode - 25}`;
              }
            } else {
              // attempt > 26
              candidateBase = `${prefix}${letter}${digits}_${attempt - 26}`;
            }
          } else {
            // 没有字母，仅数字结尾：使用 _1, _2 后缀
            candidateBase = attempt === 0 ? base : `${base}_${attempt}`;
          }
        } else {
          // 不符合规律：使用 _1, _2 后缀
          candidateBase = attempt === 0 ? base : `${base}_${attempt}`;
        }

        const candidate = candidateBase + ext;
        const existingIndex = await getDirIndex(targetDateDir);
        const nameTakenInBatch = nameSet.has(candidate);
        const nameTakenOnDisk = existingIndex.has(candidate);
        if (!nameTakenInBatch && !nameTakenOnDisk) {
          // 找到可用名字
          nameSet.add(candidate);
          usedNamesByDate.set(targetDateDir, nameSet);
          return candidate;
        }
        attempt++;
      }
    };

    for (let i = 0; i < files.length; i++) {
      if (this.shouldStop) break;

      const mediaFile = files[i];

      // 确定目标日期路径
      const d = mediaFile.date; // 使用本地时间，避免使用 UTC 的 toISOString 导致日期偏移
      const [dateFolder, prevFolder, nextFolder] = getAdjacentDateDirs(d);
      const targetDateDir = path.join(targetDir, dateFolder);
      const existingIndex = await getDirIndex(targetDateDir);
      let nameSet = usedNamesByDate.get(targetDateDir) || new Set();

      const originalName = mediaFile.filename;
      const originalPath = path.join(targetDateDir, originalName);

      // 先检测当前日期目录
      if (existingIndex.has(originalName)) {
        const sizeOnDisk = await getIndexedSize(targetDateDir, existingIndex, originalName);
        if (sizeOnDisk === mediaFile.fileSize) {
          // 同名且同大小：跳过
          mediaFile.status = '将跳过';
          mediaFile.targetPath = originalPath;
          skipCount++;
          nameSet.add(originalName);
        } else if (overwriteDuplicates) {
          // 同名但大小不同：根据设置覆盖
          mediaFile.status = '将覆盖';
          mediaFile.targetPath = originalPath;
          overwriteCount++;
          nameSet.add(originalName);
        } else {
          // 同名且大小不同，且不覆盖：按规则重命名
          const uniqueName = await makeUniqueName(targetDateDir, originalName);
          mediaFile.filename = uniqueName;
          mediaFile.targetPath = path.join(targetDateDir, uniqueName);
          mediaFile.status = '将上传';
          uploadCount++;
          nameSet.add(uniqueName);
        }
      } else {
        // 如果当前日期目录未找到，兼容历史UTC偏移：检查前一天/后一天目录的同名同大小，以决定跳过
        let foundSameElsewhere = false;
        for (const altFolder of [prevFolder, nextFolder]) {
          if (!altFolder) continue;
          const altDir = path.join(targetDir, altFolder);
          const altIndex = await getDirIndex(altDir);
          if (altIndex.has(originalName)) {
            const altSize = await getIndexedSize(altDir, altIndex, originalName);
            if (altSize === mediaFile.fileSize) {
              mediaFile.status = '将跳过';
              mediaFile.targetPath = path.join(altDir, originalName);
              skipCount++;
              nameSet.add(originalName);
              foundSameElsewhere = true;
              break;
            }
          }
        }

        if (!foundSameElsewhere) {
          // 目标目录中无同名文件，也未在相邻日期目录找到同名同大小
          if (nameSet.has(originalName)) {
            // 批次内已使用该名：按规则重命名
            const uniqueName = await makeUniqueName(targetDateDir, originalName);
            mediaFile.filename = uniqueName;
            mediaFile.targetPath = path.join(targetDateDir, uniqueName);
            mediaFile.status = '将上传';
            uploadCount++;
            nameSet.add(uniqueName);
          } else {
            // 保持原名
            mediaFile.targetPath = originalPath;
            mediaFile.status = '将上传';
            uploadCount++;
            nameSet.add(originalName);
          }
        }
      }

      usedNamesByDate.set(targetDateDir, nameSet);

      // 发送进度更新（每10个更新一次）
      if (onProgress && i % 10 === 0) {
        onProgress({
          phase: 'analyzing',
          current: i + 1,
          total: files.length,
          message: `分析中: ${mediaFile.filename}`,
          stats: { upload: uploadCount, overwrite: overwriteCount, skip: skipCount }
        });
      }
    }

    console.log(`[analyzeFiles] Analysis complete. Upload: ${uploadCount}, Overwrite: ${overwriteCount}, Skip: ${skipCount}`);
    return { files, uploadCount, overwriteCount, skipCount };
  }

  stop() {
    this.shouldStop = true;
  }
}

module.exports = { MediaScanner, MediaFile };