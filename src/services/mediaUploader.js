const fs = require("fs").promises;
const path = require("path");
const { EventEmitter } = require("events");

class MediaUploader extends EventEmitter {
  constructor() {
    super();
    this.isUploading = false;
    this.isPaused = false;
    this.isCancelled = false;
    this.currentIndex = 0;
    this.files = [];
    // 新增：控制覆盖与批次内已用名称索引
    this.overwriteDuplicates = false;
    this.dirUsedNameSet = new Map(); // key: 目录, value: Set(已占用文件名)
  }

  async uploadFiles(files, targetDir, overwriteDuplicates) {
    this.isUploading = true;
    this.isPaused = false;
    this.isCancelled = false;
    this.currentIndex = 0;
    this.files = files;
    // 新增：保存本轮上传的覆盖选项与重置批内名称索引
    this.overwriteDuplicates = !!overwriteDuplicates;
    this.dirUsedNameSet = new Map();

    try {
      let processedFiles = 0;
      const totalFiles = files.length;

      this.emit("progress", {
        current: 0,
        total: totalFiles,
        message: `开始上传 ${totalFiles} 个媒体文件...`,
      });

      for (let i = 0; i < files.length; i++) {
        if (this.isCancelled) {
          this.emit("progress", {
            current: processedFiles,
            total: totalFiles,
            message: "上传已取消",
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
          if (mediaFile.status === "将上传" || mediaFile.status === "将覆盖") {
            // 新增：在真正开始复制前，最后一次确保目标路径唯一（处理扫描后到上传前的竞态变化）
            await this.ensureUniqueTarget(mediaFile);

            this.emit("file-start", { file: mediaFile }); // 新增的事件
            await this.copyFile(mediaFile);

            this.emit("fileProcessed", {
              file: mediaFile,
              success: true,
              message: `已复制 (${mediaFile.fileType}): ${mediaFile.filename}`,
            });
          } else {
            this.emit("fileProcessed", {
              file: mediaFile,
              success: true,
              message: `跳过 (${mediaFile.fileType}): ${mediaFile.filename}`,
            });
          }

          processedFiles++;

          this.emit("progress", {
            current: processedFiles,
            total: totalFiles,
            message: `正在处理: ${mediaFile.filename} (${processedFiles}/${totalFiles})`,
          });
        } catch (error) {
          console.error(`处理文件失败: ${mediaFile.filename}`, error);

          this.emit("fileProcessed", {
            file: mediaFile,
            success: false,
            message: `处理文件出错 ${mediaFile.filename}: ${error.message}`,
          });
        }
      }

      if (!this.isCancelled) {
        this.emit("progress", {
          current: totalFiles,
          total: totalFiles,
          message: "上传完成!",
        });
      }

      return {
        success: !this.isCancelled,
        processed: processedFiles,
        total: totalFiles,
      };
    } catch (error) {
      this.emit("progress", {
        current: 0,
        total: files.length,
        message: `上传失败: ${error.message}`,
      });
      throw error;
    } finally {
      this.isUploading = false;
      this.isPaused = false;
    }
  }

  // 新增：确保目标路径唯一（根据覆盖选项与磁盘/批次占用情况进行重命名）
  async ensureUniqueTarget(mediaFile) {
    const overwrite = !!this.overwriteDuplicates;
    const targetDir = path.dirname(mediaFile.targetPath);
    const originalName = path.basename(mediaFile.targetPath);

    const usedSet = this._getUsedSet(targetDir);

    // 若允许覆盖，则仅登记占用，保持原路径
    if (overwrite || mediaFile.status === "将覆盖") {
      usedSet.add(originalName);
      return;
    }

    let candidate = originalName;

    // 若当前批次已占用或磁盘已存在，则生成唯一名称
    if (usedSet.has(candidate) || (await this._exists(path.join(targetDir, candidate)))) {
      const uniqueName = await this._makeUniqueName(targetDir, originalName, usedSet);
      candidate = uniqueName;
      mediaFile.filename = candidate;
      mediaFile.targetPath = path.join(targetDir, candidate);
    }

    // 登记占用
    usedSet.add(candidate);
  }

  _getUsedSet(dir) {
    let set = this.dirUsedNameSet.get(dir);
    if (!set) {
      set = new Set();
      this.dirUsedNameSet.set(dir, set);
    }
    return set;
  }

  async _exists(p) {
    try {
      await fs.access(p);
      return true;
    } catch (_) {
      return false;
    }
  }

  // 生成唯一文件名：
  // 1) 若文件名形如 PREFIX + [A-Z] + DIGITS(>=3)，则按字母递增，超过 Z 后追加 _N；
  // 2) 其它情况则采用 _1, _2, ... 递增后缀；
  async _makeUniqueName(targetDir, originalName, usedSet) {
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    // 与扫描阶段对齐：任意前缀 + 可选单字母 + 末尾数字
    const camPattern = /^(.*?)([A-Za-z])?(\d+)$/;

    let attempt = 1; // 从 1 开始，避免原名（原名已被占用）

    while (attempt < 10000) { // 安全上限，防止极端情况死循环
      let candidateBase;
      const m = base.match(camPattern);
      if (m) {
        const prefix = m[1] || "";
        const letter = (m[2] || "").toUpperCase();
        const digits = m[3];

        if (letter) {
          if (attempt <= 26) {
            const startCode = letter.charCodeAt(0) - 65; // A->0
            const nextCode = startCode + attempt; // 不取模
            if (nextCode <= 25) {
              const nextLetter = String.fromCharCode(65 + nextCode);
              candidateBase = `${prefix}${nextLetter}${digits}`;
            } else {
              candidateBase = `${prefix}${letter}${digits}_${nextCode - 25}`;
            }
          } else {
            candidateBase = `${prefix}${letter}${digits}_${attempt - 26}`;
          }
        } else {
          // 无字母：使用 _1, _2 后缀
          candidateBase = `${base}_${attempt}`;
        }
      } else {
        candidateBase = `${base}_${attempt}`;
      }

      const candidate = candidateBase + ext;
      const pathOnDisk = path.join(targetDir, candidate);
      if (!usedSet.has(candidate) && !(await this._exists(pathOnDisk))) {
        return candidate;
      }

      attempt++;
    }

    // 兜底：若超过尝试上限，追加时间戳
    const fallback = `${base}_${Date.now()}${ext}`;
    return fallback;
  }

  async copyFile(mediaFile) {
    return new Promise(async (resolve, reject) => {
      try {
        const targetDir = path.dirname(mediaFile.targetPath);
        await fs.mkdir(targetDir, { recursive: true });

        const stats = await fs.stat(mediaFile.filePath);
        const totalBytes = stats.size;
        let copiedBytes = 0;

        // 增大缓冲区以提升 SMB/NAS 吞吐
        const fsNative = require("fs");
        const readStream = fsNative.createReadStream(mediaFile.filePath, { highWaterMark: 1024 * 1024 }); // 1MB
        const writeStream = fsNative.createWriteStream(mediaFile.targetPath, { highWaterMark: 1024 * 1024 }); // 1MB

        // 节流进度事件，减少IPC压力
        let lastEmit = 0;
        const emitProgress = () => {
          this.emit("file-progress", {
            file: mediaFile,
            total: totalBytes,
            current: copiedBytes,
            percentage: totalBytes > 0 ? Math.round((copiedBytes / totalBytes) * 100) : 0,
          });
        };

        readStream.on("data", (chunk) => {
          copiedBytes += chunk.length;
          const now = Date.now();
          if (now - lastEmit >= 100 || copiedBytes === totalBytes) {
            lastEmit = now;
            emitProgress();
          }
        });

        readStream.on("error", reject);
        writeStream.on("error", reject);
        writeStream.on("finish", async () => {
          try {
            await fs.utimes(mediaFile.targetPath, stats.atime, stats.mtime);
            resolve();
          } catch (error) {
            console.warn(`无法复制文件时间戳: ${mediaFile.filename}`, error.message);
            resolve(); // Resolve even if setting times fails
          }
        });

        readStream.pipe(writeStream);
      } catch (error) {
        reject(error);
      }
    });
  }

  pause() {
    if (this.isUploading && !this.isPaused) {
      this.isPaused = true;
      this.emit("progress", {
        current: this.currentIndex,
        total: this.files.length,
        message: "上传已暂停",
      });
    }
  }

  resume() {
    if (this.isUploading && this.isPaused) {
      this.isPaused = false;
      this.emit("progress", {
        current: this.currentIndex,
        total: this.files.length,
        message: "继续上传...",
      });
    }
  }

  cancel() {
    if (this.isUploading) {
      this.isCancelled = true;
      this.isPaused = false;
      this.emit("progress", {
        current: this.currentIndex,
        total: this.files.length,
        message: "正在取消上传...",
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
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = { MediaUploader };